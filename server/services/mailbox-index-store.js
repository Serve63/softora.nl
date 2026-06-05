const crypto = require('crypto');

const MAILBOX_INDEX_TABLES = Object.freeze({
  messages: 'softora_mailbox_messages',
  syncState: 'softora_mailbox_sync_state',
});

const BODY_RETENTION_DAYS = 90;
const BODY_RETENTION_NEWEST_COUNT = 500;
const BODY_MAX_CHARS = 200 * 1024;
const SYNC_LOCK_TTL_MS = 90_000;

function createMailboxIndexStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    now = () => new Date(),
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  function getClient() {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient();
  }

  function isAvailable() {
    return Boolean(getClient());
  }

  function isUnavailableError(error) {
    const text = normalizeString(error && (error.message || error.details || error.hint || error.code));
    return (
      /relation .* does not exist/i.test(text) ||
      /could not find .* schema cache/i.test(text) ||
      error?.code === '42P01' ||
      error?.statusCode === 404 ||
      error?.status === 404
    );
  }

  function isSoftIndexError(error) {
    const text = normalizeString(error && (error.message || error.details || error.hint || error.code || error));
    return /(?:abort|timeout|timed out|fetch failed|network|econnreset|etimedout|temporar)/i.test(text);
  }

  function logSoftIndexError(label, error) {
    const log =
      typeof logger.info === 'function'
        ? logger.info.bind(logger)
        : typeof logger.log === 'function'
          ? logger.log.bind(logger)
          : null;
    if (log) log(`[MailboxIndex][${label}][SoftError]`, error?.message || error);
  }

  async function run(label, operation) {
    const client = getClient();
    if (!client) return { ok: false, unavailable: true, data: null, error: new Error('Supabase niet geconfigureerd') };
    try {
      const result = await operation(client);
      if (result && result.error) throw result.error;
      return { ok: true, data: result ? result.data : null, count: result ? result.count : null };
    } catch (error) {
      if (!isUnavailableError(error)) {
        if (isSoftIndexError(error)) {
          logSoftIndexError(label, error);
        } else {
          logger.error(`[MailboxIndex][${label}]`, error?.message || error);
        }
      }
      return { ok: false, unavailable: isUnavailableError(error), data: null, error };
    }
  }

  function isoNow() {
    return now().toISOString();
  }

  function normalizeEmail(value) {
    return normalizeString(value).toLowerCase();
  }

  function normalizeFolder(value) {
    return normalizeString(value || 'inbox').toLowerCase() || 'inbox';
  }

  function buildSyncKey(accountEmail, folder) {
    return `${normalizeEmail(accountEmail)}|${normalizeFolder(folder)}`;
  }

  function parseUidFromMessage(message) {
    const uid = Number(message && message.uid);
    if (Number.isFinite(uid) && uid > 0) return uid;
    const idMatch = normalizeString(message && message.id).match(/:(\d+)$/);
    return idMatch ? Number(idMatch[1]) : 0;
  }

  function parseDateIso(value) {
    const date = value ? new Date(value) : now();
    return Number.isFinite(date.getTime()) ? date.toISOString() : isoNow();
  }

  function shouldStoreBody(message, index) {
    if (Number(index) < BODY_RETENTION_NEWEST_COUNT) return true;
    const parsed = Date.parse(message && message.date);
    if (!Number.isFinite(parsed)) return true;
    return now().getTime() - parsed <= BODY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  }

  function trimBodyForStorage(message, index) {
    const rawBody = normalizeString(message && message.body);
    if (!rawBody || !shouldStoreBody(message, index)) {
      return { text: null, truncated: false, hasBody: false };
    }
    const text = rawBody.length > BODY_MAX_CHARS ? rawBody.slice(0, BODY_MAX_CHARS) : rawBody;
    return { text, truncated: rawBody.length > BODY_MAX_CHARS, hasBody: true };
  }

  function buildMessageKey(accountEmail, folder, uid) {
    return `${normalizeEmail(accountEmail)}|${normalizeFolder(folder)}|${Number(uid) || 0}`;
  }

  function buildMessageRow(message, accountEmail, folder, index = 0) {
    const normalizedFolder = normalizeFolder(folder || message?.folder);
    const uid = parseUidFromMessage(message);
    const dateIso = parseDateIso(message && message.date);
    const body = trimBodyForStorage(message, index);
    return {
      message_key: buildMessageKey(accountEmail, normalizedFolder, uid),
      account_email: normalizeEmail(accountEmail),
      folder: normalizedFolder,
      uid,
      provider_id: normalizeString(message && message.id) || `${normalizedFolder}:${uid}`,
      message_id: normalizeString(message && message.messageId),
      in_reply_to: normalizeString(message && message.inReplyTo),
      references_text: normalizeString(message && message.references),
      sender_name: truncateText(normalizeString(message && message.from), 240),
      sender_email: truncateText(normalizeString(message && message.email), 320),
      recipients_text: truncateText(normalizeString(message && message.to), 1000),
      subject: truncateText(normalizeString(message && message.subject) || '(Geen onderwerp)', 500),
      preview: truncateText(normalizeString(message && message.preview), 500),
      body_text: body.text,
      body_truncated: body.truncated,
      has_body: body.hasBody,
      date: dateIso,
      internal_date: dateIso,
      unread: Boolean(message && message.unread),
      starred: Boolean(message && message.starred),
      payload: {
        source: 'imap-sync',
      },
      updated_at: isoNow(),
      deleted_at: null,
    };
  }

  function normalizeMessageRow(row = {}, options = {}) {
    const folder = normalizeFolder(row.folder);
    const uid = Number(row.uid) || 0;
    const includeBody = options.includeBody === true;
    return {
      id: normalizeString(row.provider_id) || `${folder}:${uid}`,
      uid,
      folder,
      from: normalizeString(row.sender_name) || normalizeString(row.sender_email) || 'Onbekend',
      email: normalizeString(row.sender_email),
      to: normalizeString(row.recipients_text),
      subject: normalizeString(row.subject) || '(Geen onderwerp)',
      preview: normalizeString(row.preview),
      body: includeBody ? normalizeString(row.body_text) : '',
      messageId: normalizeString(row.message_id),
      inReplyTo: normalizeString(row.in_reply_to),
      references: normalizeString(row.references_text),
      date: parseDateIso(row.date || row.internal_date),
      unread: Boolean(row.unread),
      starred: Boolean(row.starred),
      hasBody: Boolean(row.has_body),
      bodyTruncated: Boolean(row.body_truncated),
      indexed: true,
    };
  }

  async function listMessages({ accountEmail, folder = 'inbox', limit = 50 }) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const result = await run('list-messages', (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select(
          'message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,references_text,sender_name,sender_email,recipients_text,subject,preview,date,internal_date,unread,starred,has_body,body_truncated'
        )
        .eq('account_email', normalizeEmail(accountEmail))
        .eq('folder', normalizeFolder(folder))
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(safeLimit)
    );
    if (!result.ok) return null;
    return (result.data || []).map((row) => normalizeMessageRow(row));
  }

  async function getMessage({ accountEmail, folder = 'inbox', id = '' }) {
    const normalizedFolder = normalizeFolder(folder);
    const uid = Number(normalizeString(id).match(/:(\d+)$/)?.[1] || id);
    const query = (client) => {
      const base = client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select('*')
        .eq('account_email', normalizeEmail(accountEmail))
        .eq('folder', normalizedFolder)
        .is('deleted_at', null)
        .limit(1);
      if (Number.isFinite(uid) && uid > 0) return base.eq('uid', uid).maybeSingle();
      return base.eq('provider_id', normalizeString(id)).maybeSingle();
    };
    const result = await run('get-message', query);
    if (!result.ok || !result.data) return null;
    return normalizeMessageRow(result.data, { includeBody: true });
  }

  async function upsertMessages({ accountEmail, folder = 'inbox', messages = [] }) {
    const rows = (Array.isArray(messages) ? messages : [])
      .map((message, index) => buildMessageRow(message, accountEmail, folder, index))
      .filter((row) => row.uid > 0);
    if (!rows.length) return { ok: true, data: [], upserted: 0 };
    const result = await run('upsert-messages', (client) =>
      client.from(MAILBOX_INDEX_TABLES.messages).upsert(rows, { onConflict: 'message_key' })
    );
    if (!result.ok) return result;
    return { ...result, upserted: rows.length };
  }

  async function getSyncState({ accountEmail, folder = 'inbox' }) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const result = await run('get-sync-state', (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.syncState)
        .select('*')
        .eq('sync_key', syncKey)
        .limit(1)
        .maybeSingle()
    );
    if (!result.ok) return null;
    return result.data || null;
  }

  async function acquireSyncLock({ accountEmail, folder = 'inbox', force = false, lockTtlMs = SYNC_LOCK_TTL_MS }) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const current = await getSyncState({ accountEmail, folder });
    const currentLockExpiresAt = Date.parse(normalizeString(current && current.lock_expires_at));
    if (!force && Number.isFinite(currentLockExpiresAt) && currentLockExpiresAt > now().getTime()) {
      return { ok: false, locked: true, syncKey };
    }

    const lockToken = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const startedAt = isoNow();
    const lockExpiresAt = new Date(now().getTime() + Math.max(10_000, Number(lockTtlMs) || SYNC_LOCK_TTL_MS)).toISOString();
    const result = await run('acquire-sync-lock', (client) =>
      client.from(MAILBOX_INDEX_TABLES.syncState).upsert(
        {
          sync_key: syncKey,
          account_email: normalizeEmail(accountEmail),
          folder: normalizeFolder(folder),
          status: 'syncing',
          sync_started_at: startedAt,
          lock_token: lockToken,
          lock_expires_at: lockExpiresAt,
          updated_at: startedAt,
        },
        { onConflict: 'sync_key' }
      )
    );
    if (!result.ok) return { ok: false, locked: false, syncKey, error: result.error };
    return { ok: true, locked: false, syncKey, lockToken };
  }

  async function finishSync({ accountEmail, folder = 'inbox', lockToken = '', messageCount = 0, lastUid = 0, error = '' }) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const failed = Boolean(normalizeString(error));
    const patch = {
      status: failed ? 'error' : 'ok',
      last_error: failed ? truncateText(normalizeString(error), 1000) : null,
      message_count: Math.max(0, Number(messageCount) || 0),
      last_uid: Math.max(0, Number(lastUid) || 0),
      lock_token: null,
      lock_expires_at: null,
      updated_at: isoNow(),
    };
    if (!failed) patch.last_synced_at = isoNow();
    return run('finish-sync', (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.syncState)
        .update(patch)
        .eq('sync_key', syncKey)
        .eq('lock_token', normalizeString(lockToken))
    );
  }

  function isSyncStateStale(state, maxAgeMs) {
    const syncedAt = Date.parse(normalizeString(state && state.last_synced_at));
    if (!Number.isFinite(syncedAt)) return true;
    return now().getTime() - syncedAt > Math.max(1_000, Number(maxAgeMs) || 120_000);
  }

  return {
    BODY_MAX_CHARS,
    BODY_RETENTION_DAYS,
    BODY_RETENTION_NEWEST_COUNT,
    MAILBOX_INDEX_TABLES,
    acquireSyncLock,
    buildMessageKey,
    buildMessageRow,
    buildSyncKey,
    finishSync,
    getMessage,
    getSyncState,
    isAvailable,
    isSyncStateStale,
    listMessages,
    normalizeMessageRow,
    upsertMessages,
  };
}

module.exports = {
  BODY_MAX_CHARS,
  BODY_RETENTION_DAYS,
  BODY_RETENTION_NEWEST_COUNT,
  MAILBOX_INDEX_TABLES,
  createMailboxIndexStore,
};

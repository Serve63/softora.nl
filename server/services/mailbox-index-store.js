const crypto = require('crypto');
const {
  isOriginalCampaignOutboundMessage,
} = require('./mailbox-image-ownership');
const {
  createMailboxMessageReferenceLookup,
} = require('../repositories/mailbox-message-reference-lookup');
const {
  createMailboxCampaignLineageLookup,
} = require('../repositories/mailbox-campaign-lineage-lookup');
const { createMailboxQuotedSentCandidateLookup } = require('../repositories/mailbox-quoted-sent-candidate-lookup');
const { buildAutomatedReplyEvidence } = require('./mailbox-automated-reply');
const { createMailboxProviderMessageRowBuilder } = require('./mailbox-provider-message-row');
const { executeMailboxIndexQuery } = require('./mailbox-index-query-timeout');
const {
  createMailboxAtomicCommitQuery,
  normalizeMailboxAtomicCommitResult,
} = require('./mailbox-index-atomic-commit');
const { createMailboxSyncStateStore } = require('./mailbox-sync-runtime');
const {
  buildMailboxGenerationMessageKey,
  normalizeMailboxUidValidity,
  resolveMailboxBatchUidValidity,
} = require('./mailbox-uid-validity');
const { createMailboxUidValidityStore } = require('./mailbox-uid-validity-store');
const {
  applyMailboxMessageActionReference,
  createMailboxActionNotFoundResult,
  resolveMailboxMessageActionReference,
} = require('./mailbox-message-action-reference');
const { createMailboxIndexUidSelection } = require('./mailbox-index-uid-selection');

const MAILBOX_INDEX_TABLES = Object.freeze({
  messages: 'softora_mailbox_messages',
  syncState: 'softora_mailbox_sync_state',
});

const BODY_RETENTION_DAYS = 90;
const BODY_RETENTION_NEWEST_COUNT = 500;
const BODY_MAX_CHARS = 200 * 1024;
const SYNC_LOCK_TTL_MS = 90_000;
const MAILBOX_INDEX_DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const MAILBOX_INDEX_PAGE_SIZE = 1000;
const MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE = 100;
const PROVIDER_ACTIVE_THREAD_MAX_COUNT = 10_000;
const MAILBOX_MESSAGE_METADATA_COLUMNS =
  'message_key,account_email,folder,uid,uid_validity,provider_id,message_id,in_reply_to,references_text,sender_name,sender_email,recipients_text,subject,preview,date,internal_date,unread,softora_read_at,starred,reply_dismissed_at,has_body,body_truncated,payload';

function createMailboxIndexStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    now = () => new Date(),
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    mailboxIndexQueryTimeoutMs = MAILBOX_INDEX_DEFAULT_QUERY_TIMEOUT_MS,
    mailboxIndexFailureCooldownMs = 60_000,
  } = deps;
  let failureCooldownUntilMs = 0;
  let failureCooldownReason = '';

  function getClient(options = {}) {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient(options);
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

  function getSafeFailureCooldownMs() {
    return Math.max(0, Math.min(5 * 60_000, Number(mailboxIndexFailureCooldownMs) || 0));
  }

  function isFailureCooldownActive() {
    return now().getTime() < failureCooldownUntilMs;
  }

  function createFailureCooldownError() {
    const secondsLeft = Math.max(1, Math.ceil((failureCooldownUntilMs - now().getTime()) / 1000));
    const error = new Error(
      `Mailbox index tijdelijk overgeslagen na Supabase timeout/504 (${secondsLeft}s cooldown${failureCooldownReason ? `, ${failureCooldownReason}` : ''})`
    );
    error.code = 'MAILBOX_INDEX_COOLDOWN';
    return error;
  }

  function openFailureCooldown(error) {
    const cooldownMs = getSafeFailureCooldownMs();
    if (!cooldownMs) return;
    failureCooldownUntilMs = now().getTime() + cooldownMs;
    failureCooldownReason = truncateText(normalizeString(error?.message || error?.code || error), 160);
    logSoftIndexError('circuit-open', failureCooldownReason);
  }

  async function run(label, operation, {
    mutationSignal = null,
    signal = null,
    mutation = false,
    timeoutMs = mailboxIndexQueryTimeoutMs,
  } = {}) {
    const boundedTimeoutMs = Math.max(
      250,
      Math.min(30_000, Number(timeoutMs) || mailboxIndexQueryTimeoutMs)
    );
    const client = getClient({
      timeoutMs: boundedTimeoutMs,
      // Mailbox-index operations already have their own bounded circuit breaker.
      // They must not inherit a broad cooldown opened by an unrelated UI-state read.
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!client) return { ok: false, unavailable: true, data: null, error: new Error('Supabase niet geconfigureerd') };
    if (isFailureCooldownActive()) {
      return { ok: false, unavailable: false, data: null, error: createFailureCooldownError() };
    }
    try {
      const result = await executeMailboxIndexQuery(operation(client), {
        label,
        timeoutMs: boundedTimeoutMs,
        mutationSignal: mutationSignal || (mutation ? signal : null),
        signal: mutation ? null : signal,
      });
      if (result && result.error) throw result.error;
      failureCooldownUntilMs = 0;
      failureCooldownReason = '';
      return { ok: true, data: result ? result.data : null, count: result ? result.count : null };
    } catch (error) {
      if ((mutationSignal || signal)?.aborted) {
        return { ok: false, unavailable: false, data: null, error };
      }
      if (!isUnavailableError(error)) {
        if (isSoftIndexError(error)) {
          openFailureCooldown(error);
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

  const { acquireSyncLock, checkpointSync, finishSync, releaseSyncLock } = createMailboxSyncStateStore({
    run,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    truncateText,
    now,
    tableName: MAILBOX_INDEX_TABLES.syncState,
    defaultLockTtlMs: SYNC_LOCK_TTL_MS,
  });
  const { prepareUidValidity } = createMailboxUidValidityStore({ run, buildSyncKey, normalizeString });
  const {
    listMessageUidSyncStateForAccount,
    listMessageUidsForAccount,
  } = createMailboxIndexUidSelection({
    run,
    tableName: MAILBOX_INDEX_TABLES.messages,
    pageSize: MAILBOX_INDEX_PAGE_SIZE,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    now,
  });

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

  function normalizeAttachments(value) {
    return (Array.isArray(value) ? value : []).slice(0, 20).map((attachment) => ({
      filename: truncateText(normalizeString(attachment && attachment.filename) || 'Bijlage', 180),
      contentType: truncateText(normalizeString(attachment && attachment.contentType), 120),
      size: Math.max(0, Number(attachment && attachment.size) || 0),
    }));
  }

  function buildMessageKey(accountEmail, folder, uid, uidValidity = 0) {
    return buildMailboxGenerationMessageKey(accountEmail, folder, uid, uidValidity);
  }

  function buildProviderMessageKey(provider, providerId) {
    return `${normalizeString(provider).toLowerCase()}|${normalizeString(providerId)}`;
  }

  function stableProviderUid(provider, providerId) {
    const digest = crypto
      .createHash('sha256')
      .update(buildProviderMessageKey(provider, providerId))
      .digest();
    return Math.max(1, digest.readUInt32BE(0) & 0x7fffffff);
  }

  function buildMessageRow(message, accountEmail, folder, index = 0, uidValidity = 0) {
    const normalizedFolder = normalizeFolder(folder || message?.folder);
    const uid = parseUidFromMessage(message);
    const normalizedUidValidity = normalizeMailboxUidValidity(
      uidValidity || message?.uidValidity
    );
    const dateIso = parseDateIso(message && message.date);
    const body = trimBodyForStorage(message, index);
    return {
      message_key: buildMessageKey(accountEmail, normalizedFolder, uid, normalizedUidValidity),
      account_email: normalizeEmail(accountEmail),
      folder: normalizedFolder,
      uid,
      uid_validity: normalizedUidValidity || null,
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
        embeddedImageCount: Math.max(
          0,
          Math.min(8, Array.isArray(message && message.bodyImages) ? message.bodyImages.length : 0)
        ),
        originalCampaignOutbound: isOriginalCampaignOutboundMessage({
          ...message,
          folder: normalizedFolder,
        }),
        webdesignLinkEvidenceKnown: message && message.webdesignLinkEvidenceKnown === true,
        webdesignLinkUrl: truncateText(
          normalizeString(message && message.webdesignLinkUrl),
          4000
        ),
        recipientRoutingEvidenceKnown: message && message.recipientRoutingEvidenceKnown === true,
        toDisplay: truncateText(normalizeString(message && message.toDisplay), 2000),
        cc: truncateText(normalizeString(message && message.cc), 2000),
        bcc: truncateText(normalizeString(message && message.bcc), 2000),
        deliveredTo: truncateText(normalizeString(message && message.deliveredTo), 1000),
        attachments: normalizeAttachments(message && message.attachments),
        autoSubmitted: truncateText(normalizeString(message && message.autoSubmitted), 200),
        precedence: truncateText(normalizeString(message && message.precedence), 120),
        autoResponseSuppress: truncateText(normalizeString(message && message.autoResponseSuppress), 200),
        automatedReplyEvidenceKnown: message && message.automatedReplyEvidenceKnown === true,
        automatedReplyEvidence: message && message.automatedReplyEvidence === true,
        automatedReplyEvidenceSource: truncateText(
          normalizeString(message && message.automatedReplyEvidenceSource),
          240
        ),
        softoraConversationId: truncateText(normalizeString(message && message.softoraConversationId), 2000),
        softoraSendIntentId: truncateText(normalizeString(message && message.softoraSendIntentId), 500),
        softoraSendMode: truncateText(normalizeString(message && message.softoraSendMode).toLowerCase(), 40),
        softoraReplyTargetMessageId: truncateText(normalizeString(message && message.softoraReplyTargetMessageId), 1000),
        softoraRecipientFingerprint: truncateText(normalizeString(message && message.softoraRecipientFingerprint), 128),
        softoraPayloadFingerprint: truncateText(normalizeString(message && message.softoraPayloadFingerprint), 128),
        softoraThreadProvenanceKnown: message && message.softoraThreadProvenanceKnown === true,
        ...(normalizeString(message && message.parseStatus) ? {
          parseStatus: truncateText(normalizeString(message.parseStatus), 80),
          parseErrorCode: truncateText(normalizeString(message.parseErrorCode), 120),
          parseErrorReason: truncateText(normalizeString(message.parseErrorReason), 240),
          parseRetryAt: truncateText(normalizeString(message.parseRetryAt), 80),
          bodyUnavailable: message.bodyUnavailable === true,
          providerMetadataEvidenceKnown: message.providerMetadataEvidenceKnown === true,
        } : {}),
      },
      updated_at: isoNow(),
    };
  }

  function normalizeMessageRow(row = {}, options = {}) {
    const folder = normalizeFolder(row.folder);
    const uid = Number(row.uid) || 0;
    const includeBody = options.includeBody === true;
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const softoraReadAt = normalizeString(row.softora_read_at);
    const bodyImageEvidenceKnown = Object.prototype.hasOwnProperty.call(payload, 'embeddedImageCount');
    const inferredAutomatedReplyEvidence = buildAutomatedReplyEvidence({
      autoSubmitted: payload.autoSubmitted,
      precedence: payload.precedence,
      autoResponseSuppress: payload.autoResponseSuppress,
    });
    const hasStoredAutomatedReplyContract =
      payload.automatedReplyEvidenceKnown === true &&
      Boolean(normalizeString(payload.automatedReplyEvidenceSource));
    const normalized = {
      id: normalizeString(row.provider_id) || `${folder}:${uid}`,
      uid,
      uidValidity: normalizeMailboxUidValidity(row.uid_validity),
      folder,
      accountEmail: normalizeEmail(row.account_email),
      from: normalizeString(row.sender_name) || normalizeString(row.sender_email) || 'Onbekend',
      email: normalizeString(row.sender_email),
      to: normalizeString(row.recipients_text),
      toDisplay: normalizeString(payload.toDisplay),
      cc: normalizeString(payload.cc),
      bcc: normalizeString(payload.bcc),
      deliveredTo: normalizeString(payload.deliveredTo),
      recipientRoutingEvidenceKnown: payload.recipientRoutingEvidenceKnown === true || Boolean(normalizeString(row.recipients_text)),
      attachments: normalizeAttachments(payload.attachments),
      autoSubmitted: normalizeString(payload.autoSubmitted),
      precedence: normalizeString(payload.precedence),
      autoResponseSuppress: normalizeString(payload.autoResponseSuppress),
      automatedReplyEvidenceKnown: hasStoredAutomatedReplyContract ||
        inferredAutomatedReplyEvidence.automatedReplyEvidenceKnown,
      automatedReplyEvidence: hasStoredAutomatedReplyContract
        ? payload.automatedReplyEvidence === true
        : inferredAutomatedReplyEvidence.automatedReplyEvidence,
      automatedReplyEvidenceSource: hasStoredAutomatedReplyContract
        ? normalizeString(payload.automatedReplyEvidenceSource)
        : inferredAutomatedReplyEvidence.automatedReplyEvidenceSource,
      softoraConversationId: normalizeString(payload.softoraConversationId),
      softoraSendIntentId: normalizeString(payload.softoraSendIntentId),
      softoraSendMode: normalizeString(payload.softoraSendMode).toLowerCase(),
      softoraReplyTargetMessageId: normalizeString(payload.softoraReplyTargetMessageId),
      softoraRecipientFingerprint: normalizeString(payload.softoraRecipientFingerprint),
      softoraPayloadFingerprint: normalizeString(payload.softoraPayloadFingerprint),
      softoraThreadProvenanceKnown: payload.softoraThreadProvenanceKnown === true,
      parseStatus: normalizeString(payload.parseStatus),
      parseErrorCode: normalizeString(payload.parseErrorCode),
      parseErrorReason: normalizeString(payload.parseErrorReason),
      parseRetryAt: normalizeString(payload.parseRetryAt),
      bodyUnavailable: payload.bodyUnavailable === true,
      providerMetadataEvidenceKnown: payload.providerMetadataEvidenceKnown === true,
      subject: normalizeString(row.subject) || '(Geen onderwerp)',
      preview: normalizeString(row.preview),
      body: includeBody ? normalizeString(row.body_text) : '',
      messageId: normalizeString(row.message_id),
      inReplyTo: normalizeString(row.in_reply_to),
      references: normalizeString(row.references_text),
      date: parseDateIso(row.date || row.internal_date),
      unread: Boolean(row.unread) && !softoraReadAt,
      readAt: softoraReadAt,
      starred: Boolean(row.starred),
      replyDismissedAt: normalizeString(row.reply_dismissed_at),
      hasBody: Boolean(row.has_body),
      bodyTruncated: Boolean(row.body_truncated),
      bodyImageEvidenceKnown,
      embeddedImageCount: bodyImageEvidenceKnown
        ? Math.max(0, Math.min(8, Number(payload.embeddedImageCount) || 0))
        : 0,
      indexed: true,
    };
    const provider = normalizeString(payload.provider || payload.source).toLowerCase();
    if (provider === 'instantly') {
      normalized.provider = 'instantly';
      normalized.providerMessageId = normalizeString(payload.providerMessageId);
      normalized.providerThreadId = normalizeString(payload.providerThreadId);
      normalized.providerCampaignId = normalizeString(payload.providerCampaignId);
      normalized.providerAccountEmail = normalizeEmail(payload.providerAccountEmail || row.account_email);
      normalized.providerOwner = normalizeString(payload.providerOwner).toLowerCase();
      normalized.providerBodyHtmlEvidenceKnown = payload.providerBodyHtmlEvidenceKnown === true;
      normalized.providerRichBodyAvailable = payload.providerRichBodyAvailable === true;
      normalized.providerOriginalBodyEvidenceKnown = payload.providerOriginalBodyEvidenceKnown === true;
      normalized.providerOriginalBodyAvailable = payload.providerOriginalBodyAvailable === true;
      normalized.storageFolder = normalizeFolder(row.folder);
      normalized.storageUid = uid;
      normalized.uid = 0;
      normalized.folder = normalizeString(payload.direction).toLowerCase() === 'sent' ? 'sent' : 'inbox';
      normalized.bodyLoaded = Boolean(row.has_body) && !Boolean(row.body_truncated);
      normalized.hasBody = Boolean(row.has_body);
    }
    normalized.originalCampaignOutbound =
      payload.originalCampaignOutbound === true ||
      isOriginalCampaignOutboundMessage(normalized);
    normalized.webdesignLinkEvidenceKnown =
      payload.webdesignLinkEvidenceKnown === true ||
      Boolean(normalizeString(payload.webdesignLinkUrl));
    normalized.webdesignLinkUrl = normalized.webdesignLinkEvidenceKnown
      ? normalizeString(payload.webdesignLinkUrl)
      : '';
    return normalized;
  }

  const buildProviderMessageRow = createMailboxProviderMessageRowBuilder({
    normalizeString,
    normalizeEmail,
    truncateText,
    stableProviderUid,
    trimBodyForStorage,
    parseDateIso,
    buildProviderMessageKey,
    normalizeAttachments,
    isoNow,
  });

  async function upsertProviderMessages({
    provider, messages = [], signal, mutationId, requestKey,
  } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const rows = (Array.isArray(messages) ? messages : [])
      .map((message) => buildProviderMessageRow({ ...message, provider: normalizedProvider }))
      .filter(Boolean);
    if (!rows.length) return { ok: true, data: [], upserted: 0 };
    const atomicCommit = Boolean(normalizeString(mutationId) || normalizeString(requestKey));
    const result = await run(`upsert-provider-messages:${normalizedProvider}`, (client) => atomicCommit
      ? createMailboxAtomicCommitQuery(client, {
          mutationId, requestKey, rows, result: { provider: normalizedProvider },
        })
      : client.from(MAILBOX_INDEX_TABLES.messages).upsert(rows, {
          onConflict: 'message_key', defaultToNull: false,
        }), { mutationSignal: signal });
    return atomicCommit
      ? normalizeMailboxAtomicCommitResult(result, rows.length)
      : (result.ok ? { ...result, upserted: rows.length } : result);
  }

  async function listProviderMessages({
    provider,
    accountEmails = [],
    limit = 500,
    includeBody = true,
    signal,
  } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    if (!normalizedProvider || !normalizedAccounts.length) return [];
    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    const columns = includeBody
      ? '*'
      : MAILBOX_MESSAGE_METADATA_COLUMNS;
    const result = await run(`list-provider-messages:${normalizedProvider}`, (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select(columns)
        .eq('folder', normalizedProvider)
        .in('account_email', normalizedAccounts)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(safeLimit)
    , { signal });
    if (!result.ok) return null;
    return (result.data || []).map((row) => normalizeMessageRow(row, { includeBody }));
  }

  async function listProviderActiveConversationAuditMessages({
    provider,
    accountEmails = [],
    signal,
  } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    if (!normalizedProvider || !normalizedAccounts.length) return [];

    const activeThreadKeys = new Set();
    for (
      let offset = 0;
      offset < PROVIDER_ACTIVE_THREAD_MAX_COUNT;
      offset += MAILBOX_INDEX_PAGE_SIZE
    ) {
      const result = await run(
        `list-provider-active-thread-ids:${normalizedProvider}:${offset}`,
        (client) =>
          client
            .from(MAILBOX_INDEX_TABLES.messages)
            .select('account_email,payload')
            .eq('folder', normalizedProvider)
            .in('account_email', normalizedAccounts)
            .is('deleted_at', null)
            .order('date', { ascending: false })
            .range(offset, offset + MAILBOX_INDEX_PAGE_SIZE - 1)
      , { signal });
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      page.forEach((row) => {
        const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
        if (normalizeString(payload.direction).toLowerCase() !== 'received') return;
        const accountEmail = normalizeEmail(row && row.account_email);
        const threadId = normalizeString(payload.providerThreadId);
        if (accountEmail && threadId) activeThreadKeys.add(`${accountEmail}|${threadId}`);
      });
      if (page.length < MAILBOX_INDEX_PAGE_SIZE) break;
    }
    if (!activeThreadKeys.size) return [];

    const rowsByKey = new Map();
    for (
      let offset = 0;
      offset < PROVIDER_ACTIVE_THREAD_MAX_COUNT;
      offset += MAILBOX_INDEX_PAGE_SIZE
    ) {
      const result = await run(
        `list-provider-active-audit-messages:${normalizedProvider}:${offset}`,
        (client) =>
          client
            .from(MAILBOX_INDEX_TABLES.messages)
            .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
            .eq('folder', normalizedProvider)
            .in('account_email', normalizedAccounts)
            .contains('payload', { originalCampaignOutbound: true })
            .is('deleted_at', null)
            .order('date', { ascending: false })
            .range(offset, offset + MAILBOX_INDEX_PAGE_SIZE - 1)
      , { signal });
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      page.forEach((row) => {
        const messageKey = normalizeString(row && row.message_key);
        if (messageKey && !rowsByKey.has(messageKey)) rowsByKey.set(messageKey, row);
      });
      if (page.length < MAILBOX_INDEX_PAGE_SIZE) break;
    }

    return Array.from(rowsByKey.values())
      .map((row) => normalizeMessageRow(row))
      .filter((message) => activeThreadKeys.has(
        `${normalizeEmail(message.providerAccountEmail || message.accountEmail)}|${normalizeString(message.providerThreadId)}`
      ));
  }

  async function getProviderMessage({ provider, providerMessageId, accountEmail, signal } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const rawProviderMessageId = normalizeString(providerMessageId);
    const normalizedProviderMessageId = rawProviderMessageId.startsWith(`${normalizedProvider}:`)
      ? rawProviderMessageId.slice(normalizedProvider.length + 1)
      : rawProviderMessageId;
    const normalizedAccountEmail = normalizeEmail(accountEmail);
    if (!normalizedProvider || !normalizedProviderMessageId || !normalizedAccountEmail) return null;
    const result = await run(`get-provider-message:${normalizedProvider}`, (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select('*')
        .eq('account_email', normalizedAccountEmail)
        .eq('folder', normalizedProvider)
        .eq('provider_id', `${normalizedProvider}:${normalizedProviderMessageId}`)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
    , { signal });
    if (!result.ok || !result.data) return null;
    return normalizeMessageRow(result.data, { includeBody: true });
  }

  async function listMessages({ accountEmail, folder = 'inbox', limit = 50 }) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const result = await run('list-messages', (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
        .eq('account_email', normalizeEmail(accountEmail))
        .eq('folder', normalizeFolder(folder))
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(safeLimit)
    );
    if (!result.ok) return null;
    return (result.data || []).map((row) => normalizeMessageRow(row));
  }

  async function listMessagesForAccounts({ accountEmails = [], folder = 'inbox', limit = 1000 }) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    if (!normalizedAccounts.length) return [];
    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 1000));
    const result = await run('list-messages-for-accounts', (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
        .in('account_email', normalizedAccounts)
        .eq('folder', normalizeFolder(folder))
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(safeLimit)
    );
    if (!result.ok) return null;
    return (result.data || []).map((row) => normalizeMessageRow(row));
  }

  async function listAllMessagesForAccounts({ accountEmails = [], folder = 'inbox', limit = null, signal } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    if (!normalizedAccounts.length) return [];
    const normalizedFolder = normalizeFolder(folder);
    const requestedLimit = Number(limit);
    const hasLimit = Number.isFinite(requestedLimit) && requestedLimit > 0;
    const safeLimit = hasLimit ? Math.max(1, Math.floor(requestedLimit)) : Number.POSITIVE_INFINITY;
    const rows = [];
    for (let offset = 0; offset < safeLimit; offset += MAILBOX_INDEX_PAGE_SIZE) {
      const pageSize = Math.min(MAILBOX_INDEX_PAGE_SIZE, safeLimit - offset);
      const result = await run(`list-all-messages-for-accounts:${normalizedFolder}:${offset}`, (client) =>
        client
          .from(MAILBOX_INDEX_TABLES.messages)
          .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
          .in('account_email', normalizedAccounts)
          .eq('folder', normalizedFolder)
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .order('message_key', { ascending: false })
          .range(offset, offset + pageSize - 1), { signal }
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return (hasLimit ? rows.slice(0, safeLimit) : rows).map((row) => normalizeMessageRow(row));
  }

  async function listMatchingMessagesForAccounts({
    accountEmails = [], folder = 'inbox', subjectTerms = [], limit = 1000, signal,
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const terms = Array.from(
      new Set((Array.isArray(subjectTerms) ? subjectTerms : []).map(normalizeString).filter(Boolean))
    );
    if (!normalizedAccounts.length || !terms.length) return [];
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = Math.max(1, Math.min(4000, Math.floor(Number(limit) || 1000)));
    const rowsByKey = new Map();

    for (const term of terms) {
      for (let offset = 0; offset < safeLimit; offset += MAILBOX_INDEX_PAGE_SIZE) {
        const pageSize = Math.min(MAILBOX_INDEX_PAGE_SIZE, safeLimit - offset);
        const result = await run(
          `list-matching-messages-for-accounts:${normalizedFolder}:${offset}`,
          (client) =>
            client
              .from(MAILBOX_INDEX_TABLES.messages)
              .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
              .in('account_email', normalizedAccounts)
              .eq('folder', normalizedFolder)
              .ilike('subject', `%${term}%`)
              .is('deleted_at', null)
              .order('date', { ascending: false })
              .order('message_key', { ascending: false })
              .range(offset, offset + pageSize - 1),
          { signal }
        );
        if (!result.ok) return null;
        const page = Array.isArray(result.data) ? result.data : [];
        page.forEach((row) => {
          const key = normalizeString(row && row.message_key);
          if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
        });
        if (page.length < pageSize) break;
      }
    }

    return Array.from(rowsByKey.values())
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .slice(0, safeLimit)
      .map((row) => normalizeMessageRow(row));
  }

  async function listMessagesByMessageIdsForAccounts({
    accountEmails = [],
    folder = 'sent',
    messageIds = [],
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedMessageIds = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).map(normalizeString).filter(Boolean))
    ).slice(0, 2000);
    if (!normalizedAccounts.length || !normalizedMessageIds.length) return [];
    const normalizedFolder = normalizeFolder(folder);
    const rowsByKey = new Map();
    for (let offset = 0; offset < normalizedMessageIds.length; offset += MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE) {
      const batch = normalizedMessageIds.slice(offset, offset + MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE);
      const result = await run(`list-messages-by-message-id:${normalizedFolder}:${offset}`, (client) =>
        client
          .from(MAILBOX_INDEX_TABLES.messages)
          .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
          .in('account_email', normalizedAccounts)
          .eq('folder', normalizedFolder)
          .in('message_id', batch)
          .is('deleted_at', null)
      );
      if (!result.ok) return null;
      (Array.isArray(result.data) ? result.data : []).forEach((row) => {
        const key = normalizeString(row && row.message_key);
        if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
      });
    }
    return Array.from(rowsByKey.values())
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .map((row) => normalizeMessageRow(row));
  }

  async function hydrateMessageBodies({ messages = [] } = {}) {
    const source = Array.isArray(messages) ? messages : [];
    const messageKeys = Array.from(
      new Set(
        source
          .map((message) => {
            const uid = Number(message && message.uid) || 0;
            if (!uid) return '';
            return buildMessageKey(
              message.accountEmail,
              message.folder,
              uid,
              message.uidValidity
            );
          })
          .filter(Boolean)
      )
    ).slice(0, 100);
    const providerReferences = source
      .filter((message) => normalizeFolder(message && message.folder) === 'instantly')
      .map((message) => ({
        accountEmail: normalizeEmail(message && message.accountEmail),
        providerId: normalizeString(message && message.id),
      }))
      .filter((message) => message.accountEmail && /^instantly:[a-z0-9-]+$/i.test(message.providerId));
    if (!messageKeys.length && !providerReferences.length) return source;

    const selectedColumns = 'message_key,account_email,provider_id,body_text,has_body,body_truncated,payload,folder,subject,preview,in_reply_to,references_text,recipients_text';
    const [messageResult, providerResult] = await Promise.all([
      messageKeys.length
        ? run('hydrate-message-bodies', (client) =>
            client
              .from(MAILBOX_INDEX_TABLES.messages)
              .select(selectedColumns)
              .in('message_key', messageKeys)
              .is('deleted_at', null)
          )
        : Promise.resolve({ ok: true, data: [] }),
      providerReferences.length
        ? run('hydrate-provider-message-bodies', (client) =>
            client
              .from(MAILBOX_INDEX_TABLES.messages)
              .select(selectedColumns)
              .eq('folder', 'instantly')
              .in('account_email', Array.from(new Set(providerReferences.map((message) => message.accountEmail))))
              .in('provider_id', Array.from(new Set(providerReferences.map((message) => message.providerId))))
              .is('deleted_at', null)
          )
        : Promise.resolve({ ok: true, data: [] }),
    ]);
    if (!messageResult.ok && !providerResult.ok) return source;

    const bodyByMessageKey = new Map(
      (messageResult.data || []).map((row) => [normalizeString(row.message_key), row])
    );
    const bodyByProviderIdentity = new Map(
      (providerResult.data || []).map((row) => [
        `${normalizeEmail(row.account_email)}|${normalizeString(row.provider_id)}`,
        row,
      ])
    );
    return source.map((message) => {
      const uid = Number(message && message.uid) || 0;
      const folder = normalizeFolder(message && message.folder);
      const messageKey = uid && folder !== 'instantly'
        ? buildMessageKey(message.accountEmail, folder, uid, message.uidValidity)
        : '';
      const providerIdentity = folder === 'instantly'
        ? `${normalizeEmail(message && message.accountEmail)}|${normalizeString(message && message.id)}`
        : '';
      const row = bodyByMessageKey.get(messageKey) || bodyByProviderIdentity.get(providerIdentity);
      if (!row) return { ...message, bodyResolved: false };
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const bodyImageEvidenceKnown = Object.prototype.hasOwnProperty.call(payload, 'embeddedImageCount');
      const body = normalizeString(row.body_text);
      return {
        ...message,
        bodyResolved: true,
        body,
        hasBody: Boolean(row.has_body),
        bodyTruncated: Boolean(row.body_truncated),
        bodyImageEvidenceKnown,
        embeddedImageCount: bodyImageEvidenceKnown
          ? Math.max(0, Math.min(8, Number(payload.embeddedImageCount) || 0))
          : 0,
        originalCampaignOutbound:
          payload.originalCampaignOutbound === true ||
          isOriginalCampaignOutboundMessage({
            folder: row.folder || message.folder,
            subject: row.subject,
            preview: row.preview,
            body,
            inReplyTo: row.in_reply_to,
            references: row.references_text,
          }),
        webdesignLinkEvidenceKnown:
          payload.webdesignLinkEvidenceKnown === true ||
          Boolean(normalizeString(payload.webdesignLinkUrl)),
        webdesignLinkUrl: normalizeString(payload.webdesignLinkUrl),
        to: normalizeString(row.recipients_text || message.to),
        toDisplay: normalizeString(payload.toDisplay),
        cc: normalizeString(payload.cc),
        bcc: normalizeString(payload.bcc),
        deliveredTo: normalizeString(payload.deliveredTo),
        recipientRoutingEvidenceKnown: payload.recipientRoutingEvidenceKnown === true || Boolean(normalizeString(row.recipients_text || message.to)),
        attachments: normalizeAttachments(payload.attachments),
      };
    });
  }

  async function getMessage({ accountEmail, folder = 'inbox', id = '', uid = 0, uidValidity = 0, includeDeleted = false }) {
    let reference;
    try {
      reference = resolveMailboxMessageActionReference({ accountEmail, folder, id, uid, uidValidity }, { normalizeEmail, normalizeFolder, normalizeString });
    } catch (error) {
      if (error.code === 'MAILBOX_UIDVALIDITY_REQUIRED') return null;
      throw error;
    }
    const query = (client) => {
      const base = client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select('*')
        .limit(1);
      return applyMailboxMessageActionReference(base, reference, { activeOnly: includeDeleted !== true })
        .maybeSingle();
    };
    const result = await run('get-message', query);
    if (!result.ok || !result.data) return null;
    return normalizeMessageRow(result.data, { includeBody: true });
  }

  async function listUnthreadedSentCandidatesForConversations({ targets = [], limit = 1000 } = {}) {
    const normalizedTargets = (Array.isArray(targets) ? targets : [])
      .map((target) => ({
        conversation_id: normalizeString(target && target.conversationId),
        account_email: normalizeEmail(target && target.accountEmail),
        counterparty_email: normalizeEmail(target && target.counterpartyEmail),
        canonical_subject: normalizeString(target && target.canonicalSubject).toLowerCase(),
        latest_inbound_at: parseDateIso(target && target.latestInboundAt),
      }))
      .filter((target) => (
        target.conversation_id &&
        target.account_email &&
        target.counterparty_email &&
        target.canonical_subject &&
        target.latest_inbound_at
      ));
    if (!normalizedTargets.length) return [];
    const result = await run('list-unthreaded-sent-candidates', (client) =>
      client.rpc('softora_find_mailbox_unthreaded_sent_candidates', {
        p_targets: normalizedTargets,
        p_limit: Math.max(1, Math.min(3000, Number(limit) || 1000)),
      })
    );
    if (!result.ok) return [];
    return (Array.isArray(result.data) ? result.data : [])
      .map((row) => {
        const message = row && row.message && typeof row.message === 'object' ? row.message : null;
        if (!message) return null;
        return {
          targetConversationId: normalizeString(row.target_conversation_id),
          message: normalizeMessageRow(message, { includeBody: true }),
        };
      })
      .filter(Boolean);
  }

  async function getOldestMatchingMessageUid({
    accountEmail, folder = 'inbox', subjectTerms = [], signal,
  } = {}) {
    const terms = Array.from(
      new Set(
        (Array.isArray(subjectTerms) ? subjectTerms : [])
          .map(normalizeString)
          .filter(Boolean)
      )
    );
    if (!terms.length) return 0;

    let oldestUid = 0;
    for (const term of terms) {
      const result = await run(`get-oldest-matching-message-uid:${normalizeFolder(folder)}`, (client) =>
        client
          .from(MAILBOX_INDEX_TABLES.messages)
          .select('uid')
          .eq('account_email', normalizeEmail(accountEmail))
          .eq('folder', normalizeFolder(folder))
          .ilike('subject', `%${term}%`)
          .order('uid', { ascending: true })
          .limit(1),
        { signal }
      );
      if (!result.ok) return 0;
      const uid = Number(result.data?.[0]?.uid) || 0;
      if (uid > 0 && (!oldestUid || uid < oldestUid)) oldestUid = uid;
    }
    return oldestUid;
  }

  async function upsertMessages({
    accountEmail, folder = 'inbox', messages = [], signal, mutationId, requestKey,
    syncLockToken = '', uidValidity = 0,
  } = {}) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    const generation = resolveMailboxBatchUidValidity(sourceMessages, uidValidity);
    if (!generation.ok) {
      return { ok: false, unavailable: false, data: null, error: generation.error };
    }
    const normalizedUidValidity = generation.uidValidity;
    const rows = sourceMessages.map(
      (message, index) => buildMessageRow(
        message, accountEmail, folder, index, normalizedUidValidity
      )
    )
      .filter((row) => row.uid > 0);
    const atomicCommit = Boolean(normalizeString(mutationId) || normalizeString(requestKey));
    if (!rows.length && !atomicCommit) return { ok: true, data: [], upserted: 0 };
    const result = await run('upsert-messages', (client) => atomicCommit
      ? createMailboxAtomicCommitQuery(client, {
          mutationId,
          requestKey,
          rows,
          result: {
            source: 'imap-sync',
            syncLockToken: normalizeString(syncLockToken),
            uidValidity: normalizedUidValidity,
          },
        })
      : client.from(MAILBOX_INDEX_TABLES.messages).upsert(rows, {
          onConflict: 'message_key', defaultToNull: false,
        }), { mutationSignal: signal });
    return atomicCommit
      ? normalizeMailboxAtomicCommitResult(result, rows.length)
      : (result.ok ? { ...result, upserted: rows.length } : result);
  }

  async function markMessageRead({ accountEmail, folder = 'inbox', id = '', uid = 0, uidValidity = 0 }) {
    let reference;
    try {
      reference = resolveMailboxMessageActionReference({ accountEmail, folder, id, uid, uidValidity }, { normalizeEmail, normalizeFolder, normalizeString });
    } catch (error) {
      return { ok: false, unavailable: false, data: [], error, readAt: '' };
    }
    const readAt = isoNow();
    const result = await run('mark-message-read', (client) => {
      const query = applyMailboxMessageActionReference(client
        .from(MAILBOX_INDEX_TABLES.messages)
        .update({ unread: false, softora_read_at: readAt, updated_at: readAt }), reference, {
        activeOnly: true,
      });
      return query.select('message_key,softora_read_at');
    });
    if (!result.ok) return { ...result, readAt: '' };
    if (!Array.isArray(result.data) || !result.data.length) {
      return { ...createMailboxActionNotFoundResult(reference, 'Mailboxbericht ontbreekt in de duurzame index.'), readAt: '' };
    }
    return { ...result, readAt };
  }

  async function markMessageReplyDismissed({ accountEmail, folder = 'inbox', id = '', uid = 0, uidValidity = 0 }) {
    let reference;
    try {
      reference = resolveMailboxMessageActionReference({ accountEmail, folder, id, uid, uidValidity }, { normalizeEmail, normalizeFolder, normalizeString });
    } catch (error) {
      return { ok: false, unavailable: false, data: [], error, dismissedAt: '' };
    }
    const dismissedAt = isoNow();
    const result = await run('mark-message-reply-dismissed', (client) => {
      const query = applyMailboxMessageActionReference(client
        .from(MAILBOX_INDEX_TABLES.messages)
        .update({
          unread: false,
          softora_read_at: dismissedAt,
          reply_dismissed_at: dismissedAt,
          updated_at: dismissedAt,
        }), reference, { activeOnly: true });
      return query.select('message_key,reply_dismissed_at');
    });
    if (!result.ok || (Array.isArray(result.data) && result.data.length)) {
      return { ...result, dismissedAt };
    }
    return {
      ...createMailboxActionNotFoundResult(reference, 'Mailboxbericht ontbreekt in de duurzame index.'),
      dismissedAt: '',
    };
  }

  async function markMessageDeleted({ accountEmail, folder = 'inbox', id = '', uid = 0, uidValidity = 0 }) {
    let reference;
    try {
      reference = resolveMailboxMessageActionReference({ accountEmail, folder, id, uid, uidValidity }, { normalizeEmail, normalizeFolder, normalizeString });
    } catch (error) {
      return { ok: false, unavailable: false, data: [], error };
    }
    const result = await run('mark-message-deleted', (client) => {
      const deletedAt = isoNow();
      const query = applyMailboxMessageActionReference(client
        .from(MAILBOX_INDEX_TABLES.messages)
        .update({ deleted_at: deletedAt, updated_at: deletedAt }), reference);
      return query.select('message_key');
    });
    if (!result.ok || (Array.isArray(result.data) && result.data.length)) return result;
    return createMailboxActionNotFoundResult(reference, 'Mailboxbericht ontbreekt in de duurzame index.');
  }

  async function restoreMessage({ accountEmail, folder = 'inbox', id = '', uid = 0, uidValidity = 0 }) {
    let reference;
    try {
      reference = resolveMailboxMessageActionReference({ accountEmail, folder, id, uid, uidValidity }, { normalizeEmail, normalizeFolder, normalizeString });
    } catch (error) {
      return { ok: false, unavailable: false, data: [], error };
    }
    const result = await run('restore-message', (client) => {
      const query = applyMailboxMessageActionReference(client
        .from(MAILBOX_INDEX_TABLES.messages)
        .update({ deleted_at: null, updated_at: isoNow() }), reference);
      return query.select('message_key');
    });
    if (!result.ok || (Array.isArray(result.data) && result.data.length)) return result;
    return createMailboxActionNotFoundResult(
      reference,
      'Verborgen Softora-mailboxbericht is niet gevonden.',
      'MAILBOX_INDEX_HIDDEN_MESSAGE_NOT_FOUND'
    );
  }

  async function getSyncState({ accountEmail, folder = 'inbox', signal } = {}) {
    const syncKey = buildSyncKey(accountEmail, folder);
    const result = await run('get-sync-state', (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.syncState)
        .select('*')
        .eq('sync_key', syncKey)
        .limit(1)
        .maybeSingle()
    , { signal });
    if (!result.ok) return null;
    return result.data || null;
  }

  function isSyncStateStale(state, maxAgeMs) {
    const syncedAt = Date.parse(normalizeString(state && state.last_synced_at));
    if (!Number.isFinite(syncedAt)) return true;
    return now().getTime() - syncedAt > Math.max(1_000, Number(maxAgeMs) || 120_000);
  }

  const listMessagesReferencingMessageIdsForAccounts = createMailboxMessageReferenceLookup({
    run,
    tableName: MAILBOX_INDEX_TABLES.messages,
    metadataColumns: MAILBOX_MESSAGE_METADATA_COLUMNS,
    normalizeString,
    normalizeEmail,
    normalizeFolder,
    normalizeMessageRow,
  });
  const listCampaignLineageMessages = createMailboxCampaignLineageLookup({
    run,
    normalizeString,
    normalizeEmail,
    normalizeMessageRow,
  });
  const listSentCandidatesForQuotedReplies = createMailboxQuotedSentCandidateLookup({ run, tableName: MAILBOX_INDEX_TABLES.messages, normalizeString, normalizeEmail, normalizeMessageRow });

  return {
    BODY_MAX_CHARS,
    BODY_RETENTION_DAYS,
    BODY_RETENTION_NEWEST_COUNT,
    MAILBOX_INDEX_TABLES,
    acquireSyncLock,
    buildMessageKey,
    buildMessageRow,
    buildProviderMessageKey,
    buildProviderMessageRow,
    buildSyncKey,
    finishSync,
    getMessage,
    getMessageForAction: (input) => getMessage({ ...input, includeDeleted: true }),
    getProviderMessage,
    getOldestMatchingMessageUid,
    getSyncState,
    hydrateMessageBodies,
    isAvailable,
    isSyncStateStale,
    listAllMessagesForAccounts,
    listCampaignLineageMessages,
    listMatchingMessagesForAccounts,
    listMessagesByMessageIdsForAccounts,
    listSentCandidatesForQuotedReplies,
    listMessagesReferencingMessageIdsForAccounts,
    listUnthreadedSentCandidatesForConversations,
    listMessageUidSyncStateForAccount,
    listMessageUidsForAccount,
    listMessages,
    listMessagesForAccounts,
    listProviderMessages,
    listProviderActiveConversationAuditMessages,
    markMessageDeleted,
    markMessageRead,
    markMessageReplyDismissed,
    prepareUidValidity, releaseSyncLock, restoreMessage,
    normalizeMessageRow,
    stableProviderUid,
    upsertMessages,
    upsertProviderMessages,
  };
}

module.exports = {
  BODY_MAX_CHARS,
  BODY_RETENTION_DAYS,
  BODY_RETENTION_NEWEST_COUNT,
  MAILBOX_INDEX_PAGE_SIZE,
  MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE,
  MAILBOX_INDEX_TABLES,
  createMailboxIndexStore,
};

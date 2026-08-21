const crypto = require('crypto');
const { deduplicateRowsByKey } = require('./mailbox-index-message-rows');
const { createMailboxStateMutationStore } = require('../repositories/mailbox-state-mutation-store');
const {
  isOriginalCampaignOutboundMessage,
} = require('./mailbox-image-ownership');
const {
  createMailboxMessageReferenceLookup,
} = require('../repositories/mailbox-message-reference-lookup');
const { createMailboxQuotedSentCandidateLookup } = require('../repositories/mailbox-quoted-sent-candidate-lookup');
const { createMailboxIndexTargetedLookups } = require('../repositories/mailbox-index-targeted-lookups');
const { createMailboxIndexVisibilityStore } = require('./mailbox-index-visibility-store');
const { buildMailboxMessageKey, normalizeMailboxGenerationId,
  normalizeMailboxUidValidity } = require('./mailbox-uid-validity');
const { createMailboxUidGenerationIndex } = require('./mailbox-uid-generation-index');
const { createMailboxLegacySyncFinalizer } = require('./mailbox-sync-legacy-finalizer');
const { createMailboxSyncProtocolLockStore } = require('./mailbox-sync-protocol-lock');
const MAILBOX_INDEX_TABLES = Object.freeze({
  messages: 'softora_mailbox_messages',
  syncState: 'softora_mailbox_sync_state',
});

const BODY_RETENTION_DAYS = 90;
const BODY_RETENTION_NEWEST_COUNT = 500;
const BODY_MAX_CHARS = 200 * 1024;
const SYNC_LOCK_TTL_MS = 90_000;
const MAILBOX_INDEX_PAGE_SIZE = 1000;
const MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE = 100;
const PROVIDER_ACTIVE_THREAD_LOOKUP_BATCH_SIZE = 100;
const PROVIDER_ACTIVE_THREAD_MAX_COUNT = 10_000;
const DURABLE_WRITE_CLIENT_TIMEOUT_MS = 8_000;
const DURABLE_WRITE_QUERY_TIMEOUT_MS = 10_000;
const MAILBOX_MESSAGE_METADATA_COLUMNS =
  'message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,references_text,sender_name,sender_email,recipients_text,subject,preview,date,internal_date,unread,softora_read_at,state_revision,state_mutation_key,state_mutation_at,starred,reply_dismissed_at,has_body,body_truncated,payload';

function createMailboxIndexStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    logger = console,
    now = () => new Date(),
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    mailboxIndexQueryTimeoutMs = 2500,
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
    return /(?:abort|timeout|timed out|fetch failed|network|econnreset|etimedout|temporar|serializ)/i.test(text);
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

  function getSafeQueryTimeoutMs(timeoutOverrideMs = null) {
    const rawTimeout = timeoutOverrideMs === null || timeoutOverrideMs === undefined
      ? mailboxIndexQueryTimeoutMs
      : timeoutOverrideMs;
    return Math.max(250, Math.min(10_000, Number(rawTimeout) || 2500));
  }

  function createTimeoutError(label, timeoutOverrideMs = null) {
    const timeoutMs = getSafeQueryTimeoutMs(timeoutOverrideMs);
    const error = new Error(`Mailbox index ${label} timeout na ${timeoutMs}ms`);
    error.code = 'MAILBOX_INDEX_TIMEOUT';
    return error;
  }

  async function withQueryTimeout(promise, label, timeoutOverrideMs = null) {
    const timeoutMs = getSafeQueryTimeoutMs(timeoutOverrideMs);
    let timeoutId = null;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(createTimeoutError(label, timeoutOverrideMs)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function run(
    label,
    operation,
    { bypassFailureCooldown = false, suppressFailureCooldown = false, clientOptions = {}, queryTimeoutMs = null } = {}
  ) {
    const client = getClient(clientOptions);
    if (!client) return { ok: false, unavailable: true, data: null, error: new Error('Supabase niet geconfigureerd') };
    if (isFailureCooldownActive() && !bypassFailureCooldown) {
      return { ok: false, unavailable: false, data: null, error: createFailureCooldownError() };
    }
    try {
      const result = await withQueryTimeout(operation(client), label, queryTimeoutMs);
      if (result && result.error) throw result.error;
      if (!suppressFailureCooldown) { failureCooldownUntilMs = 0; failureCooldownReason = ''; }
      return { ok: true, data: result ? result.data : null, count: result ? result.count : null };
    } catch (error) {
      if (!isUnavailableError(error)) {
        if (isSoftIndexError(error)) {
          if (!suppressFailureCooldown) openFailureCooldown(error);
          logSoftIndexError(label, error);
        } else {
          logger.error(`[MailboxIndex][${label}]`, error?.message || error);
        }
      }
      return { ok: false, unavailable: isUnavailableError(error), data: null, error };
    }
  }

  async function runDurableWrite(label, operation, { deadlineAtMs = null } = {}) {
    const execute = () => {
      const absoluteDeadlineAtMs = Number(deadlineAtMs);
      const queryTimeoutMs = Number.isFinite(absoluteDeadlineAtMs) && absoluteDeadlineAtMs > 0
        ? Math.max(0, Math.min(DURABLE_WRITE_QUERY_TIMEOUT_MS, absoluteDeadlineAtMs - now().getTime()))
        : DURABLE_WRITE_QUERY_TIMEOUT_MS;
      if (queryTimeoutMs < 250) {
        const error = new Error(`Mailbox durable write ${label} deadline bereikt.`);
        error.code = 'MAILBOX_DURABLE_WRITE_DEADLINE_EXHAUSTED';
        return Promise.resolve({ ok: false, unavailable: false, data: null, error });
      }
      return run(label, operation, {
        bypassFailureCooldown: true,
        clientOptions: {
          timeoutMs: DURABLE_WRITE_CLIENT_TIMEOUT_MS,
          ignoreFailureCooldown: true, suppressFailureCooldown: true,
        },
        queryTimeoutMs,
      });
    };
    const first = await execute();
    return first.ok || !isSoftIndexError(first.error) ? first : execute();
  }

  async function runPriorityRead(label, operation) {
    const execute = () => run(label, operation, {
      bypassFailureCooldown: true,
      suppressFailureCooldown: true,
      clientOptions: {
        timeoutMs: DURABLE_WRITE_CLIENT_TIMEOUT_MS,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      },
      queryTimeoutMs: DURABLE_WRITE_QUERY_TIMEOUT_MS,
    });
    const first = await execute();
    return first.ok || !isSoftIndexError(first.error) ? first : execute();
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

  function normalizeAttachments(value) {
    return (Array.isArray(value) ? value : []).slice(0, 20).map((attachment) => ({
      filename: truncateText(normalizeString(attachment && attachment.filename) || 'Bijlage', 180),
      contentType: truncateText(normalizeString(attachment && attachment.contentType), 120),
      size: Math.max(0, Number(attachment && attachment.size) || 0),
    }));
  }

  function buildMessageKey(accountEmail, folder, uid, generationId = null) {
    return buildMailboxMessageKey({ accountEmail: normalizeEmail(accountEmail),
      folder: normalizeFolder(folder), uid, generationId });
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

  function buildMessageRow(message, accountEmail, folder, index = 0, options = {}) {
    const normalizedFolder = normalizeFolder(folder || message?.folder);
    const uid = parseUidFromMessage(message);
    const uidValidity = normalizeMailboxUidValidity(options.uidValidity || message?.uidValidity);
    const generationId = normalizeMailboxGenerationId(options.generationId || message?.uidGenerationId);
    const dateIso = parseDateIso(message && message.date);
    const body = trimBodyForStorage(message, index);
    return {
      message_key: buildMessageKey(accountEmail, normalizedFolder, uid, generationId),
      account_email: normalizeEmail(accountEmail),
      folder: normalizedFolder,
      uid,
      ...(uidValidity ? { uid_validity: uidValidity } : {}),
      ...(generationId ? { uid_generation_id: generationId } : {}),
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
        replyTo: truncateText(normalizeString(message && message.replyTo), 320),
        toDisplay: truncateText(normalizeString(message && message.toDisplay), 2000),
        cc: truncateText(normalizeString(message && message.cc), 2000),
        bcc: truncateText(normalizeString(message && message.bcc), 2000),
        deliveredTo: truncateText(normalizeString(message && message.deliveredTo), 1000),
        attachments: normalizeAttachments(message && message.attachments),
        autoSubmitted: truncateText(normalizeString(message && message.autoSubmitted), 200),
        precedence: truncateText(normalizeString(message && message.precedence), 120),
        autoResponseSuppress: truncateText(normalizeString(message && message.autoResponseSuppress), 200),
        automatedReplyEvidence: message && message.automatedReplyEvidence === true,
        softoraConversationId: truncateText(normalizeString(message && message.softoraConversationId), 2000),
        softoraSendIntentId: truncateText(normalizeString(message && message.softoraSendIntentId), 500),
        softoraSendMode: truncateText(normalizeString(message && message.softoraSendMode).toLowerCase(), 40),
        softoraReplyTargetMessageId: truncateText(normalizeString(message && message.softoraReplyTargetMessageId), 1000),
        softoraThreadProvenanceKnown: message && message.softoraThreadProvenanceKnown === true,
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
    const normalized = {
      id: normalizeString(row.provider_id) || `${folder}:${uid}`,
      uid,
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
      replyTo: normalizeString(payload.replyTo),
      attachments: normalizeAttachments(payload.attachments),
      autoSubmitted: normalizeString(payload.autoSubmitted),
      precedence: normalizeString(payload.precedence),
      autoResponseSuppress: normalizeString(payload.autoResponseSuppress),
      automatedReplyEvidence: payload.automatedReplyEvidence === true,
      softoraConversationId: normalizeString(payload.softoraConversationId),
      softoraSendIntentId: normalizeString(payload.softoraSendIntentId),
      softoraSendMode: normalizeString(payload.softoraSendMode).toLowerCase(),
      softoraReplyTargetMessageId: normalizeString(payload.softoraReplyTargetMessageId),
      softoraThreadProvenanceKnown: payload.softoraThreadProvenanceKnown === true,
      subject: normalizeString(row.subject) || '(Geen onderwerp)',
      preview: normalizeString(row.preview),
      body: includeBody ? normalizeString(row.body_text) : '',
      messageId: normalizeString(row.message_id),
      inReplyTo: normalizeString(row.in_reply_to),
      references: normalizeString(row.references_text),
      date: parseDateIso(row.date || row.internal_date),
      unread: Boolean(row.unread) && !softoraReadAt,
      readAt: softoraReadAt,
      stateRevision: Math.max(0, Number(row.state_revision) || 0),
      stateMutationKey: normalizeString(row.state_mutation_key),
      stateMutationAt: normalizeString(row.state_mutation_at),
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

  function buildProviderMessageRow(message = {}) {
    const provider = normalizeString(message.provider).toLowerCase();
    const providerId = normalizeString(message.providerMessageId || message.id);
    const accountEmail = normalizeEmail(message.accountEmail || message.providerAccountEmail);
    const owner = normalizeString(message.providerOwner).toLowerCase();
    if (!provider || !providerId || !accountEmail || !owner) return null;
    const uid = stableProviderUid(provider, providerId);
    const body = trimBodyForStorage(message, 0);
    const dateIso = parseDateIso(message.date || message.receivedAt);
    return {
      message_key: buildProviderMessageKey(provider, providerId),
      account_email: accountEmail,
      folder: provider,
      uid,
      provider_id: `${provider}:${providerId}`,
      message_id: normalizeString(message.messageId),
      in_reply_to: normalizeString(message.inReplyTo),
      references_text: normalizeString(message.references),
      sender_name: truncateText(normalizeString(message.from), 240),
      sender_email: truncateText(normalizeEmail(message.email), 320),
      recipients_text: truncateText(normalizeString(message.to), 1000),
      subject: truncateText(normalizeString(message.subject) || '(Geen onderwerp)', 500),
      preview: truncateText(normalizeString(message.preview), 500),
      body_text: body.text,
      body_truncated: body.truncated,
      has_body: body.hasBody,
      date: dateIso,
      internal_date: dateIso,
      unread: Boolean(message.unread),
      starred: Boolean(message.starred),
      payload: {
        source: provider,
        provider,
        providerMessageId: providerId,
        providerThreadId: truncateText(normalizeString(message.providerThreadId), 500),
        providerCampaignId: truncateText(normalizeString(message.providerCampaignId), 500),
        providerAccountEmail: accountEmail,
        providerOwner: owner,
        direction: normalizeString(message.folder || message.direction).toLowerCase() === 'sent'
          ? 'sent'
          : 'received',
        recipientRoutingEvidenceKnown: message.recipientRoutingEvidenceKnown === true,
        toDisplay: truncateText(normalizeString(message.toDisplay || message.to), 2000),
        cc: truncateText(normalizeString(message.cc), 2000),
        bcc: truncateText(normalizeString(message.bcc), 2000),
        deliveredTo: truncateText(normalizeString(message.deliveredTo), 1000),
        attachments: normalizeAttachments(message.attachments),
        autoSubmitted: truncateText(normalizeString(message.autoSubmitted), 200),
        precedence: truncateText(normalizeString(message.precedence), 120),
        autoResponseSuppress: truncateText(normalizeString(message.autoResponseSuppress), 200),
        automatedReplyEvidence: message.automatedReplyEvidence === true,
        attachmentSource: provider,
        originalCampaignOutbound: message.originalCampaignOutbound === true,
        providerBodyHtmlEvidenceKnown: message.providerBodyHtmlEvidenceKnown === true,
        providerRichBodyAvailable: message.providerRichBodyAvailable === true,
        providerOriginalBodyEvidenceKnown: message.providerOriginalBodyEvidenceKnown === true,
        providerOriginalBodyAvailable: message.providerOriginalBodyAvailable === true,
        webdesignLinkEvidenceKnown: message.webdesignLinkEvidenceKnown === true,
        webdesignLinkUrl: truncateText(normalizeString(message.webdesignLinkUrl), 4000),
      },
      updated_at: isoNow(),
    };
  }

  async function upsertProviderMessages({ provider, messages = [] } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const rows = (Array.isArray(messages) ? messages : [])
      .map((message) => buildProviderMessageRow({ ...message, provider: normalizedProvider }))
      .filter(Boolean);
    if (!rows.length) return { ok: true, data: [], upserted: 0 };
    const result = await runDurableWrite(`upsert-provider-messages:${normalizedProvider}`, (client) =>
      client.from(MAILBOX_INDEX_TABLES.messages).upsert(rows, {
        onConflict: 'message_key',
        defaultToNull: false,
      })
    );
    if (!result.ok) return result;
    return { ...result, upserted: rows.length };
  }

  async function listProviderMessages({
    provider,
    accountEmails = [],
    limit = 500,
    includeBody = true,
    priorityRead = false,
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
    const read = priorityRead ? runPriorityRead : run;
    const result = await read(`list-provider-messages:${normalizedProvider}`, (client) =>
      client
        .from(MAILBOX_INDEX_TABLES.messages)
        .select(columns)
        .eq('folder', normalizedProvider)
        .in('account_email', normalizedAccounts)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(safeLimit)
    );
    if (!result.ok) return null;
    return (result.data || []).map((row) => normalizeMessageRow(row, { includeBody }));
  }

  async function listProviderActiveConversationAuditMessages({
    provider,
    accountEmails = [],
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
            .select('account_email,provider_thread_id:payload->>providerThreadId')
            .eq('folder', normalizedProvider)
            .in('account_email', normalizedAccounts)
            .eq('payload->>direction', 'received')
            .is('deleted_at', null)
            .order('date', { ascending: false })
            .range(offset, offset + MAILBOX_INDEX_PAGE_SIZE - 1)
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      page.forEach((row) => {
        const accountEmail = normalizeEmail(row && row.account_email);
        const threadId = normalizeString(row && row.provider_thread_id);
        if (accountEmail && threadId) activeThreadKeys.add(`${accountEmail}|${threadId}`);
      });
      if (page.length < MAILBOX_INDEX_PAGE_SIZE) break;
    }
    if (!activeThreadKeys.size) return [];

    const threadIds = Array.from(
      new Set(Array.from(activeThreadKeys, (key) => key.slice(key.indexOf('|') + 1)))
    );
    const rowsByKey = new Map();
    for (
      let offset = 0;
      offset < threadIds.length;
      offset += PROVIDER_ACTIVE_THREAD_LOOKUP_BATCH_SIZE
    ) {
      const batch = threadIds.slice(offset, offset + PROVIDER_ACTIVE_THREAD_LOOKUP_BATCH_SIZE);
      const result = await run(
        `list-provider-active-audit-messages:${normalizedProvider}:${offset}`,
        (client) =>
          client
            .from(MAILBOX_INDEX_TABLES.messages)
            .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
            .eq('folder', normalizedProvider)
            .in('account_email', normalizedAccounts)
            .in('payload->>providerThreadId', batch)
            .contains('payload', { originalCampaignOutbound: true })
            .is('deleted_at', null)
            .order('date', { ascending: false })
      );
      if (!result.ok) return null;
      (Array.isArray(result.data) ? result.data : []).forEach((row) => {
        const messageKey = normalizeString(row && row.message_key);
        if (messageKey && !rowsByKey.has(messageKey)) rowsByKey.set(messageKey, row);
      });
    }

    return Array.from(rowsByKey.values())
      .map((row) => normalizeMessageRow(row))
      .filter((message) => activeThreadKeys.has(
        `${normalizeEmail(message.providerAccountEmail || message.accountEmail)}|${normalizeString(message.providerThreadId)}`
      ));
  }

  async function getProviderMessage({ provider, providerMessageId, accountEmail } = {}) {
    const normalizedProvider = normalizeString(provider).toLowerCase();
    const rawProviderMessageId = normalizeString(providerMessageId);
    const normalizedProviderMessageId = rawProviderMessageId.startsWith(`${normalizedProvider}:`)
      ? rawProviderMessageId.slice(normalizedProvider.length + 1)
      : rawProviderMessageId;
    const normalizedAccountEmail = normalizeEmail(accountEmail);
    if (!normalizedProvider || !normalizedProviderMessageId || !normalizedAccountEmail) return null;
    const result = await run(`get-provider-message:${normalizedProvider}`, (client) => client
      .from(MAILBOX_INDEX_TABLES.messages).select('*')
      .eq('account_email', normalizedAccountEmail).eq('folder', normalizedProvider)
      .eq('provider_id', `${normalizedProvider}:${normalizedProviderMessageId}`)
      .is('deleted_at', null).limit(1).maybeSingle(), {
        bypassFailureCooldown: true,
        clientOptions: { timeoutMs: DURABLE_WRITE_CLIENT_TIMEOUT_MS, ignoreFailureCooldown: true, suppressFailureCooldown: true },
        queryTimeoutMs: DURABLE_WRITE_QUERY_TIMEOUT_MS,
      });
    if (!result.ok) throw result.error || new Error('Exact providerbericht kon niet worden gecontroleerd.');
    if (!result.data) return null;
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

  async function listMessagesForAccounts({
    accountEmails = [], folder = 'inbox', limit = 1000, priorityRead = false,
  }) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    if (!normalizedAccounts.length) return [];
    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 1000));
    const read = priorityRead ? runPriorityRead : run;
    const result = await read('list-messages-for-accounts', (client) =>
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

  async function listAllMessagesForAccounts({
    accountEmails = [], folder = 'inbox', limit = null, priorityRead = false,
  }) {
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
      const read = priorityRead ? runPriorityRead : run;
      const result = await read(`list-all-messages-for-accounts:${normalizedFolder}:${offset}`, (client) =>
        client
          .from(MAILBOX_INDEX_TABLES.messages)
          .select(MAILBOX_MESSAGE_METADATA_COLUMNS)
          .in('account_email', normalizedAccounts)
          .eq('folder', normalizedFolder)
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .order('message_key', { ascending: false })
          .range(offset, offset + pageSize - 1)
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return (hasLimit ? rows.slice(0, safeLimit) : rows).map((row) => normalizeMessageRow(row));
  }

  async function listMatchingMessagesForAccounts({
    accountEmails = [],
    folder = 'inbox',
    subjectTerms = [],
    limit = 1000,
    priorityRead = false,
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
        const read = priorityRead ? runPriorityRead : run;
        const result = await read(
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
              .range(offset, offset + pageSize - 1)
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
    priorityRead = false,
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedMessageIds = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).map(normalizeString).filter(Boolean))
    ).slice(0, 2000);
    if (!normalizedAccounts.length || !normalizedMessageIds.length) return [];
    const normalizedFolder = normalizeFolder(folder);
    const read = priorityRead ? runPriorityRead : run;
    const rowsByKey = new Map();
    for (let offset = 0; offset < normalizedMessageIds.length; offset += MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE) {
      const batch = normalizedMessageIds.slice(offset, offset + MAILBOX_MESSAGE_ID_LOOKUP_BATCH_SIZE);
      const result = await read(`list-messages-by-message-id:${normalizedFolder}:${offset}`, (client) =>
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

  async function listMessageUidsForAccount({
    accountEmail,
    folder = 'inbox',
    since = '',
    limit = 5000,
  } = {}) {
    const normalizedAccount = normalizeEmail(accountEmail);
    if (!normalizedAccount) return [];
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = Math.max(1, Math.min(10_000, Math.floor(Number(limit) || 5000)));
    const rows = [];
    for (let offset = 0; offset < safeLimit; offset += MAILBOX_INDEX_PAGE_SIZE) {
      const pageSize = Math.min(MAILBOX_INDEX_PAGE_SIZE, safeLimit - offset);
      const result = await run(
        `list-message-uids-for-account:${normalizedFolder}:${offset}`,
        (client) => {
          let query = client
            .from(MAILBOX_INDEX_TABLES.messages)
            .select('uid')
            .eq('account_email', normalizedAccount)
            .eq('folder', normalizedFolder)
            .is('deleted_at', null)
            .order('uid', { ascending: false });
          if (normalizeString(since)) query = query.gte('date', normalizeString(since));
          return query.range(offset, offset + pageSize - 1);
        }
      );
      if (!result.ok) return null;
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return Array.from(
      new Set(rows.map((row) => Number(row && row.uid)).filter((uid) => Number.isSafeInteger(uid) && uid > 0))
    );
  }

  async function hydrateMessageBodies({ messages = [] } = {}) {
    const source = Array.isArray(messages) ? messages : [];
    const imapReferences = source.map((message) => ({
      accountEmail: normalizeEmail(message && message.accountEmail),
      folder: normalizeFolder(message && message.folder),
      uid: Number(message && message.uid) || 0,
    })).filter((message) => message.uid && message.folder !== 'instantly').slice(0, 20);
    const providerReferences = source
      .filter((message) => normalizeFolder(message && message.folder) === 'instantly')
      .map((message) => ({
        accountEmail: normalizeEmail(message && message.accountEmail),
        providerId: normalizeString(message && message.id),
      }))
      .filter((message) => message.accountEmail && /^instantly:[a-z0-9-]+$/i.test(message.providerId));
    if (!imapReferences.length && !providerReferences.length) return source;

    const selectedColumns = 'message_key,account_email,provider_id,uid,body_text,has_body,body_truncated,payload,folder,subject,preview,in_reply_to,references_text,recipients_text,deleted_at';
    const priorityReadOptions = { bypassFailureCooldown: true, suppressFailureCooldown: true, clientOptions: { ignoreFailureCooldown: true, suppressFailureCooldown: true }, queryTimeoutMs: 8_000 };
    const [messageResult, providerResult] = await Promise.all([
      imapReferences.length
        ? run('hydrate-message-bodies', (client) =>
            client
              .from(MAILBOX_INDEX_TABLES.messages)
              .select(selectedColumns)
              .or(imapReferences.map((message) => `and(account_email.eq.${message.accountEmail},folder.eq.${message.folder},uid.eq.${message.uid})`).join(','))
              .is('generation_superseded_at', null), priorityReadOptions)
        : Promise.resolve({ ok: true, data: [] }),
      providerReferences.length
        ? run('hydrate-provider-message-bodies', (client) =>
            client
              .from(MAILBOX_INDEX_TABLES.messages)
              .select(selectedColumns)
              .eq('folder', 'instantly')
              .in('account_email', Array.from(new Set(providerReferences.map((message) => message.accountEmail))))
              .in('provider_id', Array.from(new Set(providerReferences.map((message) => message.providerId))))
              .is('deleted_at', null), priorityReadOptions)
        : Promise.resolve({ ok: true, data: [] }),
    ]);
    if (!messageResult.ok && !providerResult.ok) return source;

    const bodyByMessageIdentity = new Map(
      (messageResult.data || []).filter((row) => !row.deleted_at).map((row) => [`${normalizeEmail(row.account_email)}|${normalizeFolder(row.folder)}|${Number(row.uid) || 0}`, row])
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
      const messageIdentity = uid && folder !== 'instantly'
        ? `${normalizeEmail(message.accountEmail)}|${folder}|${uid}`
        : '';
      const providerIdentity = folder === 'instantly'
        ? `${normalizeEmail(message && message.accountEmail)}|${normalizeString(message && message.id)}`
        : '';
      const row = bodyByMessageIdentity.get(messageIdentity) || bodyByProviderIdentity.get(providerIdentity);
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

  async function getMessage({ accountEmail, folder = 'inbox', id = '' }) {
    const normalizedFolder = normalizeFolder(folder);
    const uid = normalizedFolder === 'instantly'
      ? 0
      : Number(normalizeString(id).match(/:(\d+)$/)?.[1] || id);
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

  async function getMessageForReplyProof({ accountEmail, folder = 'inbox', id = '' }) {
    const normalizedFolder = normalizeFolder(folder);
    const uid = normalizedFolder === 'instantly'
      ? 0
      : Number(normalizeString(id).match(/:(\d+)$/)?.[1] || id);
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
    const result = await runPriorityRead('get-message-reply-proof', query);
    if (!result.ok) {
      const error = new Error('Exact mailboxbericht kon niet worden gecontroleerd.');
      error.code = 'MAILBOX_INDEX_EXACT_READ_UNAVAILABLE';
      throw error;
    }
    if (!result.data) return null;
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

  async function upsertMessages({
    accountEmail,
    folder = 'inbox',
    messages = [],
    uidValidity = null,
    generationId = null,
    deadlineAtMs = null,
  }) {
    const rows = deduplicateRowsByKey(
      (Array.isArray(messages) ? messages : [])
        .map((message, index) => buildMessageRow(message, accountEmail, folder, index, {
          uidValidity,
          generationId,
        }))
        .filter((row) => row.uid > 0),
      'message_key'
    );
    if (!rows.length) return { ok: true, data: [], upserted: 0 };
    const result = await runDurableWrite('upsert-messages', (client) =>
      client.from(MAILBOX_INDEX_TABLES.messages).upsert(rows, {
        onConflict: 'message_key',
        defaultToNull: false,
      }),
      { deadlineAtMs }
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

  const { acquireSyncLock, acquireSyncLockForProtocol } = createMailboxSyncProtocolLockStore({
    runDurableWrite,
    buildSyncKey,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    syncLockTtlMs: SYNC_LOCK_TTL_MS,
  });

  const finishSync = createMailboxLegacySyncFinalizer({
    runDurableWrite, buildSyncKey, normalizeString, truncateText, isoNow,
  });

  function isSyncStateStale(state, maxAgeMs) {
    const syncedAt = Date.parse(normalizeString(state && state.last_synced_at));
    if (!Number.isFinite(syncedAt)) return true;
    return now().getTime() - syncedAt > Math.max(1_000, Number(maxAgeMs) || 120_000);
  }

  const listMessagesReferencingMessageIdsForAccounts = createMailboxMessageReferenceLookup({
    run,
    runPriorityRead,
    tableName: MAILBOX_INDEX_TABLES.messages,
    metadataColumns: MAILBOX_MESSAGE_METADATA_COLUMNS,
    normalizeString,
    normalizeEmail,
    normalizeFolder,
    normalizeMessageRow,
  });
  const listSentCandidatesForQuotedReplies = createMailboxQuotedSentCandidateLookup({ run, tableName: MAILBOX_INDEX_TABLES.messages, normalizeString, normalizeEmail, normalizeMessageRow });
  const targetedLookups = createMailboxIndexTargetedLookups({
    run,
    runPriorityRead,
    tableName: MAILBOX_INDEX_TABLES.messages,
    metadataColumns: MAILBOX_MESSAGE_METADATA_COLUMNS,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    normalizeMessageRow,
    listMatchingMessagesForAccounts,
  });
  const visibilityStore = createMailboxIndexVisibilityStore({
    runDurableWrite, normalizeEmail, normalizeFolder, normalizeString,
  });
  const uidGenerationIndex = createMailboxUidGenerationIndex({
    runDurableWrite,
    buildSyncKey,
    buildMessageRow,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    now,
    messagesTable: MAILBOX_INDEX_TABLES.messages,
    pageSize: MAILBOX_INDEX_PAGE_SIZE,
  });

  const { applyStateMutation, getStateMutationStatus, markMessageRead, markMessageReplyDismissed } = createMailboxStateMutationStore({
    run,
    runDurableWrite,
    tableName: MAILBOX_INDEX_TABLES.messages,
    normalizeEmail,
    normalizeFolder,
    normalizeString,
    durableClientTimeoutMs: DURABLE_WRITE_CLIENT_TIMEOUT_MS,
    durableQueryTimeoutMs: DURABLE_WRITE_QUERY_TIMEOUT_MS,
    isoNow,
  });

  return {
    BODY_MAX_CHARS,
    BODY_RETENTION_DAYS,
    BODY_RETENTION_NEWEST_COUNT,
    MAILBOX_INDEX_TABLES,
    acquireSyncLock,
    acquireSyncLockForProtocol,
    buildMessageKey,
    buildMessageRow,
    buildProviderMessageKey,
    buildProviderMessageRow,
    buildSyncKey,
    finishSync,
    getMessage,
    getMessageForReplyProof,
    getProviderMessage,
    getSyncState,
    hydrateMessageBodies,
    isAvailable,
    isSyncStateStale,
    listAllMessagesForAccounts,
    listMatchingMessagesForAccounts,
    listMessagesByMessageIdsForAccounts,
    listSentCandidatesForQuotedReplies,
    listMessagesReferencingMessageIdsForAccounts,
    listUnthreadedSentCandidatesForConversations,
    listMessageUidsForAccount,
    listMessages,
    listMessagesForAccounts,
    listProviderMessages,
    listProviderActiveConversationAuditMessages,
    applyStateMutation,
    getStateMutationStatus,
    markMessageRead,
    markMessageReplyDismissed,
    normalizeMessageRow,
    stableProviderUid,
    upsertMessages,
    upsertProviderMessages,
    ...uidGenerationIndex,
    ...targetedLookups,
    ...visibilityStore,
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

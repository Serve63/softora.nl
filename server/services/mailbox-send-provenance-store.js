const crypto = require('crypto');
const {
  normalizeAttachmentMetadata,
} = require('./mailbox-attachment-policy');
const {
  MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS,
  createMailboxSendPreDispatchClaim,
} = require('./mailbox-send-pre-dispatch-claim');
const MAILBOX_SEND_PROVENANCE_TABLE = 'softora_mailbox_send_provenance';
const MAILBOX_SEND_PROVENANCE_CLIENT_TIMEOUT_MS = 8_000;
const MAILBOX_SEND_PROVENANCE_MAX_ATTEMPTS = 2;
const MAILBOX_SEND_RESERVATION_LEASE_MS = 30_000;
const MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_RPC =
  'softora_list_accepted_mailbox_send_provenance_by_message_ids';
const MAILBOX_FINALIZE_PRE_DISPATCH_RPC = 'softora_finalize_mailbox_pre_dispatch_claim';
const MAILBOX_START_PRE_DISPATCH_RPC = 'softora_start_mailbox_pre_dispatch';
const MAILBOX_CLAIM_PRE_DISPATCH_RPC = 'softora_claim_mailbox_pre_dispatch';
const MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_ACCOUNTS = 20;
const MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_IDS = 200;
const MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_ROWS = 2000;

function normalizeMailboxAttachmentsMetadata(value) {
  if (value === null || value === undefined || !Array.isArray(value)) return null;
  const normalized = normalizeAttachmentMetadata(value);
  return normalized.length === value.length ? normalized : null;
}

function mailboxAttachmentsMetadataEqual(left, right) {
  const normalizedLeft = normalizeMailboxAttachmentsMetadata(left);
  const normalizedRight = normalizeMailboxAttachmentsMetadata(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return normalizedLeft === normalizedRight;
  }
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function isExpiredMailboxReservedDispatch(intent, options = {}) {
  const normalizeString = options.normalizeString || ((value) => String(value || '').trim());
  if (intent?.status !== 'prepared' || intent?.dispatchState !== 'reserved') return false;
  const nowMs = Number(options.nowMs);
  if (!Number.isFinite(nowMs)) return false;
  const explicitLeaseMs = Date.parse(normalizeString(intent.dispatchLeaseExpiresAt));
  if (Number.isFinite(explicitLeaseMs)) return explicitLeaseMs <= nowMs;
  const reservationLeaseMs = Math.max(5_000, Math.min(
    120_000,
    Number(options.reservationLeaseMs) || MAILBOX_SEND_RESERVATION_LEASE_MS
  ));
  const legacyBaseMs = Date.parse(normalizeString(intent.updatedAt || intent.createdAt));
  return Number.isFinite(legacyBaseMs) && legacyBaseMs + reservationLeaseMs <= nowMs;
}

function createCanonicalMailboxHash(parts = []) {
  const source = parts.map((value) => {
    const text = String(value ?? '');
    return `${Buffer.byteLength(text, 'utf8')}:${text}`;
  }).join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}

function createMailboxSendScopeKey(input = {}, normalizeString = (value) => String(value || '').trim()) {
  const text = (value) => normalizeString(value);
  const email = (value) => text(value).toLowerCase();
  const provider = text(input.provider || 'smtp').toLowerCase();
  const mode = text(input.mode).toLowerCase();
  const canonical = [
    email(input.owner), email(input.accountEmail), email(input.recipientEmail), provider, mode,
    mode === 'reply'
      ? text(input.providerThreadId) || text(input.conversationId)
      : text(input.conversationId),
    mode === 'reply' ? text(input.replyTargetMessageId) : '',
  ];
  if (!['reply', 'new-message'].includes(mode)) canonical.push(text(input.idempotencyKey));
  return `${provider}-${mode || 'invalid'}-scope:${createCanonicalMailboxHash(canonical)}`;
}

function createMailboxPayloadFingerprint(input = {}, normalizeString = (value) => String(value || '').trim()) {
  return createCanonicalMailboxHash([
    normalizeString(input.subject),
    normalizeString(input.body).replace(/\r\n?/g, '\n'),
    normalizeString(input.cc).toLowerCase(),
    normalizeString(input.bcc).toLowerCase(),
    normalizeString(input.attachmentsFingerprint),
  ]);
}

function createMailboxAttachmentsFingerprint(attachments = []) {
  const normalized = (Array.isArray(attachments) ? attachments : []).map((attachment) => {
    const content = mailboxAttachmentContentBuffer(attachment);
    return createCanonicalMailboxHash([
      String(attachment?.filename || attachment?.name || '').trim(),
      String(attachment?.contentType || '').trim().toLowerCase(),
      String(content.length),
      crypto.createHash('sha256').update(content).digest('hex'),
    ]);
  });
  return normalized.length ? createCanonicalMailboxHash(normalized) : '';
}

function mailboxAttachmentContentBuffer(attachment = {}) {
  if (Buffer.isBuffer(attachment.content)) return attachment.content;
  if (attachment.content instanceof Uint8Array) return Buffer.from(attachment.content);
  const encodedValue = attachment.contentBase64 === undefined
    ? attachment.data
    : attachment.contentBase64;
  if (encodedValue !== undefined && encodedValue !== null) {
    const encoded = String(encodedValue)
      .replace(/^data:[^;,]+;base64,/i, '')
      .replace(/\s+/g, '');
    return Buffer.from(encoded, 'base64');
  }
  if (typeof attachment.content === 'string') {
    return String(attachment.encoding || '').trim().toLowerCase() === 'base64'
      ? Buffer.from(attachment.content.replace(/\s+/g, ''), 'base64')
      : Buffer.from(attachment.content, 'utf8');
  }
  return Buffer.alloc(0);
}

function createMailboxAttachmentsMetadataFromContent(attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.some((attachment) => String(attachment?.reference || '').trim())) return null;
  const metadata = list.map((attachment) => {
    const content = mailboxAttachmentContentBuffer(attachment);
    return {
      filename: String(attachment?.filename || attachment?.name || '').trim(),
      contentType: String(attachment?.contentType || attachment?.type || '').trim().toLowerCase(),
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });
  const normalized = normalizeMailboxAttachmentsMetadata(metadata);
  return normalized && normalized.length === list.length ? normalized : null;
}

function createMailboxClaimAttachmentsFingerprint(attachmentsMetadata = []) {
  const normalized = normalizeMailboxAttachmentsMetadata(attachmentsMetadata);
  if (normalized === null) return '';
  return normalized.length
    ? `claim:${createCanonicalMailboxHash([JSON.stringify(normalized)])}`
    : '';
}

function createMailboxRequestPayloadFingerprint(input = {}, normalizeString = (value) => String(value || '').trim()) {
  const metadata = normalizeMailboxAttachmentsMetadata(input.attachmentsMetadata);
  if (metadata === null) return '';
  return createMailboxPayloadFingerprint({
    subject: input.subject,
    body: input.requestBody === undefined ? input.body : input.requestBody,
    cc: input.cc,
    bcc: input.bcc,
    attachmentsFingerprint: `metadata:${JSON.stringify(metadata)}`,
  }, normalizeString);
}

function createMailboxSendIdentityKey(input = {}, normalizeString = (value) => String(value || '').trim()) {
  const mode = normalizeString(input.mode).toLowerCase();
  const scope = createMailboxSendScopeKey(input, normalizeString);
  if (mode !== 'new-message') return scope.replace('-scope:', ':');
  const payloadFingerprint = normalizeString(input.payloadFingerprint)
    || createMailboxPayloadFingerprint(input, normalizeString);
  return `new-message:${createCanonicalMailboxHash([scope, payloadFingerprint])}`;
}

function isAmbiguousMailboxProviderError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  return ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(code)
    || status === 429
    || status >= 500;
}

function isTransientMailboxProvenanceError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  const text = String(
    error?.message || error?.details || error?.hint || error?.name || error || ''
  ).trim();
  return status === 408 || status === 429 || status >= 500
    || ['57014', 'SUPABASE_REST_COOLDOWN'].includes(code)
    || /abort|timeout|timed out|cooldown|fetch failed|network|econnreset|etimedout|connection terminated|temporar/i.test(text);
}

function createMailboxReconcileRequiredError(cause) {
  const error = new Error('De provideruitkomst is niet eenduidig bevestigd; controleer de verzendstatus vóór opnieuw proberen.');
  error.status = 409;
  error.code = 'MAILBOX_SEND_RECONCILE_REQUIRED';
  error.cause = cause;
  return error;
}

function createMailboxSendProvenanceStore(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    normalizeString = (value) => String(value || '').trim(),
    logger = console,
    now = () => new Date(),
    criticalClientTimeoutMs = MAILBOX_SEND_PROVENANCE_CLIENT_TIMEOUT_MS,
    criticalMaxAttempts = MAILBOX_SEND_PROVENANCE_MAX_ATTEMPTS,
    retryDelayMs = 50,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    createTransitionToken = () => crypto.randomUUID(),
    reservationLeaseMs = MAILBOX_SEND_RESERVATION_LEASE_MS,
    preDispatchClaimLeaseMs = MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS,
  } = deps;
  const normalizeEmail = (value) => normalizeString(value).toLowerCase();
  const normalizeMessageId = (value) => normalizeString(value)
    .toLowerCase().replace(/^[<>,\s]+|[<>,\s]+$/g, '');
  const getClient = () => (isSupabaseConfigured() ? getSupabaseClient() : null);

  const getCriticalClient = () => (isSupabaseConfigured() ? getSupabaseClient({
    timeoutMs: Math.max(1_000, Math.min(60_000, Number(criticalClientTimeoutMs) || MAILBOX_SEND_PROVENANCE_CLIENT_TIMEOUT_MS)),
    ignoreFailureCooldown: true,
    suppressFailureCooldown: true,
  }) : null);

  function requiredCriticalClient() {
    const client = getCriticalClient();
    if (client) return client;
    const error = new Error('Duurzame mailbox-threadregistratie is niet beschikbaar; verzending is veilig gestopt.');
    error.status = 503;
    error.code = 'MAILBOX_SEND_PROVENANCE_UNAVAILABLE';
    throw error;
  }

  async function runCriticalQuery(operation, options = {}) {
    const configuredAttempts = Math.max(1, Math.min(2, Number(criticalMaxAttempts) || 1));
    const maxAttempts = options.maxAttempts === undefined
      ? configuredAttempts
      : Math.max(1, Math.min(configuredAttempts, Number(options.maxAttempts) || 1));
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await operation(requiredCriticalClient());
        if (result?.error) throw result.error;
        return result;
      } catch (error) {
        lastError = error;
        if (!isTransientMailboxProvenanceError(error) || attempt >= maxAttempts - 1) throw error;
        const delayMs = Math.max(0, Math.min(250, Number(retryDelayMs) || 0));
        if (delayMs) await sleep(delayMs);
      }
    }
    throw lastError;
  }

  function normalizeRow(row = {}) {
    return {
      intentId: normalizeString(row.intent_id), idempotencyKey: normalizeString(row.idempotency_key),
      sendIdentityKey: normalizeString(row.send_identity_key), sendScopeKey: normalizeString(row.send_scope_key),
      payloadFingerprint: normalizeString(row.payload_fingerprint), attachmentsFingerprint: normalizeString(row.attachments_fingerprint),
      requestPayloadFingerprint: normalizeString(row.request_payload_fingerprint),
      attachmentsMetadata: normalizeMailboxAttachmentsMetadata(row.attachments_metadata),
      owner: normalizeString(row.owner).toLowerCase(), accountEmail: normalizeEmail(row.account_email),
      recipientEmail: normalizeEmail(row.recipient_email), mode: normalizeString(row.mode).toLowerCase(),
      conversationId: normalizeString(row.conversation_id), replyTargetMessageId: normalizeString(row.reply_target_message_id),
      references: normalizeString(row.references_text), provider: normalizeString(row.provider).toLowerCase(),
      providerThreadId: normalizeString(row.provider_thread_id), providerMessageId: normalizeString(row.provider_message_id),
      messageId: normalizeString(row.sent_message_id), senderName: normalizeString(row.sender_name),
      subject: normalizeString(row.subject), body: normalizeString(row.body_text),
      cc: normalizeString(row.cc_text), bcc: normalizeString(row.bcc_text),
      status: normalizeString(row.status).toLowerCase(), error: normalizeString(row.error_text),
      dispatchState: normalizeString(row.dispatch_state).toLowerCase(),
      dispatchStartedAt: normalizeString(row.dispatch_started_at),
      dispatchLeaseExpiresAt: normalizeString(row.dispatch_lease_expires_at),
      reconcileRequired: row.reconcile_required === true,
      sentReconcileRequired: row.sent_reconcile_required === true,
      acceptedAt: normalizeString(row.accepted_at), createdAt: normalizeString(row.created_at),
      updatedAt: normalizeString(row.updated_at),
      transitionToken: normalizeString(row.transition_token),
      preDispatchClaimFingerprint: normalizeString(row.pre_dispatch_claim_fingerprint).toLowerCase(),
      preDispatchFinalizedAt: normalizeString(row.pre_dispatch_finalized_at),
    };
  }

  function buildPreparedRow(input = {}) {
    const attachmentsFingerprint = normalizeString(input.attachmentsFingerprint)
      || createMailboxAttachmentsFingerprint(input.attachments);
    const payloadFingerprint = createMailboxPayloadFingerprint({ ...input, attachmentsFingerprint }, normalizeString);
    const sendScopeKey = createMailboxSendScopeKey(input, normalizeString);
    const sendIdentityKey = createMailboxSendIdentityKey({ ...input, payloadFingerprint }, normalizeString);
    return {
      intent_id: normalizeString(input.intentId), idempotency_key: normalizeString(input.idempotencyKey),
      send_identity_key: sendIdentityKey, send_scope_key: sendScopeKey,
      payload_fingerprint: payloadFingerprint, attachments_fingerprint: attachmentsFingerprint,
      request_payload_fingerprint: normalizeString(input.requestPayloadFingerprint)
        || createMailboxRequestPayloadFingerprint(input, normalizeString) || null,
      attachments_metadata: normalizeMailboxAttachmentsMetadata(input.attachmentsMetadata),
      owner: normalizeString(input.owner).toLowerCase(), account_email: normalizeEmail(input.accountEmail),
      recipient_email: normalizeEmail(input.recipientEmail), mode: normalizeString(input.mode).toLowerCase(),
      conversation_id: normalizeString(input.conversationId) || null,
      reply_target_message_id: normalizeString(input.replyTargetMessageId) || null,
      references_text: normalizeString(input.references) || null,
      provider: normalizeString(input.provider || 'smtp').toLowerCase(),
      provider_thread_id: normalizeString(input.providerThreadId) || null,
      sent_message_id: normalizeString(input.messageId) || null,
      sender_name: normalizeString(input.senderName) || null,
      subject: normalizeString(input.subject), body_text: normalizeString(input.body),
      cc_text: normalizeString(input.cc) || null, bcc_text: normalizeString(input.bcc) || null,
      status: 'prepared', dispatch_state: 'reserved', dispatch_started_at: null,
      dispatch_lease_expires_at: null, reconcile_required: false, sent_reconcile_required: false,
      error_text: null, transition_token: null,
      pre_dispatch_claim_fingerprint: normalizeString(input.preDispatchClaimFingerprint) || null,
      pre_dispatch_finalized_at: normalizeString(input.preDispatchFinalizedAt) || null,
      updated_at: now().toISOString(),
    };
  }

  function assertPreparedRow(row) {
    const required = [
      row.intent_id, row.idempotency_key, row.send_identity_key, row.send_scope_key,
      row.payload_fingerprint, row.owner, row.account_email, row.recipient_email, row.mode, row.subject,
    ];
    if (required.some((value) => !value) || !['serve', 'martijn'].includes(row.owner)) {
      const error = new Error('De exacte afzender- of threadcontext ontbreekt; verzending is veilig gestopt.');
      error.status = 400;
      error.code = 'MAILBOX_SEND_PROVENANCE_INVALID';
      throw error;
    }
    if (!['reply', 'new-message'].includes(row.mode)) {
      const error = new Error('Ongeldige verzendmodus.');
      error.status = 400;
      error.code = 'MAILBOX_SEND_MODE_INVALID';
      throw error;
    }
    if (row.mode === 'reply' && (!row.conversation_id || !row.reply_target_message_id || !row.references_text)) {
      const error = new Error('De reply kan niet exact aan het ontvangen bericht worden gekoppeld.');
      error.status = 409;
      error.code = 'MAILBOX_REPLY_PROVENANCE_REQUIRED';
      throw error;
    }
  }

  async function findByIdempotencyKey(idempotencyKey) {
    const result = await runCriticalQuery((client) => client
      .from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq('idempotency_key', normalizeString(idempotencyKey)).maybeSingle());
    return result.data ? normalizeRow(result.data) : null;
  }

  async function findByIntentId(intentId) {
    const result = await runCriticalQuery((client) => client
      .from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq('intent_id', normalizeString(intentId)).maybeSingle());
    return result.data ? normalizeRow(result.data) : null;
  }

  async function findByColumn(column, value, statuses = []) {
    const result = await runCriticalQuery((client) => {
      let query = client.from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
        .eq(column, normalizeString(value));
      if (statuses.length) query = query.in('status', statuses);
      return query.maybeSingle();
    });
    return result.data ? normalizeRow(result.data) : null;
  }

  function isExpiredStartedDispatch(intent) {
    const leaseExpiresAtMs = Date.parse(normalizeString(intent?.dispatchLeaseExpiresAt));
    return intent?.status === 'prepared' && intent?.dispatchState === 'started'
      && Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs <= now().getTime();
  }

  function getReservationLeaseMs() {
    return Math.max(5_000, Math.min(120_000, Number(reservationLeaseMs) || MAILBOX_SEND_RESERVATION_LEASE_MS));
  }

  function createRequiredTransitionToken(label) {
    const token = normalizeString(createTransitionToken());
    if (token) return token;
    const error = new Error(`Threadregistratie kon niet als ${label} worden voorbereid.`);
    error.status = 503;
    error.code = 'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED';
    throw error;
  }

  function isExpiredReservedDispatch(intent) {
    return isExpiredMailboxReservedDispatch(intent, {
      normalizeString,
      nowMs: now().getTime(),
      reservationLeaseMs: getReservationLeaseMs(),
    });
  }

  function matchesReservationPayload(intent, row, { exactIntent = false } = {}) {
    if (!intent) return false;
    const expected = normalizeRow(row);
    const fields = [
      'idempotencyKey', 'sendIdentityKey', 'sendScopeKey', 'payloadFingerprint', 'attachmentsFingerprint',
      'requestPayloadFingerprint',
      'owner', 'accountEmail', 'recipientEmail', 'mode', 'conversationId', 'replyTargetMessageId',
      'references', 'provider', 'providerThreadId', 'senderName', 'subject', 'body', 'cc', 'bcc',
      'preDispatchClaimFingerprint', 'preDispatchFinalizedAt',
    ];
    if (exactIntent) fields.push('intentId', 'messageId');
    return fields.every((field) => intent[field] === expected[field])
      && mailboxAttachmentsMetadataEqual(intent.attachmentsMetadata, expected.attachmentsMetadata);
  }

  const exactReservedFenceColumns = Object.freeze([
    ['transition_token', 'transitionToken', true],
    ['dispatch_lease_expires_at', 'dispatchLeaseExpiresAt', true],
    ['updated_at', 'updatedAt', true],
    ['pre_dispatch_claim_fingerprint', 'preDispatchClaimFingerprint', true],
    ['pre_dispatch_finalized_at', 'preDispatchFinalizedAt', true],
  ]);

  function exactReservedCasFilters(intent) {
    const equals = {};
    const nulls = [];
    for (const [column, field, nullable] of exactReservedFenceColumns) {
      const value = intent?.[field];
      const missing = value === null || value === undefined
        || (typeof value === 'string' && !normalizeString(value));
      if (nullable && missing) nulls.push(column);
      else equals[column] = value;
    }
    return { statuses: ['prepared'], dispatchState: 'reserved', equals, nulls };
  }

  function exactStartedCasFilters(intent) {
    const filters = exactReservedCasFilters(intent);
    const startedAt = intent?.dispatchStartedAt;
    const missingStartedAt = startedAt === null || startedAt === undefined
      || (typeof startedAt === 'string' && !normalizeString(startedAt));
    if (missingStartedAt) filters.nulls.push('dispatch_started_at');
    else filters.equals.dispatch_started_at = startedAt;
    return { ...filters, dispatchState: 'started' };
  }

  async function reconcileExpiredStartedDispatch(intent) {
    if (!isExpiredStartedDispatch(intent)) return intent;
    const error = new Error('De dispatchlease is verlopen; de provideruitkomst moet eerst worden gereconcilieerd.');
    error.code = 'MAILBOX_SEND_DISPATCH_LEASE_EXPIRED';
    return markUnknown(intent.intentId, error, {
      sentReconcileRequired: true, expectedDispatchLeaseExpiresAt: intent.dispatchLeaseExpiresAt,
    });
  }

  async function findReservationConflict(row) {
    const byIdempotency = await findByIdempotencyKey(row.idempotency_key);
    if (byIdempotency) return reconcileExpiredStartedDispatch(byIdempotency);
    const byIdentity = await findByColumn(
      'send_identity_key', row.send_identity_key, ['prepared', 'unknown', 'accepted']
    );
    if (byIdentity) return reconcileExpiredStartedDispatch(byIdentity);
    return row.mode === 'new-message'
      ? findByColumn('send_scope_key', row.send_scope_key, ['prepared', 'unknown'])
        .then(reconcileExpiredStartedDispatch)
      : null;
  }

  function preview(input = {}) {
    const row = buildPreparedRow(input);
    assertPreparedRow(row);
    return normalizeRow(row);
  }

  async function preflight(input = {}) {
    const row = buildPreparedRow(input);
    assertPreparedRow(row);
    return { intent: normalizeRow(row), conflict: await findReservationConflict(row) };
  }

  async function reconcilePreflight(idempotencyKey, previouslyReadIntent = undefined) {
    const normalizedKey = normalizeString(idempotencyKey);
    if (!normalizedKey) {
      const error = new Error('Een veilige verzend-ID ontbreekt.');
      error.status = 400;
      error.code = 'MAILBOX_SEND_IDEMPOTENCY_REQUIRED';
      throw error;
    }
    let existing = previouslyReadIntent === undefined
      ? await findByIdempotencyKey(normalizedKey)
      : previouslyReadIntent;
    if (!existing) return null;
    if (existing.idempotencyKey !== normalizedKey) {
      const error = new Error('De duurzame verzend-ID wijkt af van het eerder gelezen intent.');
      error.status = 409;
      error.code = 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH';
      throw error;
    }
    existing = await reconcileExpiredStartedDispatch(existing);
    if (!isExpiredReservedDispatch(existing)) return existing;
    try {
      return (await releaseExpiredReserved(existing)).intent;
    } catch (error) {
      let current = null;
      try {
        current = await findByIdempotencyKey(normalizedKey);
      } catch (readError) {
        error.recoveryError = readError;
        throw error;
      }
      if (!current) {
        const reconcileError = createMailboxReconcileRequiredError(error);
        reconcileError.code = 'MAILBOX_SEND_RECONCILE_REQUIRED';
        throw reconcileError;
      }
      if (matchesTransitionFilters(current, exactReservedCasFilters(existing))) throw error;
      return reconcileExpiredStartedDispatch(current);
    }
  }

  async function reservePreparedRow(row, options = {}) {
    assertPreparedRow(row);
    const reservationToken = createRequiredTransitionToken('gereserveerd');
    const databaseClockClaim = options.databaseClockClaim === true;
    const leaseMs = Number(options.leaseMs) || getReservationLeaseMs();
    row.transition_token = reservationToken;
    const reservedAt = now();
    row.updated_at = reservedAt.toISOString();
    row.dispatch_lease_expires_at = new Date(
      reservedAt.getTime() + leaseMs
    ).toISOString();

    function isExactCommittedReservation(intent) {
      const updatedAtMs = Date.parse(normalizeString(intent?.updatedAt));
      const createdAtMs = Date.parse(normalizeString(intent?.createdAt));
      const leaseExpiresAtMs = Date.parse(normalizeString(intent?.dispatchLeaseExpiresAt));
      const exactLease = databaseClockClaim
        ? Number.isFinite(updatedAtMs) && Number.isFinite(createdAtMs)
          && Number.isFinite(leaseExpiresAtMs) && updatedAtMs === createdAtMs
          && leaseExpiresAtMs - updatedAtMs === leaseMs
        : sameTimestamp(intent?.dispatchLeaseExpiresAt, row.dispatch_lease_expires_at);
      return intent?.status === 'prepared' && intent?.dispatchState === 'reserved'
        && intent?.transitionToken === reservationToken
        && exactLease
        && matchesReservationPayload(intent, row, { exactIntent: true });
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await runCriticalQuery((client) => databaseClockClaim
          ? client.rpc(MAILBOX_CLAIM_PRE_DISPATCH_RPC, {
              p_row: row,
              p_transition_token: reservationToken,
              p_lease_ms: leaseMs,
            })
          : client.from(MAILBOX_SEND_PROVENANCE_TABLE).insert(row).select('*').single(),
        { maxAttempts: 1 });
        const insertedRow = databaseClockClaim ? firstRpcRow(result.data) : result.data;
        if (insertedRow) {
          const intent = normalizeRow(insertedRow);
          if (isExactCommittedReservation(intent)) return { created: true, intent };
        }
        lastError = new Error('Threadregistratie kon niet worden voorbereid.');
      } catch (queryError) {
        lastError = queryError;
      }

      let byIntent = null, existing = null;
      try {
        byIntent = await findByIntentId(row.intent_id);
        if (isExactCommittedReservation(byIntent)) return { created: true, intent: byIntent };
        existing = byIntent ? await reconcileExpiredStartedDispatch(byIntent) : await findReservationConflict(row);
      } catch (readError) {
        const error = createUpdateError(lastError, 'voorbereid');
        error.recoveryError = readError;
        throw error;
      }
      if (existing && isExpiredReservedDispatch(existing)) {
        if (options.renewExpired === false) return { created: false, intent: existing };
        const recovered = await recoverExpiredReserved(existing, row, reservationToken);
        if (recovered.created === true) return { created: true, intent: recovered.intent };
        if (recovered.released === true && attempt === 0) continue;
        if (recovered.intent) return { created: false, intent: recovered.intent };
      }
      if (existing) return { created: false, intent: existing };
      if (attempt === 0 && isTransientMailboxProvenanceError(lastError)) {
        const delayMs = Math.max(0, Math.min(250, Number(retryDelayMs) || 0));
        if (delayMs) await sleep(delayMs);
        continue;
      }
      const error = lastError || new Error('Threadregistratie kon niet worden voorbereid.');
      error.status = Number(error.status) || 503;
      error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_RESERVE_FAILED';
      throw error;
    }
    const error = lastError || new Error('Threadregistratie kon niet worden voorbereid.');
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_RESERVE_FAILED';
    throw error;
  }

  const reserve = (input = {}) => reservePreparedRow(buildPreparedRow(input), {
    leaseMs: getReservationLeaseMs(),
    renewExpired: true,
  });

  function sameTimestamp(left, right) {
    if (!normalizeString(left) && !normalizeString(right)) return true;
    const leftMs = Date.parse(normalizeString(left));
    const rightMs = Date.parse(normalizeString(right));
    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
  }

  function transitionFieldMatches(intent, column, expected) {
    if (column === 'intent_id') return intent?.intentId === normalizeString(expected);
    if (column === 'idempotency_key') return intent?.idempotencyKey === normalizeString(expected);
    if (column === 'send_identity_key') return intent?.sendIdentityKey === normalizeString(expected);
    if (column === 'send_scope_key') return intent?.sendScopeKey === normalizeString(expected);
    if (column === 'payload_fingerprint') return intent?.payloadFingerprint === normalizeString(expected);
    if (column === 'attachments_fingerprint') return intent?.attachmentsFingerprint === normalizeString(expected);
    if (column === 'request_payload_fingerprint') {
      return intent?.requestPayloadFingerprint === normalizeString(expected);
    }
    if (column === 'attachments_metadata') {
      return mailboxAttachmentsMetadataEqual(intent?.attachmentsMetadata, expected);
    }
    if (column === 'owner') return intent?.owner === normalizeString(expected).toLowerCase();
    if (column === 'account_email') return intent?.accountEmail === normalizeEmail(expected);
    if (column === 'recipient_email') return intent?.recipientEmail === normalizeEmail(expected);
    if (column === 'mode') return intent?.mode === normalizeString(expected).toLowerCase();
    if (column === 'conversation_id') return intent?.conversationId === normalizeString(expected);
    if (column === 'reply_target_message_id') return intent?.replyTargetMessageId === normalizeString(expected);
    if (column === 'references_text') return intent?.references === normalizeString(expected);
    if (column === 'provider') return intent?.provider === normalizeString(expected).toLowerCase();
    if (column === 'provider_thread_id') return intent?.providerThreadId === normalizeString(expected);
    if (column === 'sender_name') return intent?.senderName === normalizeString(expected);
    if (column === 'subject') return intent?.subject === normalizeString(expected);
    if (column === 'body_text') return intent?.body === normalizeString(expected);
    if (column === 'cc_text') return intent?.cc === normalizeString(expected);
    if (column === 'bcc_text') return intent?.bcc === normalizeString(expected);
    if (column === 'status') return intent?.status === normalizeString(expected).toLowerCase();
    if (column === 'dispatch_state') return intent?.dispatchState === normalizeString(expected).toLowerCase();
    if (column === 'dispatch_started_at') return sameTimestamp(intent?.dispatchStartedAt, expected);
    if (column === 'dispatch_lease_expires_at') return sameTimestamp(intent?.dispatchLeaseExpiresAt, expected);
    if (column === 'reconcile_required') return intent?.reconcileRequired === (expected === true);
    if (column === 'sent_reconcile_required') return intent?.sentReconcileRequired === (expected === true);
    if (column === 'provider_message_id') return intent?.providerMessageId === normalizeString(expected);
    if (column === 'provider_thread_id') return intent?.providerThreadId === normalizeString(expected);
    if (column === 'sent_message_id') return intent?.messageId === normalizeString(expected);
    if (column === 'accepted_at') return sameTimestamp(intent?.acceptedAt, expected);
    if (column === 'error_text') return intent?.error === normalizeString(expected);
    if (column === 'transition_token') return intent?.transitionToken === normalizeString(expected);
    if (column === 'updated_at') return sameTimestamp(intent?.updatedAt, expected);
    if (column === 'pre_dispatch_claim_fingerprint') {
      return intent?.preDispatchClaimFingerprint === normalizeString(expected).toLowerCase();
    }
    if (column === 'pre_dispatch_finalized_at') return sameTimestamp(intent?.preDispatchFinalizedAt, expected);
    return false;
  }

  function matchesTransition(intent, values, transitionToken) {
    return Boolean(intent) && intent.transitionToken === transitionToken
      && Object.entries(values).every(([column, expected]) => transitionFieldMatches(intent, column, expected));
  }

  function matchesTransitionFilters(intent, filters = {}) {
    if (!intent) return false;
    if (Array.isArray(filters.statuses) && filters.statuses.length && !filters.statuses.includes(intent.status)) return false;
    if (filters.dispatchState && intent.dispatchState !== filters.dispatchState) return false;
    if ((filters.nulls || []).some((column) => !transitionFieldMatches(intent, column, null))) return false;
    return Object.entries(filters.equals || {})
      .every(([column, expected]) => transitionFieldMatches(intent, column, expected));
  }

  function createUpdateError(queryError, label) {
    const error = queryError instanceof Error
      ? queryError
      : Object.assign(new Error(normalizeString(queryError?.message)
          || `Threadregistratie kon niet als ${label} worden opgeslagen.`), queryError || {});
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED';
    return error;
  }

  async function updateIntent(intentId, values, label, filters = {}, options = {}) {
    const normalizedIntentId = normalizeString(intentId);
    const transitionToken = normalizeString(options.transitionToken || createTransitionToken());
    if (!transitionToken) throw createUpdateError(null, label);
    const patch = { ...values, transition_token: transitionToken, updated_at: now().toISOString() };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await runCriticalQuery((client) => {
          let query = client.from(MAILBOX_SEND_PROVENANCE_TABLE)
            .update(patch).eq('intent_id', normalizedIntentId);
          if (Array.isArray(filters.statuses) && filters.statuses.length) query = query.in('status', filters.statuses);
          if (filters.dispatchState) query = query.eq('dispatch_state', filters.dispatchState);
          Object.entries(filters.equals || {}).forEach(([column, expected]) => { query = query.eq(column, expected); });
          (filters.nulls || []).forEach((column) => { query = query.is(column, null); });
          return query.select('*').single();
        }, { maxAttempts: 1 });
        if (result.data) return normalizeRow(result.data);
        lastError = new Error(`Threadregistratie kon niet als ${label} worden opgeslagen.`);
      } catch (queryError) {
        lastError = queryError;
      }

      let current = null;
      try {
        const readbackIntentId = normalizeString(options.readbackIntentId) || normalizedIntentId;
        current = await findByIntentId(readbackIntentId);
        if (!current && readbackIntentId !== normalizedIntentId) current = await findByIntentId(normalizedIntentId);
      } catch (readError) {
        const error = createUpdateError(lastError, label);
        error.recoveryError = readError;
        throw error;
      }
      if (matchesTransition(current, values, transitionToken)) return current;
      if (typeof options.isAlreadyApplied === 'function' && options.isAlreadyApplied(current)) return current;
      if (attempt === 0 && isTransientMailboxProvenanceError(lastError)
        && matchesTransitionFilters(current, filters)) {
        const delayMs = Math.max(0, Math.min(250, Number(retryDelayMs) || 0));
        if (delayMs) await sleep(delayMs);
        continue;
      }
      throw createUpdateError(lastError, label);
    }
    throw createUpdateError(lastError, label);
  }

  async function renewExpiredReserved(existing, row, reservationToken) {
    if (existing.idempotencyKey !== normalizeString(row.idempotency_key)
      || !matchesReservationPayload(existing, row)) return { created: false, intent: existing };
    try {
      const renewed = await updateIntent(existing.intentId, {
        intent_id: row.intent_id,
        sent_message_id: row.sent_message_id,
        status: 'prepared', dispatch_state: 'reserved',
        dispatch_started_at: null,
        dispatch_lease_expires_at: row.dispatch_lease_expires_at,
        reconcile_required: false, sent_reconcile_required: false,
        error_text: null,
      }, 'opnieuw gereserveerd', exactReservedCasFilters(existing), {
        transitionToken: reservationToken, readbackIntentId: row.intent_id,
      });
      const created = renewed.transitionToken === reservationToken
        && renewed.intentId === normalizeString(row.intent_id);
      return { created, intent: renewed };
    } catch (error) {
      const current = await findByIdempotencyKey(row.idempotency_key).catch(() => null);
      if (current) return { created: false, intent: current };
      throw error;
    }
  }

  async function releaseExpiredReserved(existing) {
    const released = await updateIntent(existing.intentId, {
      status: 'failed', dispatch_state: 'finished', dispatch_lease_expires_at: null,
      error_text: 'De pre-dispatchreservering verliep voordat de provider werd gestart.',
    }, 'veilig vrijgegeven', exactReservedCasFilters(existing), {
      isAlreadyApplied: (intent) => intent?.status === 'failed' && intent?.dispatchState === 'finished',
    });
    return { released: released?.status === 'failed', intent: released };
  }

  async function recoverExpiredReserved(existing, row, reservationToken) {
    if (!isExpiredReservedDispatch(existing)) return { created: false, intent: existing };
    if (existing.idempotencyKey === normalizeString(row.idempotency_key))
      return renewExpiredReserved(existing, row, reservationToken);
    return releaseExpiredReserved(existing);
  }

  function firstRpcRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data && typeof data === 'object' ? data : null;
  }

  function finalTransitionMatches(intent, sourceIntent, finalIntent, transitionToken) {
    if (!intent || intent.status !== 'prepared' || intent.dispatchState !== 'reserved'
      || intent.transitionToken !== transitionToken
      || intent.transitionToken === sourceIntent.transitionToken
      || !intent.preDispatchFinalizedAt
      || intent.preDispatchClaimFingerprint !== sourceIntent.preDispatchClaimFingerprint) return false;
    const exactFields = [
      'sendIdentityKey', 'sendScopeKey', 'payloadFingerprint', 'attachmentsFingerprint',
      'requestPayloadFingerprint', 'messageId', 'senderName', 'subject', 'body', 'cc', 'bcc',
    ];
    return exactFields.every((field) => intent[field] === finalIntent[field])
      && mailboxAttachmentsMetadataEqual(intent.attachmentsMetadata, finalIntent.attachmentsMetadata);
  }

  function startedTransitionMatches(intent, sourceIntent, transitionToken) {
    const startedAtMs = Date.parse(normalizeString(intent?.dispatchStartedAt));
    const leaseExpiresAtMs = Date.parse(normalizeString(intent?.dispatchLeaseExpiresAt));
    const updatedAtMs = Date.parse(normalizeString(intent?.updatedAt));
    return intent?.status === 'prepared'
      && intent?.dispatchState === 'started'
      && intent?.transitionToken === transitionToken
      && intent?.transitionToken !== sourceIntent?.transitionToken
      && intent?.preDispatchClaimFingerprint === sourceIntent?.preDispatchClaimFingerprint
      && sameTimestamp(intent?.preDispatchFinalizedAt, sourceIntent?.preDispatchFinalizedAt)
      && Number.isFinite(startedAtMs)
      && Number.isFinite(leaseExpiresAtMs)
      && Number.isFinite(updatedAtMs)
      && startedAtMs === updatedAtMs
      && leaseExpiresAtMs > startedAtMs;
  }

  async function finalizePreDispatchClaimAtomically(sourceIntent, finalIntent, options = {}) {
    const transitionToken = normalizeString(options.transitionToken);
    if (!transitionToken || transitionToken === normalizeString(sourceIntent?.transitionToken)) {
      throw createUpdateError(null, 'definitief voorbereid');
    }
    const leaseMs = Math.max(
      900_000,
      Math.min(3_600_000, Number(options.leaseMs) || MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS)
    );
    const args = {
      p_intent_id: sourceIntent.intentId,
      p_expected_transition_token: sourceIntent.transitionToken,
      p_expected_dispatch_lease_expires_at: sourceIntent.dispatchLeaseExpiresAt,
      p_expected_updated_at: sourceIntent.updatedAt,
      p_expected_claim_fingerprint: sourceIntent.preDispatchClaimFingerprint,
      p_next_transition_token: transitionToken,
      p_lease_ms: leaseMs,
      p_send_identity_key: finalIntent.sendIdentityKey,
      p_send_scope_key: finalIntent.sendScopeKey,
      p_payload_fingerprint: finalIntent.payloadFingerprint,
      p_attachments_fingerprint: finalIntent.attachmentsFingerprint,
      p_request_payload_fingerprint: finalIntent.requestPayloadFingerprint,
      p_attachments_metadata: finalIntent.attachmentsMetadata,
      p_sent_message_id: finalIntent.messageId || null,
      p_sender_name: finalIntent.senderName || null,
      p_subject: finalIntent.subject,
      p_body_text: finalIntent.body,
      p_cc_text: finalIntent.cc || null,
      p_bcc_text: finalIntent.bcc || null,
    };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await runCriticalQuery(
          (client) => client.rpc(MAILBOX_FINALIZE_PRE_DISPATCH_RPC, args),
          { maxAttempts: 1 }
        );
        const row = firstRpcRow(result.data);
        if (row) {
          const intent = normalizeRow(row);
          if (finalTransitionMatches(intent, sourceIntent, finalIntent, transitionToken)) return intent;
        }
        lastError = Object.assign(
          new Error('De definitieve pre-dispatchclaim verloor de databaselease.'),
          { code: 'PGRST116', status: 409 }
        );
      } catch (error) {
        lastError = error;
      }
      let current = null;
      try {
        current = await findByIntentId(sourceIntent.intentId);
      } catch (readError) {
        const error = createUpdateError(lastError, 'definitief voorbereid');
        error.recoveryError = readError;
        throw error;
      }
      if (finalTransitionMatches(current, sourceIntent, finalIntent, transitionToken)) return current;
      if (attempt === 0 && isTransientMailboxProvenanceError(lastError)
        && matchesTransitionFilters(current, exactReservedCasFilters(sourceIntent))) {
        const delayMs = Math.max(0, Math.min(250, Number(retryDelayMs) || 0));
        if (delayMs) await sleep(delayMs);
        continue;
      }
      throw createUpdateError(lastError, 'definitief voorbereid');
    }
    throw createUpdateError(lastError, 'definitief voorbereid');
  }

  async function startPreDispatchAtomically(sourceIntent, options = {}) {
    const transitionToken = normalizeString(options.transitionToken);
    if (!transitionToken || transitionToken === normalizeString(sourceIntent?.transitionToken)) {
      throw createUpdateError(null, 'gestart');
    }
    const leaseMs = Math.max(30_000, Math.min(900_000, Number(options.leaseMs) || 120_000));
    const args = {
      p_intent_id: sourceIntent.intentId,
      p_expected_transition_token: sourceIntent.transitionToken,
      p_expected_dispatch_lease_expires_at: sourceIntent.dispatchLeaseExpiresAt,
      p_expected_updated_at: sourceIntent.updatedAt,
      p_expected_claim_fingerprint: sourceIntent.preDispatchClaimFingerprint,
      p_expected_finalized_at: sourceIntent.preDispatchFinalizedAt,
      p_next_transition_token: transitionToken,
      p_lease_ms: leaseMs,
    };
    let transitionError = null;
    try {
      const result = await runCriticalQuery(
        (client) => client.rpc(MAILBOX_START_PRE_DISPATCH_RPC, args),
        { maxAttempts: 1 }
      );
      const row = firstRpcRow(result.data);
      if (row) {
        const intent = normalizeRow(row);
        if (startedTransitionMatches(intent, sourceIntent, transitionToken)) return intent;
      }
      transitionError = Object.assign(
        new Error('De providerstart verloor de databaselease.'),
        { code: 'PGRST116', status: 409 }
      );
    } catch (error) {
      transitionError = error;
    }

    let current = null;
    try {
      current = await findByIntentId(sourceIntent.intentId);
    } catch (readError) {
      const error = createUpdateError(transitionError, 'gestart');
      error.recoveryError = readError;
      throw error;
    }
    const committedWithoutResponse = startedTransitionMatches(
      current,
      sourceIntent,
      transitionToken
    );
    if (committedWithoutResponse) {
      const error = new Error(
        'De database legde de providerstart vast maar het antwoord ging verloren; verzending vereist reconciliatie.'
      );
      error.status = 409;
      error.code = 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED';
      error.intent = current;
      error.cause = transitionError;
      throw error;
    }
    throw createUpdateError(transitionError, 'gestart');
  }

  const accept = (intentId, values = {}) => {
    const messageId = normalizeString(values.messageId);
    const providerMessageId = normalizeString(values.providerMessageId);
    const providerThreadId = normalizeString(values.providerThreadId);
    return updateIntent(intentId, {
      status: 'accepted', sent_message_id: messageId || null,
      provider_message_id: providerMessageId || null,
      provider_thread_id: providerThreadId || null,
      accepted_at: normalizeString(values.acceptedAt) || now().toISOString(), error_text: null,
      dispatch_state: 'finished', dispatch_lease_expires_at: null,
      reconcile_required: false, sent_reconcile_required: false,
    }, 'verzonden', { statuses: ['prepared', 'unknown'] }, {
      isAlreadyApplied: (intent) => intent?.status === 'accepted' && intent?.dispatchState === 'finished'
        && (!messageId || intent.messageId === messageId)
        && (!providerMessageId || intent.providerMessageId === providerMessageId)
        && (!providerThreadId || intent.providerThreadId === providerThreadId),
    });
  };

  const markUnknown = (intentId, errorValue, values = {}) => {
    const providerMessageId = normalizeString(values.providerMessageId);
    const messageId = normalizeString(values.messageId);
    const sentReconcileRequired = values.sentReconcileRequired === true;
    const expectedDispatchLeaseExpiresAt = normalizeString(values.expectedDispatchLeaseExpiresAt);
    const filters = { statuses: ['prepared'] };
    if (expectedDispatchLeaseExpiresAt) Object.assign(filters, {
      dispatchState: 'started', equals: { dispatch_lease_expires_at: expectedDispatchLeaseExpiresAt },
    });
    return updateIntent(intentId, {
      status: 'unknown', dispatch_state: 'started', dispatch_lease_expires_at: null,
      reconcile_required: true, sent_reconcile_required: sentReconcileRequired,
      provider_message_id: providerMessageId || null,
      sent_message_id: messageId || null,
      error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000)
        || 'Providerresultaat vereist reconciliatie',
    }, 'onzeker', filters, {
      isAlreadyApplied: (intent) => (intent?.status === 'unknown' && intent?.dispatchState === 'started'
        && intent?.reconcileRequired === true && intent?.sentReconcileRequired === sentReconcileRequired
        && (!providerMessageId || intent.providerMessageId === providerMessageId)
        && (!messageId || intent.messageId === messageId))
        || (Boolean(expectedDispatchLeaseExpiresAt) && intent?.status === 'accepted'
          && intent?.dispatchState === 'finished'),
    });
  };

  async function fail(intentId, errorValue) {
    try {
      return await updateIntent(intentId, {
        status: 'failed',
        dispatch_state: 'finished', dispatch_lease_expires_at: null,
        error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000) || 'Verzending mislukt',
      }, 'mislukt', { statuses: ['prepared'] }, {
        isAlreadyApplied: (intent) => intent?.status === 'failed' && intent?.dispatchState === 'finished',
      });
    } catch (error) {
      logger.error('[MailboxSendProvenance][Fail]', error?.message || error);
      throw error;
    }
  }

  async function listAcceptedMessages({ accountEmails = [], limit = 500 } = {}) {
    const emails = Array.from(new Set(accountEmails.map(normalizeEmail).filter(Boolean)));
    if (!emails.length || !isSupabaseConfigured()) return [];
    try {
      const result = await runCriticalQuery((client) => client
        .from(MAILBOX_SEND_PROVENANCE_TABLE).select('*').in('account_email', emails)
        .eq('status', 'accepted').order('accepted_at', { ascending: false })
        .limit(Math.max(1, Math.min(2000, Number(limit) || 500))));
      return (Array.isArray(result.data) ? result.data : []).map(normalizeRow);
    } catch (error) {
      logger.error('[MailboxSendProvenance][List]', error?.message || error);
      throw error;
    }
  }

  async function listAcceptedMessagesByMessageIds({
    accountEmails = [],
    messageIds = [],
    maxRows = 500,
  } = {}) {
    const emails = Array.from(new Set(
      (Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean)
    ));
    const ids = Array.from(new Set(
      (Array.isArray(messageIds) ? messageIds : []).map(normalizeMessageId).filter(Boolean)
    ));
    const requestedMaxRows = Number(maxRows);
    if (emails.length > MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_ACCOUNTS
      || ids.length > MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_IDS
      || !Number.isInteger(requestedMaxRows)
      || requestedMaxRows < 1
      || requestedMaxRows > MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_ROWS) {
      const error = new Error('Te veel mailboxaccounts, Message-ID\'s of bewijsrijen aangevraagd.');
      error.status = 400;
      error.code = 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE';
      throw error;
    }
    if (!emails.length || !ids.length) return [];

    try {
      const result = await runCriticalQuery((client) => client.rpc(
        MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_RPC,
        { p_account_emails: emails, p_message_ids: ids, p_max_rows: requestedMaxRows }
      ));
      const envelope = Array.isArray(result.data) && result.data.length === 1
        ? result.data[0]
        : result.data;
      const rows = envelope && typeof envelope === 'object' && Array.isArray(envelope.rows)
        ? envelope.rows
        : null;
      const returnedCount = Number(envelope && envelope.returned_count);
      const envelopeMaxRows = Number(envelope && envelope.max_rows);
      if (!rows || !Number.isInteger(returnedCount) || returnedCount !== rows.length
        || envelopeMaxRows !== requestedMaxRows
        || typeof envelope.complete !== 'boolean'
        || typeof envelope.overflow !== 'boolean') {
        const error = new Error('De gerichte sendprovenance-read gaf geen volledig bewijsresultaat.');
        error.status = 503;
        error.code = 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INVALID_RESULT';
        throw error;
      }
      if (!envelope.complete || envelope.overflow || rows.length > requestedMaxRows) {
        const error = new Error('De gerichte sendprovenance-read overschreed de veilige bewijsgrens.');
        error.status = 503;
        error.code = 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_OVERFLOW';
        throw error;
      }

      const requestedEmails = new Set(emails);
      const requestedIds = new Set(ids);
      return rows.map((row) => {
        const intent = normalizeRow(row);
        const canonicalMessageId = normalizeMessageId(
          row && (row.canonical_message_id || row.sent_message_id)
        );
        if (intent.status !== 'accepted' || !requestedEmails.has(intent.accountEmail)
          || !requestedIds.has(canonicalMessageId)
          || canonicalMessageId !== normalizeMessageId(row && row.sent_message_id)) {
          const error = new Error('De gerichte sendprovenance-read bevat bewijs buiten de gevraagde scope.');
          error.status = 503;
          error.code = 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INVALID_RESULT';
          throw error;
        }
        return { ...intent, canonicalMessageId };
      });
    } catch (error) {
      logger.error('[MailboxSendProvenance][ListByMessageIds]', error?.message || error);
      throw error;
    }
  }

  const {
    claimPreDispatch,
    failPreDispatch,
    finalizeClaim,
    startDispatch,
  } = createMailboxSendPreDispatchClaim({
    assertPreparedRow,
    buildPreparedRow,
    createAttachmentsMetadataFromContent: createMailboxAttachmentsMetadataFromContent,
    createCanonicalHash: createCanonicalMailboxHash,
    createClaimAttachmentsFingerprint: createMailboxClaimAttachmentsFingerprint,
    createRequestPayloadFingerprint: createMailboxRequestPayloadFingerprint,
    createTransitionToken,
    exactReservedCasFilters,
    exactStartedCasFilters,
    finalizePreDispatchClaimAtomically,
    mailboxAttachmentsMetadataEqual,
    normalizeAttachmentsMetadata: normalizeMailboxAttachmentsMetadata,
    normalizeRow,
    normalizeString,
    now,
    preDispatchClaimLeaseMs,
    reservePreparedRow,
    startPreDispatchAtomically,
    updateIntent,
    logger,
  });

  return {
    accept,
    claimPreDispatch,
    fail,
    failPreDispatch,
    findByIdempotencyKey,
    finalizeClaim,
    isExpiredReservedDispatch,
    isAvailable: () => Boolean(getClient()),
    listAcceptedMessages,
    listAcceptedMessagesByMessageIds,
    markUnknown,
    preflight,
    preview,
    reconcilePreflight,
    reserve,
    startDispatch,
  };
}

module.exports = {
  MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_ACCOUNTS,
  MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_IDS,
  MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_MAX_ROWS,
  MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_RPC,
  MAILBOX_FINALIZE_PRE_DISPATCH_RPC,
  MAILBOX_START_PRE_DISPATCH_RPC,
  MAILBOX_SEND_PROVENANCE_TABLE,
  MAILBOX_SEND_PROVENANCE_CLIENT_TIMEOUT_MS,
  MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS,
  MAILBOX_SEND_RESERVATION_LEASE_MS,
  createMailboxAttachmentsMetadataFromContent,
  createMailboxAttachmentsFingerprint,
  createMailboxPayloadFingerprint,
  createMailboxRequestPayloadFingerprint,
  createMailboxSendIdentityKey,
  createMailboxSendProvenanceStore,
  createMailboxSendScopeKey,
  createMailboxReconcileRequiredError,
  isAmbiguousMailboxProviderError,
  isExpiredMailboxReservedDispatch,
  isTransientMailboxProvenanceError,
  mailboxAttachmentsMetadataEqual,
  normalizeMailboxAttachmentsMetadata,
};

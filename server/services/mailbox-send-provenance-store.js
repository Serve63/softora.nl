const crypto = require('crypto');
const MAILBOX_SEND_PROVENANCE_TABLE = 'softora_mailbox_send_provenance';

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
    const content = Buffer.isBuffer(attachment?.content)
      ? attachment.content
      : Buffer.from(String(attachment?.content || attachment?.contentBase64 || ''), 'base64');
    return createCanonicalMailboxHash([
      String(attachment?.filename || attachment?.name || '').trim(),
      String(attachment?.contentType || '').trim().toLowerCase(),
      String(content.length),
      crypto.createHash('sha256').update(content).digest('hex'),
    ]);
  });
  return normalized.length ? createCanonicalMailboxHash(normalized) : '';
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
  const status = Number(error?.status || error?.statusCode || error?.responseCode || 0);
  return ['ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(code)
    || status === 429
    || status >= 500;
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
  } = deps;
  const normalizeEmail = (value) => normalizeString(value).toLowerCase();
  const getClient = () => (isSupabaseConfigured() ? getSupabaseClient() : null);

  function requiredClient() {
    const client = getClient();
    if (client) return client;
    const error = new Error('Duurzame mailbox-threadregistratie is niet beschikbaar; verzending is veilig gestopt.');
    error.status = 503;
    error.code = 'MAILBOX_SEND_PROVENANCE_UNAVAILABLE';
    throw error;
  }

  function normalizeRow(row = {}) {
    return {
      intentId: normalizeString(row.intent_id), idempotencyKey: normalizeString(row.idempotency_key),
      sendIdentityKey: normalizeString(row.send_identity_key), sendScopeKey: normalizeString(row.send_scope_key),
      payloadFingerprint: normalizeString(row.payload_fingerprint), attachmentsFingerprint: normalizeString(row.attachments_fingerprint),
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
      error_text: null, updated_at: now().toISOString(),
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
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq('idempotency_key', normalizeString(idempotencyKey)).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? normalizeRow(result.data) : null;
  }

  async function findByColumn(column, value, statuses = []) {
    let query = requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq(column, normalizeString(value));
    if (statuses.length) query = query.in('status', statuses);
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    return result.data ? normalizeRow(result.data) : null;
  }

  async function findReservationConflict(row) {
    const byIdempotency = await findByIdempotencyKey(row.idempotency_key);
    if (byIdempotency) return byIdempotency;
    const byIdentity = await findByColumn(
      'send_identity_key',
      row.send_identity_key,
      ['prepared', 'unknown', 'accepted']
    );
    if (byIdentity) return byIdentity;
    return row.mode === 'new-message'
      ? findByColumn('send_scope_key', row.send_scope_key, ['prepared', 'unknown'])
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

  async function reserve(input = {}) {
    const row = buildPreparedRow(input);
    assertPreparedRow(row);
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).insert(row).select('*').single();
    if (!result.error && result.data) return { created: true, intent: normalizeRow(result.data) };
    if (normalizeString(result.error && result.error.code) === '23505') {
      const existing = await findReservationConflict(row);
      if (existing) return { created: false, intent: existing };
    }
    const error = result.error || new Error('Threadregistratie kon niet worden voorbereid.');
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_RESERVE_FAILED';
    throw error;
  }

  async function updateIntent(intentId, values, label, filters = {}) {
    let query = requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE)
      .update({ ...values, updated_at: now().toISOString() }).eq('intent_id', normalizeString(intentId));
    if (Array.isArray(filters.statuses) && filters.statuses.length) query = query.in('status', filters.statuses);
    if (filters.dispatchState) query = query.eq('dispatch_state', filters.dispatchState);
    const result = await query.select('*').single();
    if (!result.error && result.data) return normalizeRow(result.data);
    const error = result.error || new Error(`Threadregistratie kon niet als ${label} worden opgeslagen.`);
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED';
    throw error;
  }

  const startDispatch = (intentId, leaseMs = 120_000) => {
    const startedAt = now();
    return updateIntent(intentId, {
      dispatch_state: 'started', dispatch_started_at: startedAt.toISOString(),
      dispatch_lease_expires_at: new Date(startedAt.getTime() + Math.max(30_000, Number(leaseMs) || 120_000)).toISOString(),
    }, 'gestart', { statuses: ['prepared'], dispatchState: 'reserved' });
  };

  const accept = (intentId, values = {}) => updateIntent(intentId, {
    status: 'accepted', sent_message_id: normalizeString(values.messageId) || null,
    provider_message_id: normalizeString(values.providerMessageId) || null,
    provider_thread_id: normalizeString(values.providerThreadId) || null,
    accepted_at: normalizeString(values.acceptedAt) || now().toISOString(), error_text: null,
    dispatch_state: 'finished', dispatch_lease_expires_at: null,
    reconcile_required: false, sent_reconcile_required: false,
  }, 'verzonden', { statuses: ['prepared', 'unknown'] });

  const markUnknown = (intentId, errorValue, values = {}) => updateIntent(intentId, {
    status: 'unknown', dispatch_state: 'started', dispatch_lease_expires_at: null,
    reconcile_required: true, sent_reconcile_required: values.sentReconcileRequired === true,
    provider_message_id: normalizeString(values.providerMessageId) || null,
    sent_message_id: normalizeString(values.messageId) || null,
    error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000)
      || 'Providerresultaat vereist reconciliatie',
  }, 'onzeker', { statuses: ['prepared'] });

  async function fail(intentId, errorValue) {
    try {
      return await updateIntent(intentId, {
        status: 'failed',
        dispatch_state: 'finished', dispatch_lease_expires_at: null,
        error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000) || 'Verzending mislukt',
      }, 'mislukt', { statuses: ['prepared'] });
    } catch (error) {
      logger.error('[MailboxSendProvenance][Fail]', error?.message || error);
      return null;
    }
  }

  async function listAcceptedMessages({ accountEmails = [], limit = 500 } = {}) {
    const emails = Array.from(new Set(accountEmails.map(normalizeEmail).filter(Boolean)));
    const client = getClient();
    if (!emails.length || !client) return [];
    const result = await client.from(MAILBOX_SEND_PROVENANCE_TABLE).select('*').in('account_email', emails)
      .eq('status', 'accepted').order('accepted_at', { ascending: false })
      .limit(Math.max(1, Math.min(2000, Number(limit) || 500)));
    if (result.error) {
      logger.error('[MailboxSendProvenance][List]', result.error?.message || result.error);
      return [];
    }
    return (Array.isArray(result.data) ? result.data : []).map(normalizeRow);
  }

  return {
    accept,
    fail,
    findByIdempotencyKey,
    isAvailable: () => Boolean(getClient()),
    listAcceptedMessages,
    markUnknown,
    preflight,
    preview,
    reserve,
    startDispatch,
  };
}

module.exports = {
  MAILBOX_SEND_PROVENANCE_TABLE,
  createMailboxAttachmentsFingerprint,
  createMailboxPayloadFingerprint,
  createMailboxSendIdentityKey,
  createMailboxSendProvenanceStore,
  createMailboxSendScopeKey,
  createMailboxReconcileRequiredError,
  isAmbiguousMailboxProviderError,
};

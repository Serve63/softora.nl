const crypto = require('crypto');
const MAILBOX_SEND_PROVENANCE_TABLE = 'softora_mailbox_send_provenance';
const MAILBOX_SEND_DISPATCH_LEASE_MS = 10 * 60 * 1000;

function createCanonicalMailboxHash(parts = []) {
  const source = parts.map((value) => {
    const text = String(value ?? '');
    return `${Buffer.byteLength(text, 'utf8')}:${text}`;
  }).join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}

function normalizeMailboxAddressList(value) {
  const values = [];
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === 'object') return visit(item.address || item.email || item.value);
    (String(item).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .forEach((address) => values.push(address.toLowerCase()));
  };
  visit(value);
  return Array.from(new Set(values)).sort();
}

function createMailboxRecipientFingerprint({ to, cc, bcc } = {}) {
  return crypto.createHash('sha256').update(JSON.stringify([
    normalizeMailboxAddressList(to), normalizeMailboxAddressList(cc), normalizeMailboxAddressList(bcc),
  ])).digest('hex');
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

function createMailboxSendIdentityKey(input = {}, normalizeString = (value) => String(value || '').trim()) {
  const mode = normalizeString(input.mode).toLowerCase();
  const scope = createMailboxSendScopeKey(input, normalizeString);
  if (mode !== 'new-message') return scope.replace('-scope:', ':');
  const payloadFingerprint = normalizeString(input.payloadFingerprint)
    || createMailboxPayloadFingerprint(input, normalizeString);
  return `new-message:${createCanonicalMailboxHash([scope, payloadFingerprint])}`;
}

function isExactInstantlySendReconciliation(intent = {}, message = {}, target = {}) {
  const text = (value) => String(value || '').trim();
  const email = (value) => text(value).toLowerCase();
  const addresses = (value) => String(value || '').split(/[,;]/).map(email).filter(Boolean).sort().join(',');
  const intentAt = Date.parse(intent.createdAt);
  const providerAt = Date.parse(message.providerCreatedAt);
  const targetAt = Date.parse(target.providerCreatedAt || target.receivedAt || target.date);
  const exactScope = (candidate) => (
    text(candidate.provider).toLowerCase() === 'instantly' &&
    email(candidate.providerOwner) === email(intent.owner) &&
    email(candidate.providerAccountEmail) === email(intent.accountEmail) &&
    text(candidate.providerThreadId) === text(intent.providerThreadId)
  );
  return Boolean(
    intent.reconcileRequired === true && ['prepared', 'unknown', 'accepted'].includes(text(intent.status).toLowerCase()) &&
    exactScope(target) && text(target.providerMessageId) === text(intent.replyTargetMessageId) &&
    Number.isFinite(targetAt) && Number.isFinite(intentAt) && targetAt <= intentAt + 120_000 &&
    exactScope(message) && text(message.direction).toLowerCase() === 'sent' &&
    text(message.providerMessageId) && text(message.providerMessageId) !== text(target.providerMessageId) &&
    (!text(message.inReplyTo) || text(message.inReplyTo) === text(intent.replyTargetMessageId)) &&
    addresses(message.to) === email(intent.recipientEmail) && text(message.subject) === text(intent.subject) &&
    text(message.body) === text(intent.body) && addresses(message.cc) === addresses(intent.cc) &&
    addresses(message.bcc) === addresses(intent.bcc) && Number.isFinite(providerAt) && targetAt <= providerAt &&
    providerAt >= intentAt - 120_000 && providerAt <= intentAt + 15 * 60_000
  );
}

function findExactInstantlySendReconciliation(intent = {}, messages = []) {
  const unique = Array.from(new Map((Array.isArray(messages) ? messages : [])
    .filter((message) => message?.providerMessageId)
    .map((message) => [String(message.providerMessageId).trim(), message])).values());
  const target = unique.find(
    (message) => String(message.providerMessageId).trim() === String(intent.replyTargetMessageId || '').trim()
  );
  if (!target) return null;
  const matches = unique.filter((message) => isExactInstantlySendReconciliation(intent, message, target));
  return matches.length === 1 ? matches[0] : null;
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
      sendIdentityKey: normalizeString(row.send_identity_key),
      sendScopeKey: normalizeString(row.send_scope_key),
      owner: normalizeString(row.owner).toLowerCase(), accountEmail: normalizeEmail(row.account_email),
      recipientEmail: normalizeEmail(row.recipient_email), mode: normalizeString(row.mode).toLowerCase(),
      conversationId: normalizeString(row.conversation_id), replyTargetMessageId: normalizeString(row.reply_target_message_id),
      references: normalizeString(row.references_text), provider: normalizeString(row.provider).toLowerCase(),
      providerThreadId: normalizeString(row.provider_thread_id), providerMessageId: normalizeString(row.provider_message_id),
      messageId: normalizeString(row.sent_message_id), senderName: normalizeString(row.sender_name),
      subject: normalizeString(row.subject), body: normalizeString(row.body_text),
      cc: normalizeString(row.cc_text), bcc: normalizeString(row.bcc_text),
      payloadFingerprint: normalizeString(row.payload_fingerprint),
      attachmentsFingerprint: normalizeString(row.attachments_fingerprint),
      status: normalizeString(row.status).toLowerCase(), error: normalizeString(row.error_text),
      dispatchState: normalizeString(row.dispatch_state).toLowerCase(),
      dispatchStartedAt: normalizeString(row.dispatch_started_at),
      dispatchLeaseExpiresAt: normalizeString(row.dispatch_lease_expires_at),
      outboundGuardRequired: row.outbound_guard_required === true,
      outboundGuardReconcileRequired: row.outbound_guard_reconcile_required === true,
      sentReconcileRequired: row.sent_reconcile_required === true,
      accepted: Array.isArray(row.accepted_recipients) ? row.accepted_recipients.map(normalizeEmail).filter(Boolean) : [],
      rejected: Array.isArray(row.rejected_recipients) ? row.rejected_recipients.map(normalizeEmail).filter(Boolean) : [],
      storageDegraded: row.storage_degraded === true, reconcileRequired: row.reconcile_required === true,
      providerOutcomeUnknown: normalizeString(row.status).toLowerCase() === 'unknown',
      acceptedAt: normalizeString(row.accepted_at), createdAt: normalizeString(row.created_at),
      updatedAt: normalizeString(row.updated_at),
    };
  }

  function buildPreparedRow(input = {}) {
    const payloadFingerprint = normalizeString(input.payloadFingerprint)
      || createMailboxPayloadFingerprint(input, normalizeString);
    const createdAt = now();
    return {
      intent_id: normalizeString(input.intentId), idempotency_key: normalizeString(input.idempotencyKey),
      send_identity_key: createMailboxSendIdentityKey(input, normalizeString),
      send_scope_key: createMailboxSendScopeKey(input, normalizeString),
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
      payload_fingerprint: payloadFingerprint,
      attachments_fingerprint: normalizeString(input.attachmentsFingerprint),
      status: 'prepared', error_text: null,
      dispatch_state: 'reserved', dispatch_started_at: null,
      dispatch_lease_expires_at: new Date(createdAt.getTime() + MAILBOX_SEND_DISPATCH_LEASE_MS).toISOString(),
      outbound_guard_required: input.outboundGuardRequired === true,
      outbound_guard_reconcile_required: false,
      sent_reconcile_required: false,
      accepted_recipients: [], rejected_recipients: [],
      storage_degraded: false,
      reconcile_required: false, updated_at: createdAt.toISOString(),
    };
  }

  function assertPreparedRow(row) {
    const required = [row.intent_id, row.idempotency_key, row.send_identity_key, row.owner, row.account_email, row.recipient_email, row.mode, row.subject];
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
    if (!['smtp', 'instantly'].includes(row.provider)) {
      const error = new Error('Onbekende mailboxprovider.');
      error.status = 400;
      error.code = 'MAILBOX_SEND_PROVIDER_INVALID';
      throw error;
    }
    if (row.provider === 'instantly' && row.mode !== 'reply') {
      const error = new Error('Instantly ondersteunt hier alleen antwoorden.');
      error.status = 409;
      error.code = 'INSTANTLY_NEW_MESSAGE_UNSUPPORTED';
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

  async function findByIntentId(intentId) {
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq('intent_id', normalizeString(intentId)).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? normalizeRow(result.data) : null;
  }

  async function findBySendIdentityKey(sendIdentityKey) {
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq('send_identity_key', normalizeString(sendIdentityKey))
      .in('status', ['prepared', 'unknown', 'accepted']).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? normalizeRow(result.data) : null;
  }

  async function findBySendScopeKey(sendScopeKey) {
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .eq('send_scope_key', normalizeString(sendScopeKey))
      .in('status', ['prepared', 'unknown']).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? normalizeRow(result.data) : null;
  }

  async function reserve(input = {}) {
    const row = buildPreparedRow(input);
    assertPreparedRow(row);
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).insert(row).select('*').single();
    if (!result.error && result.data) return { created: true, intent: normalizeRow(result.data) };
    if (normalizeString(result.error && result.error.code) === '23505') {
      const existing = await findByIdempotencyKey(row.idempotency_key);
      if (existing) return { created: false, intent: existing };
      const sameSend = await findBySendIdentityKey(row.send_identity_key);
      if (sameSend) return { created: false, intent: sameSend };
      const sameScope = await findBySendScopeKey(row.send_scope_key);
      if (sameScope) return { created: false, intent: sameScope };
    }
    const error = result.error || new Error('Threadregistratie kon niet worden voorbereid.');
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_RESERVE_FAILED';
    throw error;
  }

  async function updateIntent(intentId, values, label, allowedStatuses) {
    let query = requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE)
      .update({ ...values, updated_at: now().toISOString() })
      .eq('intent_id', normalizeString(intentId));
    if (Array.isArray(allowedStatuses) && allowedStatuses.length) {
      query = query.in('status', allowedStatuses);
    }
    const result = await query.select('*').single();
    if (!result.error && result.data) return normalizeRow(result.data);
    const current = await findByIntentId(intentId);
    if (current?.status === 'accepted') return current;
    if (current && Array.isArray(allowedStatuses) && !allowedStatuses.includes(current.status)) return current;
    const error = result.error || new Error(`Threadregistratie kon niet als ${label} worden opgeslagen.`);
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED';
    throw error;
  }

  const accept = (intentId, values = {}) => updateIntent(intentId, {
    status: 'accepted', sent_message_id: normalizeString(values.messageId) || null,
    provider_message_id: normalizeString(values.providerMessageId) || null,
    provider_thread_id: normalizeString(values.providerThreadId) || null,
    accepted_at: normalizeString(values.acceptedAt) || now().toISOString(), error_text: null,
    storage_degraded: values.storageDegraded === true,
    reconcile_required: values.reconcileRequired === true,
    outbound_guard_reconcile_required: values.outboundGuardReconcileRequired === true,
    sent_reconcile_required: values.sentReconcileRequired === true,
    accepted_recipients: Array.isArray(values.accepted) ? values.accepted.map(normalizeEmail).filter(Boolean) : [],
    rejected_recipients: Array.isArray(values.rejected) ? values.rejected.map(normalizeEmail).filter(Boolean) : [],
    dispatch_state: 'finished',
  }, 'verzonden', ['prepared', 'unknown', 'accepted']);

  const markUnknown = (intentId, errorValue) => updateIntent(intentId, {
    status: 'unknown', storage_degraded: true, reconcile_required: true,
    dispatch_state: 'started',
    error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000)
      || 'Provideruitkomst onbekend; automatische reconciliatie vereist',
  }, 'onzeker', ['prepared', 'unknown']);

  async function fail(intentId, errorValue) {
    try {
      return await updateIntent(intentId, {
        status: 'failed', storage_degraded: false, reconcile_required: false,
        dispatch_state: 'finished',
        outbound_guard_reconcile_required: false, sent_reconcile_required: false,
        error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000) || 'Verzending mislukt',
      }, 'mislukt', ['prepared']);
    } catch (error) {
      logger.error('[MailboxSendProvenance][Fail]', error?.message || error);
      return null;
    }
  }

  async function markDispatchStarted(intentId) {
    let query = requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).update({
      dispatch_state: 'started', dispatch_started_at: now().toISOString(),
      dispatch_lease_expires_at: null, reconcile_required: true,
      sent_reconcile_required: true,
      updated_at: now().toISOString(),
    }).eq('intent_id', normalizeString(intentId)).eq('status', 'prepared').eq('dispatch_state', 'reserved');
    const current = await query.select('*').single();
    if (!current.error && current.data) {
      return normalizeRow(current.data);
    }
    const existing = await findByIntentId(intentId);
    if (existing?.status === 'prepared' && existing.dispatchState === 'started') return existing;
    const error = current.error || new Error('De duurzame providerstart kon niet worden vastgelegd.');
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_DISPATCH_START_FAILED';
    throw error;
  }

  async function listExpiredUndispatched({ accountEmails = [], limit = 100 } = {}) {
    const emails = Array.from(new Set(accountEmails.map(normalizeEmail).filter(Boolean)));
    if (!emails.length) return [];
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .in('account_email', emails).eq('status', 'prepared').eq('dispatch_state', 'reserved')
      .lte('dispatch_lease_expires_at', now().toISOString())
      .order('created_at', { ascending: true })
      .limit(Math.max(1, Math.min(500, Number(limit) || 100)));
    if (result.error) throw result.error;
    return (Array.isArray(result.data) ? result.data : []).map(normalizeRow);
  }

  async function abandonUndispatched(intentId, errorValue = 'Providerdispatch is vóór de provider-aanroep verlopen') {
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).update({
      status: 'failed', dispatch_state: 'finished', reconcile_required: false,
      sent_reconcile_required: false, outbound_guard_reconcile_required: false,
      storage_degraded: false, error_text: normalizeString(errorValue).slice(0, 1000),
      updated_at: now().toISOString(),
    }).eq('intent_id', normalizeString(intentId)).eq('status', 'prepared')
      .eq('dispatch_state', 'reserved').select('*').single();
    if (!result.error && result.data) return { abandoned: true, intent: normalizeRow(result.data) };
    const current = await findByIntentId(intentId);
    return { abandoned: false, intent: current };
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

  async function listReconcileRequired({ accountEmails = [], provider = '', limit = 100 } = {}) {
    const emails = Array.from(new Set(accountEmails.map(normalizeEmail).filter(Boolean)));
    if (!emails.length) return [];
    let query = requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).select('*')
      .in('account_email', emails).in('status', ['prepared', 'unknown', 'accepted'])
      .eq('dispatch_state', 'started').eq('reconcile_required', true);
    if (normalizeString(provider)) query = query.eq('provider', normalizeString(provider).toLowerCase());
    const result = await query.order('created_at', { ascending: true })
      .limit(Math.max(1, Math.min(500, Number(limit) || 100)));
    if (result.error) throw result.error;
    return (Array.isArray(result.data) ? result.data : []).map(normalizeRow);
  }

  return {
    abandonUndispatched, accept, fail, findByIdempotencyKey, findByIntentId,
    findBySendIdentityKey, findBySendScopeKey, isAvailable: () => Boolean(getClient()),
    listAcceptedMessages, listExpiredUndispatched, listReconcileRequired,
    markDispatchStarted, markUnknown, reserve,
  };
}

module.exports = {
  MAILBOX_SEND_DISPATCH_LEASE_MS, MAILBOX_SEND_PROVENANCE_TABLE,
  createCanonicalMailboxHash, createMailboxPayloadFingerprint, createMailboxRecipientFingerprint,
  createMailboxSendIdentityKey, createMailboxSendProvenanceStore,
  createMailboxSendScopeKey,
  findExactInstantlySendReconciliation, isExactInstantlySendReconciliation,
};

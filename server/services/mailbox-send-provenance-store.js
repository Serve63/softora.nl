const MAILBOX_SEND_PROVENANCE_TABLE = 'softora_mailbox_send_provenance';

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
      owner: normalizeString(row.owner).toLowerCase(), accountEmail: normalizeEmail(row.account_email),
      recipientEmail: normalizeEmail(row.recipient_email), mode: normalizeString(row.mode).toLowerCase(),
      conversationId: normalizeString(row.conversation_id), replyTargetMessageId: normalizeString(row.reply_target_message_id),
      references: normalizeString(row.references_text), provider: normalizeString(row.provider).toLowerCase(),
      providerThreadId: normalizeString(row.provider_thread_id), providerMessageId: normalizeString(row.provider_message_id),
      messageId: normalizeString(row.sent_message_id), senderName: normalizeString(row.sender_name),
      subject: normalizeString(row.subject), body: normalizeString(row.body_text),
      cc: normalizeString(row.cc_text), bcc: normalizeString(row.bcc_text),
      status: normalizeString(row.status).toLowerCase(), error: normalizeString(row.error_text),
      acceptedAt: normalizeString(row.accepted_at), createdAt: normalizeString(row.created_at),
      updatedAt: normalizeString(row.updated_at),
    };
  }

  function buildPreparedRow(input = {}) {
    return {
      intent_id: normalizeString(input.intentId), idempotency_key: normalizeString(input.idempotencyKey),
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
      status: 'prepared', error_text: null, updated_at: now().toISOString(),
    };
  }

  function assertPreparedRow(row) {
    const required = [row.intent_id, row.idempotency_key, row.owner, row.account_email, row.recipient_email, row.mode, row.subject];
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

  async function reserve(input = {}) {
    const row = buildPreparedRow(input);
    assertPreparedRow(row);
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE).insert(row).select('*').single();
    if (!result.error && result.data) return { created: true, intent: normalizeRow(result.data) };
    if (normalizeString(result.error && result.error.code) === '23505') {
      const existing = await findByIdempotencyKey(row.idempotency_key);
      if (existing) return { created: false, intent: existing };
    }
    const error = result.error || new Error('Threadregistratie kon niet worden voorbereid.');
    error.status = Number(error.status) || 503;
    error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_RESERVE_FAILED';
    throw error;
  }

  async function updateIntent(intentId, values, label) {
    const result = await requiredClient().from(MAILBOX_SEND_PROVENANCE_TABLE)
      .update({ ...values, updated_at: now().toISOString() }).eq('intent_id', normalizeString(intentId)).select('*').single();
    if (!result.error && result.data) return normalizeRow(result.data);
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
  }, 'verzonden');

  async function fail(intentId, errorValue) {
    try {
      return await updateIntent(intentId, {
        status: 'failed',
        error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000) || 'Verzending mislukt',
      }, 'mislukt');
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

  return { accept, fail, findByIdempotencyKey, isAvailable: () => Boolean(getClient()), listAcceptedMessages, reserve };
}

module.exports = { MAILBOX_SEND_PROVENANCE_TABLE, createMailboxSendProvenanceStore };

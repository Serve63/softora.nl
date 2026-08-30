const crypto = require('node:crypto');

const OWNER_KEY = 'serve';
const WEBHOOK_TABLE = 'softora_whatsapp_webhook_events';
const MESSAGE_TABLE = 'softora_whatsapp_messages';
const CONTACT_TABLE = 'softora_whatsapp_contacts';
const SYNC_TABLE = 'softora_whatsapp_sync_state';
const MAX_MESSAGE_CONTENT_LENGTH = 24_000;
const MIN_PROVIDER_WEBHOOK_TOKEN_LENGTH = 43;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

function safeDateFromUnix(value) {
  const milliseconds = Number(value) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return new Date().toISOString();
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function optionalIsoDate(value, field) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${field} moet een geldige datum zijn.`);
    error.code = 'WHATSAPP_QUERY_INVALID';
    throw error;
  }
  return parsed.toISOString();
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function createWhatsAppReadOnlyService(deps = {}) {
  const config = deps.config || {};
  const getSupabaseClient = deps.getSupabaseClient || (() => null);
  const now = deps.now || (() => new Date());
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const appSecret = normalizeText(config.appSecret);
  const verifyToken = normalizeText(config.verifyToken);
  const providerWebhookToken = normalizeText(config.providerWebhookToken);
  const encryptionSecret = normalizeText(config.encryptionKey);
  const readToken = normalizeText(config.readToken);
  const ownerKey = normalizeText(config.ownerKey) || OWNER_KEY;

  function db() {
    const client = getSupabaseClient({ timeoutMs: 30_000, ignoreFailureCooldown: true });
    if (!client) {
      const error = new Error('Supabase is niet geconfigureerd voor WhatsApp.');
      error.code = 'WHATSAPP_STORAGE_NOT_CONFIGURED';
      throw error;
    }
    return client;
  }

  function encryptionKey() {
    const key = /^[a-f0-9]{64}$/i.test(encryptionSecret)
      ? Buffer.from(encryptionSecret, 'hex')
      : Buffer.from(encryptionSecret, 'base64');
    if (key.length !== 32) {
      const error = new Error('WHATSAPP_ENCRYPTION_KEY moet exact 32 bytes zijn.');
      error.code = 'WHATSAPP_ENCRYPTION_KEY_INVALID';
      throw error;
    }
    return key;
  }

  function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  function encrypt(value, purpose) {
    const iv = randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(String(purpose || ''), 'utf8'));
    const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  function decrypt(value, purpose) {
    const [version, iv, tag, ciphertext] = String(value || '').split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Versleutelde WhatsApp-data is ongeldig.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(String(purpose || ''), 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  function blindKey(value, purpose) {
    const normalized = normalizeSearchText(value);
    if (!normalized) return '';
    return crypto
      .createHmac('sha256', encryptionKey())
      .update(`${purpose}:${normalized}`)
      .digest('base64url');
  }

  function conversationKey(phone) {
    return blindKey(String(phone || '').replace(/[^0-9]/g, ''), 'conversation');
  }

  function contactSearchKeys(name, phone) {
    const normalizedName = normalizeSearchText(name);
    const phoneDigits = String(phone || '').replace(/[^0-9]/g, '');
    const candidates = new Set([
      normalizedName,
      ...normalizedName.split(/\s+/).filter((part) => part.length >= 2),
      phoneDigits,
      phoneDigits.length > 8 ? phoneDigits.slice(-8) : '',
    ]);
    return [...candidates].filter(Boolean).map((value) => blindKey(value, 'contact-search'));
  }

  function verifyWebhookSignature(rawBody, signature) {
    if (!appSecret || !Buffer.isBuffer(rawBody) || !signature) return false;
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    return safeEqual(expected, signature);
  }

  function hasValidProviderWebhookToken() {
    return Boolean(
      providerWebhookToken.length >= MIN_PROVIDER_WEBHOOK_TOKEN_LENGTH &&
      providerWebhookToken.length <= 180 &&
      /^[a-z0-9_-]+$/i.test(providerWebhookToken)
    );
  }

  function isProviderWebhookAuthorized(token) {
    return hasValidProviderWebhookToken() && safeEqual(token, providerWebhookToken);
  }

  function verifyChallenge({ mode, token, challenge }) {
    if (mode !== 'subscribe' || !verifyToken || !safeEqual(token, verifyToken)) return null;
    return normalizeText(challenge);
  }

  function isReadAuthorized(token) {
    return Boolean(readToken && safeEqual(token, readToken));
  }

  function buildContent(message) {
    const type = normalizeText(message?.type) || 'unknown';
    const raw = message?.[type];
    let detail = raw && typeof raw === 'object' ? raw : {};
    if (type === 'edit' && raw?.message) detail = raw;
    const serialized = JSON.stringify({ type, detail });
    return serialized.length <= MAX_MESSAGE_CONTENT_LENGTH
      ? serialized
      : JSON.stringify({ type, detail: { truncated: true } });
  }

  function contentSearchKeys(message) {
    const candidates = new Set();
    const visit = (value) => {
      if (typeof value === 'string') {
        const normalized = normalizeSearchText(value);
        if (!normalized) return;
        candidates.add(normalized);
        for (const part of normalized.split(/\s+/)) {
          if (part.length >= 2) candidates.add(part);
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) visit(entry);
      }
    };
    visit(message);
    return [...candidates].slice(0, 250).map((value) => blindKey(value, 'message-search'));
  }

  function contactNameMap(value) {
    const names = new Map();
    for (const contact of value?.contacts || []) {
      const phone = normalizeText(contact?.wa_id);
      const name = normalizeText(contact?.profile?.name);
      if (phone && name) names.set(phone, name);
    }
    return names;
  }

  function makeMessageRecord({ message, contactPhone, contactName, businessPhone, sourceField, historyStatus }) {
    const mutationType = ['edit', 'revoke'].includes(normalizeText(message?.type))
      ? normalizeText(message.type)
      : '';
    const originalMessageKey = normalizeText(
      message?.revoke?.original_message_id || message?.edit?.original_message_id
    );
    const messageKey = originalMessageKey || normalizeText(message?.id);
    const phone = normalizeText(contactPhone);
    if (!messageKey || !phone) return null;
    const businessDigits = String(businessPhone || '').replace(/[^0-9]/g, '');
    const fromDigits = String(message?.from || '').replace(/[^0-9]/g, '');
    const direction = fromDigits && businessDigits && fromDigits === businessDigits ? 'outbound' : 'inbound';
    const storedMessage = mutationType === 'edit'
      ? (message?.edit?.message || message)
      : mutationType === 'revoke'
        ? { type: 'revoked', revoked: {} }
        : message;
    return {
      message_key: messageKey,
      conversation_key: conversationKey(phone),
      contact_search_keys: contactSearchKeys(contactName, phone),
      content_search_keys: mutationType === 'revoke' ? [] : contentSearchKeys(storedMessage),
      contact_name_encrypted: contactName ? encrypt(contactName, 'contact-name') : null,
      contact_phone_encrypted: encrypt(phone, 'contact-phone'),
      content_encrypted: encrypt(buildContent(storedMessage), 'message-content'),
      direction,
      message_type: mutationType === 'edit'
        ? (normalizeText(storedMessage?.type) || 'unknown')
        : mutationType === 'revoke'
          ? 'revoked'
          : (normalizeText(message?.type) || 'unknown'),
      source_field: normalizeText(sourceField) || 'messages',
      history_status: normalizeText(historyStatus) || null,
      occurred_at: safeDateFromUnix(message?.timestamp),
      received_at: now().toISOString(),
      edited_at: mutationType === 'edit' ? now().toISOString() : null,
      revoked_at: mutationType === 'revoke' ? now().toISOString() : null,
    };
  }

  function extractPayload(payload) {
    const messages = [];
    const contacts = new Map();
    let phoneNumberKey = '';
    let displayPhone = '';
    let historyPhase = null;
    let historyProgress = null;
    let historyDeclined = false;

    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};
        const field = normalizeText(change?.field);
        const businessPhone = normalizeText(value?.metadata?.display_phone_number);
        displayPhone = businessPhone || displayPhone;
        phoneNumberKey = normalizeText(value?.metadata?.phone_number_id) || phoneNumberKey;
        const names = contactNameMap(value);

        for (const message of value?.messages || []) {
          const phone = normalizeText(message?.from || message?.to);
          const record = makeMessageRecord({
            message,
            contactPhone: phone,
            contactName: names.get(phone) || '',
            businessPhone,
            sourceField: field || 'messages',
          });
          if (record) messages.push(record);
        }

        for (const message of value?.message_echoes || []) {
          const phone = normalizeText(message?.to);
          const record = makeMessageRecord({
            message,
            contactPhone: phone,
            contactName: names.get(phone) || '',
            businessPhone,
            sourceField: 'smb_message_echoes',
          });
          if (record) messages.push(record);
        }

        for (const history of value?.history || []) {
          if ((history?.errors || []).some((error) => Number(error?.code) === 2593109)) {
            historyDeclined = true;
          }
          if (Number.isInteger(Number(history?.metadata?.phase))) historyPhase = Number(history.metadata.phase);
          if (Number.isFinite(Number(history?.metadata?.progress))) historyProgress = Number(history.metadata.progress);
          for (const thread of history?.threads || []) {
            const phone = normalizeText(thread?.id);
            for (const message of thread?.messages || []) {
              const record = makeMessageRecord({
                message,
                contactPhone: phone,
                contactName: normalizeText(thread?.name) || names.get(phone) || '',
                businessPhone,
                sourceField: 'history',
                historyStatus: message?.history_context?.status,
              });
              if (record) messages.push(record);
            }
          }
        }
      }
    }

    for (const message of messages) {
      const existing = contacts.get(message.conversation_key) || { searchKeys: new Set() };
      for (const key of message.contact_search_keys || []) existing.searchKeys.add(key);
      existing.nameEncrypted = message.contact_name_encrypted || existing.nameEncrypted || null;
      existing.phoneEncrypted = message.contact_phone_encrypted;
      existing.lastSeenAt = !existing.lastSeenAt || message.occurred_at > existing.lastSeenAt
        ? message.occurred_at
        : existing.lastSeenAt;
      contacts.set(message.conversation_key, existing);
    }

    return {
      messages,
      contacts: [...contacts.entries()].map(([key, contact]) => ({
        conversation_key: key,
        search_keys: [...contact.searchKeys],
        name_encrypted: contact.nameEncrypted,
        phone_encrypted: contact.phoneEncrypted,
        last_seen_at: contact.lastSeenAt,
        updated_at: now().toISOString(),
      })),
      sync: { phoneNumberKey, displayPhone, historyPhase, historyProgress, historyDeclined },
    };
  }

  async function acceptWebhook({ rawBody, signature, providerToken, payload }) {
    if (
      !verifyWebhookSignature(rawBody, signature) &&
      !isProviderWebhookAuthorized(providerToken)
    ) {
      const error = new Error('Ongeldige WhatsApp-webhookhandtekening.');
      error.code = 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID';
      throw error;
    }
    if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload?.entry)) {
      const error = new Error('Ongeldige WhatsApp-webhookpayload.');
      error.code = 'WHATSAPP_WEBHOOK_PAYLOAD_INVALID';
      throw error;
    }
    const eventKey = crypto.createHash('sha256').update(rawBody).digest('hex');
    const { error } = await db().from(WEBHOOK_TABLE).upsert({
      event_key: eventKey,
      encrypted_payload: encrypt(rawBody.toString('utf8'), 'webhook-payload'),
      status: 'pending',
      attempts: 0,
      next_attempt_at: now().toISOString(),
      received_at: now().toISOString(),
    }, { onConflict: 'event_key', ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true, accepted: true, eventKey };
  }

  async function processEvent(event) {
    const payload = JSON.parse(decrypt(event.encrypted_payload, 'webhook-payload'));
    const extracted = extractPayload(payload);
    for (const batch of chunk(extracted.messages, 500)) {
      const { error } = await db().rpc('softora_upsert_whatsapp_messages', { p_messages: batch });
      if (error) throw error;
    }
    if (extracted.contacts.length > 0) {
      const { error } = await db().rpc('softora_upsert_whatsapp_contacts', {
        p_contacts: extracted.contacts,
      });
      if (error) throw error;
    }
    const lastMessage = extracted.messages.reduce((latest, message) => (
      !latest || message.occurred_at > latest ? message.occurred_at : latest
    ), '');
    const syncPatch = {
      owner_key: ownerKey,
      last_webhook_at: now().toISOString(),
      updated_at: now().toISOString(),
      ...(extracted.sync.phoneNumberKey ? { phone_number_key: extracted.sync.phoneNumberKey } : {}),
      ...(extracted.sync.displayPhone ? { display_phone_encrypted: encrypt(extracted.sync.displayPhone, 'business-phone') } : {}),
      ...(extracted.sync.historyPhase !== null ? { history_phase: extracted.sync.historyPhase } : {}),
      ...(extracted.sync.historyProgress !== null ? { history_progress: extracted.sync.historyProgress } : {}),
      ...(extracted.sync.historyDeclined ? { history_declined: true } : {}),
      ...(lastMessage ? { last_message_at: lastMessage } : {}),
    };
    const { error: syncError } = await db().from(SYNC_TABLE).upsert(syncPatch, { onConflict: 'owner_key' });
    if (syncError) throw syncError;
    return extracted.messages.length;
  }

  async function processWebhookQueue(options = {}) {
    const lockToken = randomBytes(16).toString('hex');
    const limit = Math.max(1, Math.min(5, Number(options.limit || 2) || 2));
    const { data: events, error } = await db().rpc('softora_claim_whatsapp_webhook_events', {
      p_limit: limit,
      p_lock_token: lockToken,
      p_lock_seconds: 300,
    });
    if (error) throw error;
    const results = [];
    for (const event of events || []) {
      try {
        const messageCount = await processEvent(event);
        const { error: completeError } = await db().from(WEBHOOK_TABLE).update({
          status: 'completed',
          processed_at: now().toISOString(),
          lock_token: null,
          lock_expires_at: null,
          last_error: null,
        }).eq('event_key', event.event_key).eq('lock_token', lockToken);
        if (completeError) throw completeError;
        results.push({ eventKey: event.event_key, ok: true, messageCount });
      } catch (processingError) {
        const attempts = Math.max(1, Number(event.attempts || 1));
        await db().from(WEBHOOK_TABLE).update({
          status: 'retry',
          next_attempt_at: new Date(now().getTime() + Math.min(60 * 60_000, 30_000 * (2 ** (attempts - 1)))).toISOString(),
          lock_token: null,
          lock_expires_at: null,
          last_error: normalizeText(processingError?.code) || 'WHATSAPP_PROCESSING_FAILED',
        }).eq('event_key', event.event_key).eq('lock_token', lockToken);
        results.push({ eventKey: event.event_key, ok: false, error: 'processing_failed' });
      }
    }
    return { ok: true, processed: results.length, results };
  }

  async function getStatus() {
    const { data, error } = await db().from(SYNC_TABLE).select('*').eq('owner_key', ownerKey).maybeSingle();
    if (error) throw error;
    return {
      configured: Boolean(
        (appSecret || hasValidProviderWebhookToken()) &&
        verifyToken &&
        encryptionSecret &&
        readToken
      ),
      connected: Boolean(data?.phone_number_key && data?.last_webhook_at),
      historyPhase: data?.history_phase ?? null,
      historyProgress: data?.history_progress ?? null,
      historyDeclined: Boolean(data?.history_declined),
      lastWebhookAt: data?.last_webhook_at || null,
      lastMessageAt: data?.last_message_at || null,
    };
  }

  async function readMessages(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit || 80) || 80));
    const contactQuery = normalizeSearchText(options.contact);
    const textQuery = normalizeSearchText(options.query);
    const after = optionalIsoDate(options.after, 'after');
    const before = optionalIsoDate(options.before, 'before');
    if (after && before && after > before) {
      const error = new Error('after mag niet na before liggen.');
      error.code = 'WHATSAPP_QUERY_INVALID';
      throw error;
    }
    let conversationKeys = [];
    let contacts = [];
    if (contactQuery) {
      const searchKey = blindKey(contactQuery, 'contact-search');
      const contactResult = await db().from(CONTACT_TABLE)
        .select('*')
        .overlaps('search_keys', [searchKey])
        .order('last_seen_at', { ascending: false })
        .limit(20);
      if (contactResult.error) throw contactResult.error;
      contacts = contactResult.data || [];
      conversationKeys = contacts.map((contact) => contact.conversation_key);
      if (conversationKeys.length === 0) return { messages: [], count: 0 };
    }

    let query = db().from(MESSAGE_TABLE).select('*').order('occurred_at', { ascending: false }).limit(limit);
    if (conversationKeys.length > 0) query = query.in('conversation_key', conversationKeys);
    if (textQuery) {
      const keys = textQuery.split(/\s+/).filter(Boolean).map((value) => blindKey(value, 'message-search'));
      query = query.contains('content_search_keys', keys);
    }
    if (after) query = query.gte('occurred_at', after);
    if (before) query = query.lte('occurred_at', before);
    const result = await query;
    if (result.error) throw result.error;

    const contactByConversation = new Map(contacts.map((contact) => [contact.conversation_key, contact]));
    const decoded = (result.data || []).map((row) => {
      const storedContact = contactByConversation.get(row.conversation_key);
      const nameCiphertext = storedContact?.name_encrypted || row.contact_name_encrypted;
      const phoneCiphertext = storedContact?.phone_encrypted || row.contact_phone_encrypted;
      const parsedContent = JSON.parse(decrypt(row.content_encrypted, 'message-content'));
      return {
        id: row.message_key,
        conversationId: row.conversation_key,
        contactName: nameCiphertext ? decrypt(nameCiphertext, 'contact-name') : '',
        contactPhone: decrypt(phoneCiphertext, 'contact-phone'),
        direction: row.direction,
        type: row.message_type,
        content: parsedContent,
        occurredAt: row.occurred_at,
        editedAt: row.edited_at || null,
        revokedAt: row.revoked_at || null,
        historyStatus: row.history_status || null,
      };
    }).reverse();
    return { messages: decoded, count: decoded.length };
  }

  return {
    acceptWebhook,
    getStatus,
    isReadAuthorized,
    isProviderWebhookAuthorized,
    processWebhookQueue,
    readMessages,
    verifyChallenge,
    verifyWebhookSignature,
  };
}

module.exports = {
  createWhatsAppReadOnlyService,
  normalizeSearchText,
};

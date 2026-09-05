const crypto = require('node:crypto');

const DEFAULT_YCLOUD_WEBHOOK_TOLERANCE_SECONDS = 300;
const MIN_YCLOUD_WEBHOOK_TOLERANCE_SECONDS = 30;
const MAX_YCLOUD_WEBHOOK_TOLERANCE_SECONDS = 900;
const SUPPORTED_YCLOUD_EVENT_TYPES = Object.freeze([
  'whatsapp.inbound_message.received',
  'whatsapp.smb.message.echoes',
  'whatsapp.smb.history',
]);
const SUPPORTED_YCLOUD_EVENT_TYPE_SET = new Set(SUPPORTED_YCLOUD_EVENT_TYPES);
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function normalizeText(value) {
  return String(value || '').trim();
}

function payloadInvalid() {
  const error = new Error('Ongeldige YCloud WhatsApp-webhookpayload.');
  error.code = 'WHATSAPP_WEBHOOK_PAYLOAD_INVALID';
  return error;
}

function signatureToleranceSeconds(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_YCLOUD_WEBHOOK_TOLERANCE_SECONDS;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) &&
    parsed >= MIN_YCLOUD_WEBHOOK_TOLERANCE_SECONDS &&
    parsed <= MAX_YCLOUD_WEBHOOK_TOLERANCE_SECONDS
    ? parsed
    : DEFAULT_YCLOUD_WEBHOOK_TOLERANCE_SECONDS;
}

function isValidYCloudWebhookSecret(value) {
  return /^whsec_[a-z0-9_-]{32,250}$/i.test(normalizeText(value));
}

function parseYCloudSignatureHeader(value) {
  const parts = String(value || '').split(',');
  if (parts.length !== 2) return null;

  let timestamp = '';
  let signature = '';
  let timestampCount = 0;
  let signatureCount = 0;
  for (const part of parts) {
    const match = /^\s*([ts])=([^\s,=]+)\s*$/.exec(part);
    if (!match) return null;
    if (match[1] === 't') {
      timestampCount += 1;
      timestamp = match[2];
    } else {
      signatureCount += 1;
      signature = match[2];
    }
  }

  if (
    timestampCount !== 1 ||
    signatureCount !== 1 ||
    !/^\d+$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return null;
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) return null;
  return { timestamp, timestampSeconds, signature: signature.toLowerCase() };
}

function verifyYCloudWebhookSignature(options = {}) {
  const rawBody = options.rawBody;
  const secret = normalizeText(options.secret);
  const parsed = parseYCloudSignatureHeader(options.signature);
  if (!Buffer.isBuffer(rawBody) || !isValidYCloudWebhookSecret(secret) || !parsed) return false;

  const nowValue = options.now instanceof Date ? options.now.getTime() : Number(options.now);
  const nowMilliseconds = Number.isFinite(nowValue) ? nowValue : Date.now();
  const tolerance = signatureToleranceSeconds(options.toleranceSeconds);
  if (Math.abs(Math.floor(nowMilliseconds / 1000) - parsed.timestampSeconds) > tolerance) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(Buffer.from(`${parsed.timestamp}.`, 'utf8'))
    .update(rawBody)
    .digest();
  const received = Buffer.from(parsed.signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function rfc3339ToUnixSeconds(value) {
  const normalized = normalizeText(value);
  if (!RFC3339_PATTERN.test(normalized)) return '';
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '';
  return String(Math.floor(milliseconds / 1000));
}

function isGroupMessage(message) {
  if (
    message?.groupId !== undefined &&
    message?.groupId !== null &&
    typeof message.groupId !== 'string'
  ) {
    throw payloadInvalid();
  }
  return Boolean(
    normalizeText(message?.groupId) ||
    /@g\.us$/i.test(normalizeText(message?.from)) ||
    /@g\.us$/i.test(normalizeText(message?.to))
  );
}

function requiredString(value, maxLength, pattern = null) {
  if (typeof value !== 'string') throw payloadInvalid();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || (pattern && !pattern.test(normalized))) {
    throw payloadInvalid();
  }
  return normalized;
}

function optionalString(value, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  return requiredString(value, maxLength);
}

function phoneNumber(value) {
  return requiredString(value, 16, /^\+?[1-9]\d{6,14}$/);
}

function normalizeMessage(message, eventCreateTime) {
  const from = phoneNumber(message?.from);
  const to = phoneNumber(message?.to);
  const ycloudId = optionalString(message?.id, 256);
  const wamid = optionalString(message?.wamid, 512);
  const messageId = wamid || (ycloudId ? `ycloud:${ycloudId}` : '');
  const type = requiredString(message?.type, 64, /^[a-z][a-z0-9_]*$/);
  const timestamp = rfc3339ToUnixSeconds(
    message?.sendTime || message?.createTime || eventCreateTime
  );
  if (!messageId || !timestamp) throw payloadInvalid();

  const normalized = {
    ...message,
    id: messageId,
    from,
    to,
    timestamp,
    type,
  };
  if (type === 'unsupported' && !normalized.unsupported) {
    normalized.unsupported = { errors: Array.isArray(message?.errors) ? message.errors : [] };
  }
  return normalized;
}

function contactName(message) {
  const profile = message?.customerProfile;
  if (profile === undefined || profile === null) return '';
  if (typeof profile !== 'object' || Array.isArray(profile)) throw payloadInvalid();
  return optionalString(profile.name, 512) || optionalString(profile.username, 512);
}

function metaMetadata(message, direction) {
  const businessPhone = direction === 'inbound'
    ? normalizeText(message?.to)
    : normalizeText(message?.from);
  return {
    display_phone_number: businessPhone,
    phone_number_id: `ycloud:${businessPhone.replace(/[^0-9]/g, '')}`,
  };
}

function metaContact(message, direction) {
  const phone = direction === 'inbound'
    ? normalizeText(message?.from)
    : normalizeText(message?.to);
  const name = contactName(message);
  return {
    wa_id: phone,
    ...(name ? { profile: { name } } : {}),
  };
}

function normalizeYCloudWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw payloadInvalid();
  const eventId = requiredString(payload.id, 128);
  const eventType = requiredString(payload.type, 80);
  if (
    payload.apiVersion !== 'v2' ||
    !rfc3339ToUnixSeconds(payload.createTime) ||
    !SUPPORTED_YCLOUD_EVENT_TYPE_SET.has(eventType)
  ) {
    throw payloadInvalid();
  }

  const inboundMessage = payload.whatsappInboundMessage;
  const outboundMessage = payload.whatsappMessage;
  let message;
  let direction;
  let field;
  if (eventType === 'whatsapp.inbound_message.received') {
    if (!inboundMessage || typeof inboundMessage !== 'object' || Array.isArray(inboundMessage)) {
      throw payloadInvalid();
    }
    message = inboundMessage;
    direction = 'inbound';
    field = 'messages';
  } else if (eventType === 'whatsapp.smb.message.echoes') {
    if (!outboundMessage || typeof outboundMessage !== 'object' || Array.isArray(outboundMessage)) {
      throw payloadInvalid();
    }
    message = outboundMessage;
    direction = 'outbound';
    field = 'smb_message_echoes';
  } else {
    const hasInbound = Boolean(inboundMessage && typeof inboundMessage === 'object' && !Array.isArray(inboundMessage));
    const hasOutbound = Boolean(outboundMessage && typeof outboundMessage === 'object' && !Array.isArray(outboundMessage));
    if (hasInbound === hasOutbound) throw payloadInvalid();
    message = hasInbound ? inboundMessage : outboundMessage;
    direction = hasInbound ? 'inbound' : 'outbound';
    field = 'history';
  }

  if (isGroupMessage(message)) {
    return { eventId, accepted: false, reason: 'group_not_supported' };
  }

  const normalizedMessage = normalizeMessage(message, payload.createTime);
  const wabaId = optionalString(message?.wabaId, 128);
  const metadata = metaMetadata(normalizedMessage, direction);
  const contact = metaContact(normalizedMessage, direction);
  const value = {
    metadata,
    contacts: [contact],
  };
  if (field === 'messages') {
    value.messages = [normalizedMessage];
  } else if (field === 'smb_message_echoes') {
    value.message_echoes = [normalizedMessage];
  } else {
    const historyMessage = normalizeText(message?.status)
      ? { ...normalizedMessage, history_context: { status: normalizeText(message.status) } }
      : normalizedMessage;
    value.history = [{
      threads: [{
        id: contact.wa_id,
        ...(contact.profile?.name ? { name: contact.profile.name } : {}),
        messages: [historyMessage],
      }],
    }];
  }

  return {
    eventId,
    accepted: true,
    payload: {
      object: 'whatsapp_business_account',
      entry: [{
        id: wabaId || metadata.phone_number_id,
        changes: [{ field, value }],
      }],
    },
  };
}

module.exports = {
  DEFAULT_YCLOUD_WEBHOOK_TOLERANCE_SECONDS,
  MAX_YCLOUD_WEBHOOK_TOLERANCE_SECONDS,
  MIN_YCLOUD_WEBHOOK_TOLERANCE_SECONDS,
  SUPPORTED_YCLOUD_EVENT_TYPES,
  isValidYCloudWebhookSecret,
  normalizeYCloudWebhookPayload,
  parseYCloudSignatureHeader,
  rfc3339ToUnixSeconds,
  signatureToleranceSeconds,
  verifyYCloudWebhookSignature,
};

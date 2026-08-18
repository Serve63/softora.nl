(function (global) {
  'use strict';

  const SAFE_MESSAGES = Object.freeze({
    FUNCTION_PAYLOAD_TOO_LARGE: 'De bijlagen zijn te groot voor deze verzending. Verwijder een bijlage of kies kleinere bestanden.',
    MAILBOX_ATTACHMENT_CONTEXT_MISMATCH: 'De bijlage hoort niet bij deze veilige verzendcontext.',
    MAILBOX_ATTACHMENT_REFERENCE_EXPIRED: 'De bijlage-upload is verlopen; kies de bijlage opnieuw.',
    MAILBOX_ATTACHMENT_REFERENCE_INVALID: 'De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.',
    MAILBOX_ATTACHMENT_SIZE_MISMATCH: 'De bijlage kon niet veilig worden gecontroleerd; kies de bijlage opnieuw.',
    MAILBOX_ATTACHMENT_SIGNING_UNAVAILABLE: 'Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.',
    MAILBOX_ATTACHMENT_STORAGE_FAILED: 'Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.',
    MAILBOX_ATTACHMENT_STORAGE_UNAVAILABLE: 'Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.',
    MAILBOX_ATTACHMENT_UPLOAD_FAILED: 'Bijlage uploaden mislukt. Je mail is niet verzonden.',
    INSTANTLY_ATTACHMENTS_UNSUPPORTED: 'Instantly ondersteunt geen bijlagen bij antwoorden; verwijder de bijlage of verstuur via de gewone mailbox.',
  });

  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function findText(value, seen = new Set(), depth = 0) {
    if (depth > 4 || value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (value instanceof Error) return String(value.message || '').trim();
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    for (const key of ['detail', 'message', 'error', 'title', 'reason']) {
      const text = findText(value[key], seen, depth + 1);
      if (text) return text;
    }
    return '';
  }

  function normalize(error, fallback = 'Mail verzenden mislukt', context = '') {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    const payload = error?.payload && typeof error.payload === 'object' ? error.payload : error;
    const code = normalizeCode(error?.code || payload?.code || payload?.error?.code);
    if (status === 413 || code === 'FUNCTION_PAYLOAD_TOO_LARGE') return SAFE_MESSAGES.FUNCTION_PAYLOAD_TOO_LARGE;
    if (SAFE_MESSAGES[code]) return SAFE_MESSAGES[code];
    if (context === 'attachment-upload') return SAFE_MESSAGES.MAILBOX_ATTACHMENT_UPLOAD_FAILED;
    const text = findText(payload);
    if (!text || text === '[object Object]' || text === code || /^\[object\s+Object\]$/i.test(text)) return fallback;
    return text;
  }

  function fromResponse(response, payload, fallback = 'Mail verzenden mislukt', context = '') {
    const error = new Error();
    error.status = Number(response?.status || 0);
    error.payload = payload;
    error.code = normalizeCode(payload?.code || payload?.error?.code);
    error.context = context;
    error.message = normalize(error, fallback, context);
    return error;
  }

  const api = { fromResponse, normalize };
  global.SoftoraMailboxError = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

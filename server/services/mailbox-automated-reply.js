const { getAuthoredMessageText } = require('./mailbox-image-ownership');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeClassifierText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function hasStrongAutomatedReplyText(message) {
  const subject = normalizeClassifierText(message && message.subject);
  const content = normalizeClassifierText([
    message && message.preview ? getAuthoredMessageText(message.preview) : '',
    message && message.body ? getAuthoredMessageText(message.body) : '',
  ].filter(Boolean).join(' '));
  const automaticSubject = Boolean(
    /^(?:(?:re|fw|fwd)\s*:\s*)*(?:automatisch antwoord|automatic (?:reply|response)|auto[ -]?reply|out[ -]?of[ -]?office|afwezigheidsmelding|ontvangstbevestiging)\b/.test(subject)
  );
  const explicitlyAutomatedBody = Boolean(
    /\b(?:dit (?:bericht|e-?mail|email) is automatisch gegenereerd|dit is (?:een )?automatisch(?:e)? (?:e-?mail|mail|bericht|antwoord|reactie|ontvangstbevestiging)|this is an automated (?:e-?mail|mail|message|reply|response))\b/.test(content)
  );
  const vacationBody = Boolean(
    /\b(?:in verband met vakantie|op vakantie|vakantie|afwezig|out of (?:the )?office)\b/.test(content) &&
    /\b(?:mails?|e-?mails?|berichten) worden\b.{0,100}\b(?:niet|beperkt) gelezen\b/.test(content)
  );
  const supportSubject = /^(?:\[serviceaanvraag ontvangen\]|serviceaanvraag ontvangen)(?:\s|$)/.test(subject);
  const supportReplyMarker = /\bplease type your reply above this line\b/.test(content);
  const supportReceipt = Boolean(
    /\buw aanvraag\s*\([^)]{1,40}\)\s+is ontvangen\b/.test(content) ||
    /\byour request\s*\([^)]{1,40}\)\s+has been received\b/.test(content)
  );
  return automaticSubject || explicitlyAutomatedBody || vacationBody || (
    supportReceipt && (supportSubject || supportReplyMarker)
  );
}

function parseBooleanEvidence(value, explicitlyKnown = false) {
  const known = explicitlyKnown || value !== undefined && value !== null && value !== '';
  if (!known) return { known: false, value: false };
  if (value === true || value === 1) return { known: true, value: true };
  if (value === false || value === 0) return { known: true, value: false };
  const normalized = normalizeClassifierText(value);
  if (['1', 'true', 'yes', 'on', 'auto', 'auto_reply', 'auto-reply'].includes(normalized)) {
    return { known: true, value: true };
  }
  if (['0', 'false', 'no', 'off', 'human', 'manual'].includes(normalized)) {
    return { known: true, value: false };
  }
  return { known: false, value: false };
}

function buildAutomatedReplyEvidence(values = {}) {
  const autoSubmitted = normalizeText(values.autoSubmitted);
  const precedence = normalizeText(values.precedence);
  const autoResponseSuppress = normalizeText(values.autoResponseSuppress);
  const providerAutoReply = parseBooleanEvidence(
    values.providerAutoReply,
    values.providerAutoReplyKnown === true
  );
  const providerEventType = normalizeClassifierText(values.providerEventType);
  const sources = [];
  if (autoSubmitted) sources.push('mime:auto-submitted');
  if (precedence) sources.push('mime:precedence');
  if (autoResponseSuppress) sources.push('mime:x-auto-response-suppress');
  if (providerAutoReply.known) sources.push('instantly:is_auto_reply');
  if (providerEventType === 'auto_reply_received') {
    sources.push('instantly:webhook:auto_reply_received');
  }
  const automatedReplyEvidence = Boolean(
    (autoSubmitted && normalizeClassifierText(autoSubmitted) !== 'no') ||
    /^(?:auto_reply|auto-reply|bulk|junk|list)$/i.test(precedence) ||
    (
      autoResponseSuppress &&
      !/^(?:0|false|no|none|off)$/i.test(normalizeClassifierText(autoResponseSuppress))
    ) ||
    providerAutoReply.value ||
    providerEventType === 'auto_reply_received'
  );
  return {
    autoSubmitted,
    precedence,
    autoResponseSuppress,
    automatedReplyEvidenceKnown: sources.length > 0,
    automatedReplyEvidence,
    automatedReplyEvidenceSource: Array.from(new Set(sources)).join('+'),
  };
}

function isAutomatedCampaignReply(message) {
  if (!message) return false;
  const explicitSource = normalizeText(message.automatedReplyEvidenceSource);
  if (message.automatedReplyEvidenceKnown === true && explicitSource) {
    return message.automatedReplyEvidence === true;
  }
  const inferred = buildAutomatedReplyEvidence({
    autoSubmitted: message.autoSubmitted,
    precedence: message.precedence,
    autoResponseSuppress: message.autoResponseSuppress,
  });
  if (inferred.automatedReplyEvidence === true) return true;
  return hasStrongAutomatedReplyText(message);
}

module.exports = {
  buildAutomatedReplyEvidence,
  hasStrongAutomatedReplyText,
  isAutomatedCampaignReply,
  normalizeClassifierText,
  parseBooleanEvidence,
};

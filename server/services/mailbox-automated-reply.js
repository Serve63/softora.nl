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
  return inferred.automatedReplyEvidenceKnown === true && inferred.automatedReplyEvidence === true;
}

module.exports = {
  buildAutomatedReplyEvidence,
  isAutomatedCampaignReply,
  normalizeClassifierText,
  parseBooleanEvidence,
};

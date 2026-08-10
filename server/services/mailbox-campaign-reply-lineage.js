const {
  getMailboxMessageDirection,
} = require('./mailbox-message-provenance');
const {
  isAutomatedCampaignReply,
} = require('./mailbox-automated-reply');

const CAMPAIGN_EXACT_PARENT_EVIDENCE = 'exact-same-account-sent-campaign-parent';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeMessageId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^<+|>+$/g, '');
}

function getMessageReferenceIds(message) {
  const provenParentMessageId = message?.threadCorrelationEvidence === CAMPAIGN_EXACT_PARENT_EVIDENCE
    ? normalizeMessageId(message.threadCorrelationParentMessageId)
    : '';
  if (provenParentMessageId) return [provenParentMessageId];
  return Array.from(new Set([
    message && message.references,
    message && message.inReplyTo,
  ].flatMap((value) => {
    const source = normalizeText(value).toLowerCase();
    if (!source) return [];
    return source.match(/<[^<>]+>/g) || source.split(/[,\s]+/);
  }).map(normalizeMessageId).filter(Boolean)));
}

function getMessageReferenceLookupValues(messages, limit = 1000) {
  const values = new Set();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    [message && message.messageId, message && message.inReplyTo, message && message.references].forEach((rawValue) => {
      const source = normalizeText(rawValue);
      if (!source) return;
      const tokens = source.match(/<[^<>]+>/g) || source.split(/\s+/);
      tokens.forEach((token) => {
        const raw = normalizeText(token);
        const bare = raw.replace(/^<+|>+$/g, '');
        if (!bare) return;
        values.add(raw);
        values.add(bare);
        values.add(`<${bare}>`);
      });
    });
  });
  return Array.from(values).slice(0, limit);
}

function getExactSentCampaignParent(message, sentMessages, allowedAccounts) {
  if (!message || getMailboxMessageDirection(message) === 'sent' || isAutomatedCampaignReply(message)) return null;
  const account = normalizeEmail(message.accountEmail);
  if (!account || !allowedAccounts?.has(account)) return null;

  const rawInReplyTo = normalizeText(message.inReplyTo);
  const referenceIds = rawInReplyTo
    ? getMessageReferenceIds({ inReplyTo: rawInReplyTo })
    : getMessageReferenceIds({ references: message.references });
  // In-Reply-To is authoritative. Without it, References is only safe when it
  // identifies one parent rather than a forwarded or multi-parent chain.
  if (referenceIds.length !== 1) return null;
  const referencedMessageId = referenceIds[0];
  const matches = (Array.isArray(sentMessages) ? sentMessages : []).filter((parent) => (
    getMailboxMessageDirection(parent) === 'sent' &&
    normalizeText(parent && parent.folder).toLowerCase() === 'sent' &&
    normalizeEmail(parent && parent.accountEmail) === account &&
    normalizeMessageId(parent && parent.messageId) === referencedMessageId
  ));
  if (!matches.length || matches.some((parent) => parent?.originalCampaignOutbound !== true)) return null;
  return matches[0];
}

module.exports = {
  CAMPAIGN_EXACT_PARENT_EVIDENCE,
  getExactSentCampaignParent,
  getMessageReferenceIds,
  getMessageReferenceLookupValues,
  normalizeMessageId,
};

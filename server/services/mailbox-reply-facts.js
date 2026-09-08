function normalized(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function facts(value, pattern) {
  return [...String(value || '').matchAll(pattern)].map((match) => normalized(match[0]));
}

// Evidence labels alone do not prove facts. Check sensitive literals independently.
function hasUngroundedReplyFacts(text, policy) {
  const sentHistory = policy.conversation.filter((message) => message.folder === 'sent').map((message) => message.body).join('\n');
  const ownContext = [policy.conceptText, policy.originalText, sentHistory].filter(Boolean).join('\n');
  const allContext = [ownContext, policy.authoredText, ...policy.conversation.map((message) => message.body)].join('\n');
  const moneyPattern = /(?:€\s*\d[\d.,]*(?:\s*(?:tot|[-–])\s*€?\s*\d[\d.,]*)?|\b\d[\d.,]*\s*(?:euro|eur\b|,-))/gi;
  const numberPattern = /\b\d+(?:[.,:/-]\d+)*\b/g;
  const urlPattern = /(?:https?:\/\/|www\.)[^\s<>")]+/gi;
  const datePattern = /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|morgen|overmorgen|volgende\s+week)\b/gi;
  const grounded = (pattern, context) => {
    const known = new Set(facts(context, pattern));
    return facts(text, pattern).every((fact) => known.has(fact));
  };
  if (!grounded(moneyPattern, ownContext) || !grounded(numberPattern, allContext) ||
      !grounded(urlPattern, allContext) || !grounded(datePattern, allContext)) return true;
  // Do not turn a customer's proposed price into our offer, even without a euro sign.
  const priceClauses = text.match(/\b(?:kost(?:en)?|prijs|tarief|bedrag|voor)\s+(?:(?:is|van|wordt|bedraagt|ongeveer|zo'n|circa)\s+){0,3}\d[\d.,]*/gi) || [];
  const ownNumbers = new Set(facts(ownContext, numberPattern));
  if (priceClauses.some((clause) => facts(clause, numberPattern).some((number) => !ownNumbers.has(number)))) return true;
  if (/\b(?:ik|wij|we)\b[^.!?]{0,70}\b(?:gebruik\w*|werk\w*|bouw\w*)\b[^.!?]{0,50}\b(?:webflow|wordpress|shopify)\b/i.test(text) &&
      !/\b(?:ik|wij|we)\b[^.!?]{0,70}\b(?:gebruik\w*|werk\w*|bouw\w*)\b[^.!?]{0,50}\b(?:webflow|wordpress|shopify)\b/i.test(ownContext)) return true;
  const completedPattern = /\b(?:aangepast|ingepland|verstuurd|verzonden|verwijderd|uitgeschreven|gepubliceerd|opgelost|overgezet)\b/gi;
  if (/\b(?:ik\s+heb|we\s+hebben|wij\s+hebben|is\s+(?:nu|al|inmiddels))\b/i.test(text) &&
      !grounded(completedPattern, policy.conceptText)) return true;
  if (/\b(?:gegarandeerd|garandeer|garanderen|100%|nooit\s+meer\s+gehackt)\b/i.test(text)) return true;
  return false;
}

module.exports = { hasUngroundedReplyFacts };

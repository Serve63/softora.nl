const REPLY_QUOTE_HEADER_PATTERN = /^(?:op\s.+\sheeft\s.+\shet\svolgende\sgeschreven:|op\s.+\sschreef\s.+:|on\s.+\swrote:|van:|from:)/i;
const CTA_PATTERN = /\b(?:afspraak|langskom|langs\s+te\s+komen|volgende\s+week|\[dag\]|even\s+bellen|kennismak|verder\s+praten|samen\s+bespreken)\b/i;
const GENERIC_FILLER_PATTERN = /\b(?:leuke\s+vraag|wat\s+leuk|ik\s+denk\s+graag\s+mee|mooie\s+kansen|interessante\s+mogelijkheden|hopelijk\s+kunnen\s+we|lijkt\s+me\s+goed|kijken\s+wat\s+er\s+mogelijk\s+is)\b/i;
const REPLY_POLICY_VERSION = 'softora-grounded-reply-v2';
const STOP_WORDS = new Set([
  'aan', 'als', 'ben', 'bij', 'dan', 'dat', 'de', 'deze', 'die', 'dit', 'een', 'en', 'er', 'geen',
  'heb', 'het', 'hier', 'hoe', 'ik', 'in', 'is', 'je', 'kan', 'maar', 'met', 'mijn', 'niet', 'nog',
  'om', 'ons', 'ook', 'op', 'te', 'van', 'voor', 'wat', 'we', 'wel', 'wij', 'wil', 'zijn', 'zou',
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function authoredReplyText(value) {
  const lines = clean(value).split('\n');
  const quoteIndex = lines.findIndex((line) => REPLY_QUOTE_HEADER_PATTERN.test(line.trim()));
  return (quoteIndex >= 0 ? lines.slice(0, quoteIndex) : lines).join('\n').trim();
}

function matches(value, pattern) {
  return pattern.test(value);
}

function analyzeMailboxReplyContext(inboundText, options = {}) {
  const authoredText = authoredReplyText(inboundText);
  const conceptText = clean(options.conceptText);
  const originalText = clean(options.originalText);
  const text = normalize(authoredText);
  const rejection = matches(text,
    /\b(?:geen|niet)\s+(?:enige\s+)?(?:interesse|behoefte|belangstelling)\b|\bniet\s+geinteresseerd\b|\bniet\s+meer\s+mailen\b|\bafmelden\b|\buitschrijven\b|\bgeen\s+gebruik\s+maken\b|\bniet\s+ingaan\s+op\b|\blaat\s+het\s+hierbij\b|\bhelaas\s+niet\b|\bniet\s+wat\s+(?:ik|we|wij)\s+zoek(?:en)?\b|\bbuiten\s+(?:onze|de)\s+scope\b|\b(?:traject|samenwerking|vervolg|opdracht)\b[^.!?]{0,120}\b(?:niet\s+aan\s+de\s+orde|geen\s+sprake|niet\s+relevant)\b|\b(?:wij|we|ik)\s+(?:gaan|willen|kunnen)\s+(?:hier\s+)?niet\s+(?:mee\s+)?(?:verder|door)\b/
  );
  const satisfied = matches(text,
    /\btevreden\s+(?:ben|zijn)?\s*(?:met|over)\b|\b(?:website|site)\s+voldoet\b|\bhebben\s+al\s+(?:een\s+)?(?:goede\s+)?(?:partij|bouwer|website)\b|\bblij\s+met\s+(?:onze|mijn|de)\s+(?:huidige\s+)?(?:site|website|partij)\b/
  );
  const priceQuestion = matches(text, /\b(?:prijs|prijzen|kosten|tarief|offerte|wat\s+kost|hoeveel\s+kost)\b/);
  const previewRequest = matches(text,
    /\b(?:stuur|deel|ontvang|bekijk|zien|toon)\b[^.!?]{0,100}\b(?:preview|ontwerp|voorbeeld)\b|\b(?:preview|ontwerp)\b[^.!?]{0,100}\b(?:sturen|delen|ontvangen|bekijken|zien)\b/
  );
  const technicalQuestion = matches(text,
    /\b(?:welk(?:e)?\s+(?:programma|tool|platform|systeem)|waarmee\s+(?:werk|bouw|maak)|waarin\s+(?:werk|bouw|maak)|wat\s+gebruik\s+je|hoe\s+(?:(?:heb|had)\s+)?je\s+(?:dit|dat|het)\s+(?:(?:hebt|had)\s+)?(?:gemaakt|gebouwd)|webflow|wordpress|shopify|code)\b[^?]{0,180}\??/
  );
  const discussionRequest = matches(text,
    /\b(?:graag|wil|willen|kun|kunnen|zou)\b[^.!?]{0,140}\b(?:bespreken|afspreken|langskomen|bellen|verder\s+praten|mogelijkheden\s+doornemen|meer\s+vertellen|toelichten)\b|\b(?:kun|kan|zou|heb)\s+je\b[^.!?]{0,140}\b(?:bespreken|bellen|langskomen|toelichten|voorbeelden|wat\s+er\s+mogelijk)\b/
  );
  const explicitInterest = matches(text,
    /\b(?:ik|we|wij)\s+(?:ben|zijn|hebben)\s+(?:wel\s+)?(?:interesse|geinteresseerd|benieuwd)\b|\b(?:ik|we|wij)\s+(?:vind|vinden)\b[^.!?]{0,60}\binteressant\b|\b(?:dit|dat|het)\s+(?:lijkt|klinkt|vinden|vind)\b[^.!?]{0,60}\binteressant\b|\bwillen\s+(?:hier\s+)?(?:graag\s+)?(?:meer\s+over\s+weten|mee\s+verder)\b/
  );
  const feedback = matches(text,
    /\b(?:feedback|verbeter|tip|advies|opmerking|mis\s+ik|zou\s+ik|mag\s+meer|uitstraling|lettertype|kleurgebruik|persoonlijke\s+touch)\b/
  );

  let intent = 'ambiguous';
  if (rejection) intent = 'rejection';
  else if (satisfied) intent = 'satisfied';
  else if (priceQuestion) intent = 'price_question';
  else if (previewRequest) intent = 'preview_request';
  else if (technicalQuestion) intent = 'technical_question';
  else if (discussionRequest || explicitInterest) intent = 'forward_interest';
  else if (feedback) intent = 'feedback_only';
  else if (text) intent = 'acknowledgement';

  const forwardCommercialSignal = !rejection && !satisfied && (
    priceQuestion || previewRequest || discussionRequest || explicitInterest
  );
  const allowedEvidence = [
    'received.body',
    'received.intent',
    'sender.identity',
  ];
  if (conceptText) allowedEvidence.push('concept.body');
  if (originalText) allowedEvidence.push('original.body');
  if (technicalQuestion) allowedEvidence.push('known.design-built-with-code');
  if (priceQuestion) allowedEvidence.push('known.price-depends-on-scope');
  if (forwardCommercialSignal) allowedEvidence.push('received.forward-request');

  return Object.freeze({
    version: REPLY_POLICY_VERSION,
    intent,
    authoredText,
    conceptText,
    originalText,
    rejection,
    satisfied,
    priceQuestion,
    previewRequest,
    technicalQuestion,
    feedback,
    forwardCommercialSignal,
    ctaAllowed: forwardCommercialSignal,
    allowedEvidence: Object.freeze(allowedEvidence),
  });
}

function legacyIntent(policy) {
  if (policy.rejection || policy.satisfied) return 'rejection';
  if (policy.priceQuestion) return 'price';
  if (policy.ctaAllowed || policy.technicalQuestion) return 'interest';
  return 'neutral';
}

function parseStructuredDraft(value) {
  const raw = clean(value).replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.paragraphs)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function meaningfulTokens(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token));
}

function paragraphHasGrounding(paragraph, policy) {
  const text = clean(paragraph?.text);
  const evidence = Array.isArray(paragraph?.evidence)
    ? paragraph.evidence.filter((item) => policy.allowedEvidence.includes(item))
    : [];
  if (!text || !evidence.length) return false;
  if (evidence.includes('known.design-built-with-code') && /\b(?:code|maatwerk|websitebouwer)\b/i.test(text)) {
    return true;
  }
  if (evidence.includes('known.price-depends-on-scope') && /\b(?:prijs|kost|wensen|nodig)\b/i.test(text)) {
    return true;
  }
  if (evidence.includes('received.forward-request') && CTA_PATTERN.test(text) && policy.ctaAllowed) {
    return true;
  }
  if (evidence.includes('received.intent') && /\b(?:dankjewel|duidelijk|begrijpelijk|interesse|feedback|preview|reactie)\b/i.test(text)) {
    return true;
  }
  if (!evidence.some((item) => ['received.body', 'concept.body', 'original.body'].includes(item))) {
    return false;
  }
  const evidenceText = [
    evidence.includes('received.body') ? policy.authoredText : '',
    evidence.includes('concept.body') ? policy.conceptText : '',
    evidence.includes('original.body') ? policy.originalText : '',
  ].filter(Boolean).join(' ');
  const evidenceTokens = new Set(meaningfulTokens(evidenceText));
  return meaningfulTokens(text).some((token) => evidenceTokens.has(token));
}

function hasUnsafeOrIrrelevantText(value, policy) {
  const text = clean(value);
  if (!text || GENERIC_FILLER_PATTERN.test(text)) return true;
  if (/^(?:beste|hoi|hallo|geachte)\b/i.test(text)) return true;
  if (/\bmet\s+vriendelijke\s+groet\b/i.test(text)) return true;
  if (/\bjullie\b|\buw\b|\bu\b/i.test(text)) return true;
  if (/(?:€|\beuro\b|\b\d+(?:[.,]\d+)?\s*(?:per|,-))/i.test(text)) return true;
  if (/\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i.test(text)) return true;
  if (!policy.ctaAllowed && CTA_PATTERN.test(text)) return true;
  if (
    policy.technicalQuestion &&
    /\b(?:je|jouw)\s+(?:huidige\s+)?(?:site|website)\b[^.!?]{0,80}\bwebflow\b/i.test(text)
  ) return true;
  return false;
}

function ensureOneSmile(paragraphs) {
  const cleaned = paragraphs
    .map((paragraph) => clean(paragraph).replace(/😁/gu, '').trim())
    .filter(Boolean);
  if (!cleaned.length) return ['Dankjewel voor je reactie 😁'];
  cleaned[0] = `${cleaned[0]} 😁`;
  return cleaned;
}

function deterministicParagraphs(policy) {
  if (policy.rejection || policy.satisfied) {
    return ['Dankjewel voor je duidelijke reactie. Helemaal duidelijk 😁'];
  }
  if (policy.intent === 'feedback_only') {
    return ['Dankjewel voor je uitgebreide en concrete feedback, daar heb ik zeker iets aan 😁'];
  }
  if (policy.technicalQuestion) {
    const paragraphs = [
      'Goede vraag. Het ontwerp dat ik stuurde heb ik volledig op maat met code gebouwd. Daardoor kan ik de indeling, uitstraling en werking precies afstemmen op wat nodig is, zonder vast te zitten aan een standaard websitebouwer 😁',
    ];
    if (policy.ctaAllowed) {
      paragraphs.push('Is het een idee dat ik volgende week [dag] even langskom? Dan kan ik je kort laten zien hoe het ontwerp is opgebouwd en kunnen we bespreken wat voor je website handig is.');
    }
    return paragraphs;
  }
  if (policy.priceQuestion) {
    return [
      'Goede vraag. De prijs hangt af van wat je precies wilt en wat daarvoor nodig is 😁',
      'Is het een idee dat ik volgende week [dag] even langskom? Dan kunnen we je wensen kort doornemen en kan ik daarna eerlijk aangeven wat dat zou kosten.',
    ];
  }
  if (policy.previewRequest) {
    return [
      'Leuk dat je de preview wilt bekijken. Ik stuur die graag door 😁',
      'Is het een idee dat ik volgende week [dag] even langskom? Dan kunnen we het ontwerp samen kort bekijken en bespreken wat voor je website handig is.',
    ];
  }
  if (policy.intent === 'forward_interest') {
    return [
      'Leuk om te horen dat je interesse hebt 😁',
      'Is het een idee dat ik volgende week [dag] even langskom? Dan kunnen we het ontwerp samen kort bekijken en bespreken wat voor je website handig is.',
    ];
  }
  return ['Dankjewel voor je reactie 😁'];
}

function validateStructuredParagraphs(structured, policy) {
  if (structured.intent !== policy.intent) return null;
  if (structured.ctaAllowed !== policy.ctaAllowed) return null;
  if (structured.paragraphs.length < 1 || structured.paragraphs.length > 3) return null;
  const paragraphs = [];
  const semanticKeys = new Set();
  let ctaCount = 0;
  for (const paragraph of structured.paragraphs) {
    const value = clean(paragraph?.text);
    if (!value || value.length > 500) return null;
    if (hasUnsafeOrIrrelevantText(value, policy)) return null;
    if (!paragraphHasGrounding(paragraph, policy)) return null;
    const semanticKey = normalize(value).replace(/[^a-z0-9]+/g, ' ');
    if (semanticKeys.has(semanticKey)) return null;
    semanticKeys.add(semanticKey);
    if (CTA_PATTERN.test(value)) ctaCount += 1;
    paragraphs.push(value);
  }
  if (ctaCount > 1 || (!policy.ctaAllowed && ctaCount)) return null;
  return ensureOneSmile(paragraphs);
}

function enforceGroundedMailboxReply(generatedValue, options = {}) {
  const policy = analyzeMailboxReplyContext(options.inboundText, {
    conceptText: options.conceptText,
    originalText: options.originalSentMail?.body || options.originalSentMail?.preview,
  });
  const structured = parseStructuredDraft(generatedValue);
  const paragraphs = structured
    ? validateStructuredParagraphs(structured, policy) || deterministicParagraphs(policy)
    : deterministicParagraphs(policy);
  return { policy, paragraphs };
}

module.exports = {
  REPLY_POLICY_VERSION,
  analyzeMailboxReplyContext,
  authoredReplyText,
  enforceGroundedMailboxReply,
  legacyIntent,
  parseStructuredDraft,
};

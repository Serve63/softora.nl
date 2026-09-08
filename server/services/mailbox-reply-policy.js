const REPLY_QUOTE_HEADER_PATTERN = /^(?:op\s.+\sheeft\s.+\shet\svolgende\sgeschreven:|op\s.+\sschreef\s.+:|on\s.+\swrote:|van:|from:)/i;
const CTA_PATTERN = /\b(?:langskom|langskomen|kennismaken|afspraak\s+maken|even\s+bellen|samen\s+bespreken|samen\s+(?:kort\s+)?bekijken|welke\s+dag\s+(?:past|schikt)|wanneer\s+(?:past|schikt))\b/i;
const REPLY_POLICY_VERSION = 'softora-grounded-reply-v7';
const { hasUngroundedReplyFacts } = require('./mailbox-reply-facts');
const STOP_WORDS = new Set([
  'aan', 'als', 'ben', 'bij', 'dan', 'dat', 'de', 'deze', 'die', 'dit', 'een', 'en', 'er', 'geen',
  'heb', 'het', 'hier', 'hoe', 'ik', 'in', 'is', 'je', 'kan', 'maar', 'met', 'mijn', 'niet', 'nog',
  'om', 'ons', 'ook', 'op', 'te', 'van', 'voor', 'wat', 'we', 'wel', 'wij', 'wil', 'zijn', 'zou',
]);
const FEEDBACK_THEMES = Object.freeze([
  Object.freeze({
    key: 'style_mismatch',
    detect: /(?=[\s\S]*\b(?:te\s+(?:strak|clean|chique|zakelijk|formeel|donker|druk|rustig|minimalistisch)|niet\s+(?:echt\s+)?(?:bij|passend))\b)(?=[\s\S]*\b(?:vrolijk\w*|speels\w*|ibiza(?:\s+vibe)?|warm\w*|persoonlijk\w*|kleurrijk\w*|eigenzinnig\w*|stoer\w*|luxe|uitbundig\w*)\b)/i,
    response: /\b(?:strak|clean|chique)\b[\s\S]{0,180}\b(?:vrolijk|speels|ibiza)\b|\b(?:vrolijk|speels|ibiza)\b[\s\S]{0,180}\b(?:strak|clean|chique)\b/i,
  }),
  Object.freeze({
    key: 'generic_identity',
    detect: /\b(?:te\s+(?:vlak|algemeen|generiek)|algemene\s+(?:identiteit|uitstraling)|mist?\s+(?:een\s+)?identiteit|identiteit\s+(?:mist|ontbreekt)|voor\s+iedere\s+\w+\s+gebruikt)\b/i,
    phrase: 'de te algemene identiteit',
    response: /\b(?:algemen|generiek|vlak)[a-z]*\s+(?:identiteit|uitstraling)|identiteit\b/i,
  }),
  Object.freeze({
    key: 'authentic_atmosphere',
    detect: /\b(?:meer\s+van\s+(?:onze|mijn)|mis(?:sen)?\s+(?:ik|we)?\s*(?:vooral\s+)?(?:onze|mijn))\s+eigen\s+sfeer\b/i,
    phrase: 'meer van de eigen sfeer en identiteit',
    response: /\b(?:eigen\s+sfeer|sfeer[^.!?]{0,100}identiteit|identiteit[^.!?]{0,100}sfeer)\b/i,
  }),
  Object.freeze({
    key: 'non_own_imagery',
    detect: /\b(?:fotografie|foto(?:'s|s)?|beelden?|eten)\b[^.!?\n]{0,100}\b(?:niet\s+(?:van|door|eigen)|verkeerd|generiek|klopt?\s+niet)\b|\bniet\s+door\s+(?:onze|mijn)\s+\w+\s+gemaakt\b/i,
    phrase: 'het gebruik van beelden die niet bij het bedrijf horen',
    response: /\b(?:beelden?|fotografie|foto(?:'s|s)?)\b[^.!?]{0,100}\b(?:niet\s+bij|eigen|bedrijf)\b/i,
  }),
  Object.freeze({
    key: 'missing_brand_style',
    detect: /\b(?:huisstijl|eigen\s+stijl)\b[^.!?\n]{0,100}\b(?:niet|nergens|mist|ontbreekt|terug)\b|\b(?:mist|ontbreekt)\b[^.!?\n]{0,80}\b(?:huisstijl|eigen\s+stijl)\b/i,
    phrase: 'het ontbreken van de huisstijl',
    response: /\b(?:huisstijl|eigen\s+stijl)\b/i,
  }),
  Object.freeze({
    key: 'inaccurate_details',
    detect: /\b(?:glazen?|bierkleur|kleur\s+van\s+het\s+bier|producten?|aanbod|silo(?:'s|s)?|lichtreclame|locatie|tramkade)\b[^.!?\n]{0,120}\b(?:niet|onjuist|verkeerd|klopt|aanwezig|eigen)\b|\b(?:niet|onjuist|verkeerd)\b[^.!?\n]{0,120}\b(?:glazen?|bierkleur|producten?|silo(?:'s|s)?|locatie|tramkade)\b/i,
    phrase: 'de onjuiste product- en locatiedetails',
    response: /\b(?:product|locatie|detail|kleur|glas|glazen|aanbod)\b/i,
  }),
  Object.freeze({
    key: 'broken_text',
    detect: /\b(?:tekst|letters?|lichtreclame)\b[^.!?\n]{0,100}\b(?:valt?\s+uit\s+elkaar|afgebroken|kapot|onleesbaar|fout)\b|\bte\s+duidelijk\s+ai\b/i,
    phrase: 'de tekst die visueel uit elkaar viel',
    response: /\b(?:tekst|letters?|lichtreclame)\b[^.!?]{0,100}\b(?:uit\s+elkaar|afgebroken|kapot|onleesbaar|fout)\b/i,
  }),
]);
const POSITIVE_FEEDBACK_THEMES = Object.freeze([
  Object.freeze({
    key: 'atmosphere',
    detect: /\b(?:goed|sterk|mooi|fijn|geslaagd|waardeer\w*)\b[^.!?\n]{0,100}\bsfeer\b|\bsfeer\b[^.!?\n]{0,60}\b(?:goed|sterk|mooi|fijn|geslaagd)\b/i,
    phrase: 'de sfeer',
    response: /\bsfeer\b/i,
  }),
  Object.freeze({
    key: 'overview',
    detect: /\b(?:goed|sterk|mooi|fijn|geslaagd|waardeer\w*)\b[^.!?\n]{0,100}\boverzicht\b|\boverzicht\b[^.!?\n]{0,60}\b(?:goed|sterk|mooi|fijn|geslaagd)\b/i,
    phrase: 'het overzicht',
    response: /\boverzicht\b/i,
  }),
  Object.freeze({
    key: 'presentation',
    detect: /\b(?:design|ontwerp|opzet)\b[^.!?\n]{0,80}\b(?:netjes|verzorgd|mooi|goed)\b|\b(?:netjes|verzorgd|mooi|goed)\b[^.!?\n]{0,80}\b(?:design|ontwerp|opzet)\b/i,
    phrase: 'de verzorgde opzet',
    response: /\b(?:verzorgd|netjes|opzet)\b/i,
  }),
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
  const quoteIndex = lines.findIndex((line) => REPLY_QUOTE_HEADER_PATTERN.test(line.trim()) || /^(?:(?:met\s+)?(?:hartelijke|vriendelijke)\s+groet(?:en)?|groetjes|groeten|groet|mvg)[,.!;]?$/i.test(line.trim()) || /^>/.test(line.trim()));
  return (quoteIndex >= 0 ? lines.slice(0, quoteIndex) : lines).join('\n').trim();
}

function matches(value, pattern) {
  return pattern.test(value);
}

function extractFeedbackDetails(value) {
  const authoredText = authoredReplyText(value);
  const themes = FEEDBACK_THEMES.filter((theme) => theme.detect.test(authoredText));
  const positiveThemes = POSITIVE_FEEDBACK_THEMES.filter(
    (theme) => theme.detect.test(authoredText)
  );
  const bulletCount = authoredText
    .split('\n')
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line))
    .length;
  return Object.freeze({
    themes: Object.freeze(themes),
    positiveThemes: Object.freeze(positiveThemes),
    bulletCount,
    substantive: themes.length >= 1,
  });
}

function analyzeMailboxReplyContext(inboundText, options = {}) {
  const authoredText = authoredReplyText(inboundText);
  const conceptText = clean(options.conceptText);
  const originalText = clean(options.originalText);
  const conversation = Array.isArray(options.conversation) ? options.conversation : [];
  const questions = (authoredText.match(/[^.!?\n]+\?/g) || []).slice(0, 12)
    .map((text, index) => ({ id: `q${index + 1}`, text: text.trim() }));
  const text = normalize(authoredText);
  const rejection = matches(text,
    /\b(?:geen|niet)\s+(?:enige\s+)?(?:interesse|behoefte|belangstelling)\b|\bniet\s+geinteresseerd\b|\bniet\s+meer\s+mailen\b|\bmail\s+(?:mij|ons)\s+niet\s+meer\b|\bschrijf\s+(?:mij|ons)\s+uit\b|\bafmelden\b|\buitschrijven\b|\bgeen\s+gebruik\s+maken\b|\bniet\s+ingaan\s+op\b|\blaat\s+het\s+hierbij\b|\bhelaas\s+niet\b|\bniet\s+wat\s+(?:ik|we|wij)\s+zoek(?:en)?\b|\bbuiten\s+(?:onze|de)\s+scope\b|\b(?:traject|samenwerking|vervolg|opdracht)\b[^.!?]{0,120}\b(?:niet\s+aan\s+de\s+orde|geen\s+sprake|niet\s+relevant)\b|\b(?:wij|we|ik)\s+(?:gaan|willen|kunnen)\s+(?:hier\s+)?niet\s+(?:mee\s+)?(?:verder|door)\b|\b(?:wij|we|ik)\s+(?:gaan|zullen|willen)\s+(?:het|dit|dat)\s+(?:echter\s+)?niet\s+gebruiken\b/
  );
  const noFurtherContact = matches(text,
    /\bniet\s+meer\s+mailen\b|\bmail\s+(?:mij|ons)\s+niet\s+(?:meer|opnieuw)\b|\bgeen\s+(?:verdere\s+)?berichten\b|\bschrijf\s+(?:mij|ons)\s+uit\b|\bafmelden\b|\buitschrijven\b|\bverwijder\s+(?:mij|ons)\b|\blaat\s+(?:mij|ons)\s+met\s+rust\b/
  );
  const satisfied = matches(text,
    /\btevreden\s+(?:ben|zijn)?\s*(?:met|over)\b|\b(?:website|site)\s+voldoet\b|\bhebben\s+al\s+(?:een\s+)?(?:goede\s+)?(?:partij|bouwer|website)\b|\bblij\s+met\s+(?:onze|mijn|de)\s+(?:huidige\s+)?(?:site|website|partij)\b/
  );
  const priceQuestion = matches(text, /\b(?:wat|hoeveel|welke|globaal|indicatie|benieuwd|weten|stuur|geven)\b[^.!?]{0,100}\b(?:kost|kosten|prijs|prijzen|tarief|offerte)\b|\b(?:prijs|kosten|tarief|offerte)\b[^.!?]{0,60}\?/);
  const previewRequest = matches(text,
    /\b(?:stuur|deel|ontvang|bekijk|zien|toon)\b[^.!?]{0,100}\b(?:preview|ontwerp|voorbeeld)\b|\b(?:preview|ontwerp)\b[^.!?]{0,100}\b(?:sturen|delen|ontvangen|bekijken|zien)\b/
  );
  const technicalQuestion = matches(text,
    /\b(?:welk(?:e)?\s+(?:programma|tool|platform|systeem)|waarmee\s+(?:werk|bouw|maak)|waarin\s+(?:werk|bouw|maak)|wat\s+gebruik\s+je|hoe\s+(?:(?:heb|had)\s+)?je\s+(?:dit|dat|het)\s+(?:(?:hebt|had)\s+)?(?:gemaakt|gebouwd))\b|\b(?:webflow|wordpress|shopify|code)\b[^.!?]{0,100}\?/
  );
  const discussionRequest = matches(text,
    /\b(?:graag|wil|willen|kun|kunnen|zou)\b[^.!?]{0,140}\b(?:bespreken|afspreken|langskomen|bellen|verder\s+praten|mogelijkheden\s+doornemen|meer\s+vertellen|toelichten)\b|\b(?:kun|kan|zou|heb)\s+je\b[^.!?]{0,140}\b(?:bespreken|bellen|langskomen|toelichten|voorbeelden|wat\s+er\s+mogelijk)\b/
  );
  const explicitInterest = matches(text,
    /\b(?:ik|we|wij)\s+(?:ben|zijn|hebben)\s+(?:wel\s+)?(?:interesse|geinteresseerd|benieuwd)\b|\b(?:ik|we|wij)\s+(?:vind|vinden)\b[^.!?]{0,60}\binteressant\b|\b(?:dit|dat|het)\s+(?:lijkt|klinkt|vinden|vind)\b[^.!?]{0,60}\binteressant\b|\bwillen\s+(?:hier\s+)?(?:graag\s+)?(?:meer\s+over\s+weten|mee\s+verder)\b/
  );
  const feedbackDetails = extractFeedbackDetails(authoredText);
  const feedback = feedbackDetails.themes.length > 0 || matches(text,
    /\b(?:feedback|verbeter|tip|advies|opmerking|mis\s+ik|zou\s+ik|mag\s+meer|uitstraling|lettertype|kleurgebruik|persoonlijke\s+touch)\b/
  );
  const audienceForm = (
    /\bjullie\b/i.test(originalText) ||
    /\b(?:we|wij|ons|onze)\b/i.test(authoredText)
  ) ? 'jullie' : 'je';
  const anniversaryMatch = authoredText.match(/\b(\d{1,3})\s*[- ]?\s*jarig(?:e)?\s+jubileum\b/i);
  const styleBrandMatch = authoredText.match(/\b([\p{L}][\p{L}0-9.&'’-]{1,50})\s+staat\s+juist\s+voor\b/iu);
  const replyHighlights = Object.freeze({
    lateTiming: /\b(?:net|helaas)\s+te\s+laat\b/i.test(authoredText),
    recentWebsiteRenewal: (
      /\b(?:site|website)\b[^.!?\n]{0,100}\b(?:net|recent|onlangs)\b[^.!?\n]{0,80}\bvernieuwd\b/i.test(authoredText) ||
      /\b(?:net|recent|onlangs)\b[^.!?\n]{0,80}\b(?:site|website)\b[^.!?\n]{0,80}\bvernieuwd\b/i.test(authoredText)
    ),
    anniversaryYears: anniversaryMatch ? Number(anniversaryMatch[1]) : null,
    styleBrandName: styleBrandMatch ? styleBrandMatch[1] : '',
  });

  let intent = 'ambiguous';
  if (rejection) intent = 'rejection';
  else if (satisfied) intent = 'satisfied';
  else if (priceQuestion) intent = 'price_question';
  else if (previewRequest) intent = 'preview_request';
  else if (technicalQuestion) intent = 'technical_question';
  else if (discussionRequest || explicitInterest) intent = 'forward_interest';
  else if (feedback) intent = 'feedback_only';
  else if (text) intent = 'acknowledgement';

  const budgetOrTimingLimit = /\b(?:geen\s+(?:ruimte|budget|tijd)|pas\s+(?:in|vanaf)|nu\s+niet|voorlopig\s+niet)\b/.test(text);
  const shortConfirmation = !questions.length && !rejection && !satisfied && /\b(?:tot\s+(?:morgen|straks|dan|maandag|dinsdag|woensdag|donderdag|vrijdag)|afgesproken)\b/.test(text) && text.length < 240;
  const forwardCommercialSignal = !noFurtherContact && !rejection && !budgetOrTimingLimit && (!satisfied || discussionRequest) && (
    priceQuestion || previewRequest || discussionRequest || explicitInterest
  );
  const allowedEvidence = [
    'received.body',
    'received.intent',
    'sender.identity',
  ];
  if (conceptText) allowedEvidence.push('concept.body');
  if (originalText) allowedEvidence.push('original.body');
  if (conversation.length) allowedEvidence.push('conversation.body');
  if (technicalQuestion) allowedEvidence.push('known.design-built-with-code');
  if (priceQuestion) allowedEvidence.push('known.price-depends-on-scope');
  if (forwardCommercialSignal) allowedEvidence.push('received.forward-request');
  if (feedbackDetails.substantive) allowedEvidence.push('received.feedback-details');
  const futureDoorOpenAllowed = !noFurtherContact && !forwardCommercialSignal && (
    rejection || satisfied || feedback
  );
  if (futureDoorOpenAllowed) allowedEvidence.push('known.future-door-open');

  return Object.freeze({
    version: REPLY_POLICY_VERSION,
    intent,
    authoredText,
    conceptText,
    originalText,
    conversation,
    questions,
    shortConfirmation,
    budgetOrTimingLimit,
    rejection,
    noFurtherContact,
    satisfied,
    priceQuestion,
    previewRequest,
    technicalQuestion,
    feedback,
    feedbackDetails,
    substantiveFeedback: feedbackDetails.substantive,
    audienceForm,
    replyHighlights,
    futureDoorOpenAllowed,
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
  const evidence = Array.isArray(paragraph?.evidence) ? paragraph.evidence : [];
  if (!evidence.length || evidence.some((item) => !policy.allowedEvidence.includes(item))) return false;
  const text = clean(paragraph.text);
  if (evidence.includes('received.intent') && /\b(?:dank\w*|bedankt|begrijp\w*|snap|duidelijk|natuurlijk|geen probleem|beterschap|top|tot|laat|fijn|leuk)\b/i.test(text)) return true;
  if (evidence.includes('known.design-built-with-code') && /\b(?:code|maatwerk)\b/i.test(text)) return true;
  if (evidence.includes('known.price-depends-on-scope') && /\b(?:prijs|kost|kosten|wensen|nodig|scope)\b/i.test(text)) return true;
  if (evidence.includes('received.forward-request') && policy.ctaAllowed && CTA_PATTERN.test(text)) return true;
  if (evidence.includes('known.future-door-open') && policy.futureDoorOpenAllowed && /\b(?:later|mocht|toekomst)\b/i.test(text)) return true;
  const sources = [evidence.includes('received.body') ? policy.authoredText : '', evidence.includes('concept.body') ? policy.conceptText : '', evidence.includes('original.body') ? policy.originalText : '', evidence.includes('conversation.body') ? policy.conversation.map((message) => message.body).join(' ') : '', evidence.includes('received.feedback-details') ? policy.authoredText : ''].join(' ');
  const tokens = new Set(meaningfulTokens(sources));
  return meaningfulTokens(text).some((token) => tokens.has(token));
}

function hasUnsafeOrIrrelevantText(value, policy) {
  const text = clean(value);
  if (!text || /^(?:beste|hoi|hallo|geachte|goedendag)\b/i.test(text)) return true;
  if (/\b(?:met\s+vriendelijke\s+groet|groetjes,?\s+(?:serve|servé|martijn))\b/i.test(text)) return true;
  if (/\[(?:dag|naam|link|prijs|datum|tijd)[^\]]*\]/i.test(text)) return true;
  if (!policy.ctaAllowed && CTA_PATTERN.test(text) && !policy.shortConfirmation) return true;
  if (policy.noFurtherContact && /\b(?:mocht|toekomst|berichtje|laat\s+maar\s+weten|altijd\s+welkom)\b|[😁😊😄]/u.test(text)) return true;
  return hasUngroundedReplyFacts(text, policy);
}

function hasRequiredReplyCoverage(paragraphs, policy, structured) {
  const response = paragraphs.join(' ');
  const answered = new Set(structured.paragraphs.flatMap((item) => Array.isArray(item.answers) ? item.answers : []));
  if (policy.questions.some((question) => !answered.has(question.id))) return false;
  if (policy.priceQuestion && !/\b(?:prijs|kost|kosten|tarief|offerte|bedrag|euro)\b|€/i.test(response)) return false;
  if (policy.technicalQuestion && !/\b(?:code|platform|programma|systeem|webflow|wordpress|shopify|maatwerk)\b/i.test(response)) return false;
  if (policy.previewRequest && !/\b(?:preview|ontwerp|voorbeeld|bekijken)\b/i.test(response)) return false;
  if (!policy.substantiveFeedback) return true;
  const coveredThemes = policy.feedbackDetails.themes.filter((theme) => {
    if (theme.key !== 'style_mismatch') return theme.response.test(response);
    const words = policy.authoredText.match(/\b(?:strak|clean|chique|zakelijk|formeel|donker|druk|rustig|minimalistisch|vrolijk\w*|speels\w*|ibiza|warm\w*|persoonlijk\w*|kleurrijk\w*|eigenzinnig\w*|stoer\w*|luxe|uitbundig\w*)\b/gi) || [];
    return [...new Set(words.map(normalize))].filter((word) => normalize(response).includes(word)).length >= 2;
  }).length;
  return coveredThemes >= Math.min(2, policy.feedbackDetails.themes.length);
}

function validateStructuredParagraphs(structured, policy) {
  if (structured.intent !== policy.intent) return null;
  if (structured.ctaAllowed !== policy.ctaAllowed) return null;
  if (structured.paragraphs.length < 1 || structured.paragraphs.length > 8) return null;
  const paragraphs = [];
  const semanticKeys = new Set();
  let ctaCount = 0;
  for (const paragraph of structured.paragraphs) {
    if (!paragraph || typeof paragraph.text !== 'string') return null;
    if (paragraph.answers != null && (!Array.isArray(paragraph.answers) || paragraph.answers.some((id) => !policy.questions.some((question) => question.id === id)))) return null;
    const value = clean(paragraph.text);
    if (!value || value.length > 1200) return null;
    if (hasUnsafeOrIrrelevantText(value, policy)) return null;
    if (!paragraphHasGrounding(paragraph, policy)) return null;
    const semanticKey = normalize(value).replace(/[^a-z0-9]+/g, ' ');
    if (semanticKeys.has(semanticKey)) return null;
    semanticKeys.add(semanticKey);
    if (CTA_PATTERN.test(value)) ctaCount += 1;
    paragraphs.push(value);
  }
  if (ctaCount > 1 || (!policy.ctaAllowed && ctaCount && !policy.shortConfirmation)) return null;
  if (!hasRequiredReplyCoverage(paragraphs, policy, structured)) return null;
  return paragraphs;
}

function enforceGroundedMailboxReply(generatedValue, options = {}) {
  const policy = analyzeMailboxReplyContext(options.inboundText, {
    conceptText: options.conceptText,
    originalText: options.originalSentMail?.body || options.originalSentMail?.preview,
    conversation: options.conversation,
  });
  const structured = parseStructuredDraft(generatedValue);
  const paragraphs = structured && validateStructuredParagraphs(structured, policy);
  if (!paragraphs) {
    const error = new Error('Deze voorgestelde reactie is onvoldoende onderbouwd of beantwoordt niet alle vragen. Je concept is behouden; probeer opnieuw of vul de ontbrekende informatie aan.');
    error.status = 422;
    error.code = 'MAILBOX_REPLY_NEEDS_REVIEW';
    throw error;
  }
  return { policy, paragraphs, short: policy.shortConfirmation && structured.replyForm === 'short' && paragraphs.join(' ').length <= 180 };

}

module.exports = {
  REPLY_POLICY_VERSION,
  analyzeMailboxReplyContext,
  authoredReplyText,
  enforceGroundedMailboxReply,
  legacyIntent,
  parseStructuredDraft,
};

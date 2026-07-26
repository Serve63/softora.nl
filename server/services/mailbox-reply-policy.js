const REPLY_QUOTE_HEADER_PATTERN = /^(?:op\s.+\sheeft\s.+\shet\svolgende\sgeschreven:|op\s.+\sschreef\s.+:|on\s.+\swrote:|van:|from:)/i;
const CTA_PATTERN = /\b(?:afspraak|langskom|langs\s+te\s+komen|volgende\s+week|\[dag\]|even\s+bellen|kennismak|verder\s+praten|samen\s+bespreken)\b/i;
const GENERIC_FILLER_PATTERN = /\b(?:leuke\s+vraag|wat\s+leuk|ik\s+denk\s+graag\s+mee|mooie\s+kansen|interessante\s+mogelijkheden|hopelijk\s+kunnen\s+we|lijkt\s+me\s+goed|kijken\s+wat\s+er\s+mogelijk\s+is)\b/i;
const FUTURE_DOOR_OPEN_PATTERN = /\bmocht\s+je\s+in\s+de\s+toekomst\s+(?:toch\s+)?eens\s+willen\s+kijken\s+wat\s+er\s+mogelijk\s+is\s+voor\s+(?:je|jullie)\s+website,\s+dan\s+mag\s+je\s+me\s+altijd\s+een\s+berichtje\s+sturen\b/i;
const REPLY_POLICY_VERSION = 'softora-grounded-reply-v5';
const STOP_WORDS = new Set([
  'aan', 'als', 'ben', 'bij', 'dan', 'dat', 'de', 'deze', 'die', 'dit', 'een', 'en', 'er', 'geen',
  'heb', 'het', 'hier', 'hoe', 'ik', 'in', 'is', 'je', 'kan', 'maar', 'met', 'mijn', 'niet', 'nog',
  'om', 'ons', 'ook', 'op', 'te', 'van', 'voor', 'wat', 'we', 'wel', 'wij', 'wil', 'zijn', 'zou',
]);
const FEEDBACK_THEMES = Object.freeze([
  Object.freeze({
    key: 'generic_identity',
    detect: /\b(?:te\s+(?:vlak|algemeen|generiek)|algemene\s+(?:identiteit|uitstraling)|mist?\s+(?:een\s+)?identiteit|identiteit\s+(?:mist|ontbreekt)|voor\s+iedere\s+\w+\s+gebruikt)\b/i,
    phrase: 'de te algemene identiteit',
    response: /\b(?:algemen|generiek|vlak)[a-z]*\s+(?:identiteit|uitstraling)|identiteit\b/i,
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
  const quoteIndex = lines.findIndex((line) => REPLY_QUOTE_HEADER_PATTERN.test(line.trim()));
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
    substantive: themes.length >= 2 || (themes.length >= 1 && bulletCount >= 2),
  });
}

function analyzeMailboxReplyContext(inboundText, options = {}) {
  const authoredText = authoredReplyText(inboundText);
  const conceptText = clean(options.conceptText);
  const originalText = clean(options.originalText);
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
  const feedbackDetails = extractFeedbackDetails(authoredText);
  const feedback = feedbackDetails.themes.length > 0 || matches(text,
    /\b(?:feedback|verbeter|tip|advies|opmerking|mis\s+ik|zou\s+ik|mag\s+meer|uitstraling|lettertype|kleurgebruik|persoonlijke\s+touch)\b/
  );
  const audienceForm = (
    /\bjullie\b/i.test(originalText) ||
    /\b(?:we|wij|ons|onze)\b/i.test(authoredText)
  ) ? 'jullie' : 'je';
  const anniversaryMatch = authoredText.match(/\b(\d{1,3})\s*[- ]?\s*jarig(?:e)?\s+jubileum\b/i);
  const replyHighlights = Object.freeze({
    lateTiming: /\b(?:net|helaas)\s+te\s+laat\b/i.test(authoredText),
    recentWebsiteRenewal: (
      /\b(?:site|website)\b[^.!?\n]{0,100}\b(?:net|recent|onlangs)\b[^.!?\n]{0,80}\bvernieuwd\b/i.test(authoredText) ||
      /\b(?:net|recent|onlangs)\b[^.!?\n]{0,80}\b(?:site|website)\b[^.!?\n]{0,80}\bvernieuwd\b/i.test(authoredText)
    ),
    anniversaryYears: anniversaryMatch ? Number(anniversaryMatch[1]) : null,
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
  if (
    evidence.includes('known.future-door-open') &&
    policy.futureDoorOpenAllowed &&
    FUTURE_DOOR_OPEN_PATTERN.test(text)
  ) {
    return true;
  }
  if (
    evidence.includes('received.feedback-details') &&
    policy.feedbackDetails.themes.some((theme) => theme.response.test(text))
  ) {
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
  const isAllowedFutureDoorOpen = policy.futureDoorOpenAllowed && FUTURE_DOOR_OPEN_PATTERN.test(text);
  if (!text || (GENERIC_FILLER_PATTERN.test(text) && !isAllowedFutureDoorOpen)) return true;
  if (/^(?:beste|hoi|hallo|geachte)\b/i.test(text)) return true;
  if (/\bmet\s+vriendelijke\s+groet\b/i.test(text)) return true;
  if ((/\bjullie\b/i.test(text) && policy.audienceForm !== 'jullie') || /\buw\b|\bu\b/i.test(text)) return true;
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

function joinDutchPhrases(values) {
  const items = values.filter(Boolean);
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return `${items[0]} en ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} en ${items.at(-1)}`;
}

function feedbackThemePhrase(theme, audienceForm) {
  if (theme.key === 'generic_identity') return 'de algemene uitstraling';
  if (theme.key === 'non_own_imagery') {
    return `de beelden die niet bij ${audienceForm} bedrijf passen`;
  }
  if (theme.key === 'missing_brand_style') {
    return `het ontbreken van ${audienceForm} huisstijl`;
  }
  return theme.phrase;
}

function deterministicDetailedFeedbackParagraphs(policy) {
  const positives = policy.feedbackDetails.positiveThemes.slice(0, 2);
  const themes = policy.feedbackDetails.themes.slice(0, 3);
  const opening = [
    'Bedankt dat je er zo uitgebreid naar hebt gekeken en je eerlijke feedback hebt gedeeld!',
    positives.length
      ? `Fijn om te horen dat ${joinDutchPhrases(positives.map((theme) => theme.phrase))} wel goed ${
          positives.length === 1 ? 'overkwam' : 'overkwamen'
        }.`
      : '',
  ].filter(Boolean).join(' ');
  const details = `Je punten over ${joinDutchPhrases(
    themes.map((theme) => feedbackThemePhrase(theme, policy.audienceForm))
  )} zijn duidelijk. Daar kan ik zeker iets mee.`;
  const futureDoorOpen = policy.futureDoorOpenAllowed
    ? `Mocht je in de toekomst toch eens willen kijken wat er mogelijk is voor ${policy.audienceForm} website, dan mag je me altijd een berichtje sturen.`
    : '';
  return ensureOneSmile([opening, details, futureDoorOpen]);
}

function deterministicSatisfiedParagraphs(policy) {
  const plural = policy.audienceForm === 'jullie';
  const highlights = policy.replyHighlights || {};
  const opening = highlights.lateTiming
    ? 'Dan ben ik inderdaad net te laat!'
    : 'Bedankt voor je duidelijke reactie.';
  const satisfaction = highlights.recentWebsiteRenewal
    ? `Fijn om te horen dat ${policy.audienceForm} website helemaal is vernieuwd en dat ${
        policy.audienceForm
      } zo tevreden ${plural ? 'zijn' : 'bent'} met de nieuwe uitstraling en huisstijl.`
    : `Fijn om te horen dat ${policy.audienceForm} tevreden ${plural ? 'zijn' : 'bent'} met ${
        policy.audienceForm
      } huidige website.`;
  const anniversary = highlights.anniversaryYears
    ? `Alvast veel succes met ${policy.audienceForm} ${highlights.anniversaryYears}-jarig jubileum!`
    : '';
  const futureDoorOpen = policy.futureDoorOpenAllowed
    ? `Mocht je in de toekomst toch eens willen kijken wat er mogelijk is voor ${policy.audienceForm} website, dan mag je me altijd een berichtje sturen.`
    : '';
  return ensureOneSmile([`${opening} ${satisfaction}`, anniversary, futureDoorOpen]);
}

function deterministicParagraphs(policy) {
  if (policy.substantiveFeedback) {
    return deterministicDetailedFeedbackParagraphs(policy);
  }
  if (policy.satisfied) {
    return deterministicSatisfiedParagraphs(policy);
  }
  if (policy.rejection) {
    const futureDoorOpen = policy.futureDoorOpenAllowed
      ? `Mocht je in de toekomst toch eens willen kijken wat er mogelijk is voor ${policy.audienceForm} website, dan mag je me altijd een berichtje sturen.`
      : '';
    return ensureOneSmile(['Bedankt voor je duidelijke reactie.', futureDoorOpen]);
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

function hasRequiredReplyCoverage(paragraphs, policy) {
  const response = paragraphs.join(' ');
  if (policy.futureDoorOpenAllowed && !FUTURE_DOOR_OPEN_PATTERN.test(response)) return false;
  if (!policy.substantiveFeedback) return true;
  const requiredThemeCount = Math.min(2, policy.feedbackDetails.themes.length);
  const coveredThemes = policy.feedbackDetails.themes.filter(
    (theme) => theme.response.test(response)
  ).length;
  const positiveCovered = (
    !policy.feedbackDetails.positiveThemes.length ||
    policy.feedbackDetails.positiveThemes.some((theme) => theme.response.test(response))
  );
  return (
    /\bdank\w*\b/i.test(response) &&
    coveredThemes >= requiredThemeCount &&
    positiveCovered &&
    (
      !policy.futureDoorOpenAllowed ||
      FUTURE_DOOR_OPEN_PATTERN.test(response)
    )
  );
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
  if (!hasRequiredReplyCoverage(paragraphs, policy)) return null;
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

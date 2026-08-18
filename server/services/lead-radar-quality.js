'use strict';

const BUYER_INTENT_TERMS = Object.freeze([
  'wie kan een website maken', 'wie kan een website bouwen', 'wie bouwt websites',
  'wie kent een goede webdesigner', 'wie weet een goede webdesigner',
  'ik zoek een webdesigner', 'wij zoeken een webdesigner', 'we zoeken een webdesigner',
  'ik zoek een webdeveloper', 'wij zoeken een webdeveloper', 'we zoeken een webdeveloper',
  'iemand die een website kan maken', 'iemand die een website kan bouwen',
  'iemand nodig voor mijn website', 'hulp gevraagd voor mijn website',
  'website hulp gezocht', 'website hulp nodig', 'hulp met mijn website',
  'offerte voor een website', 'website offerte', 'websitebouwer gezocht', 'webdesigner gezocht',
  'nieuwe website nodig', 'nieuwe site nodig', 'nog geen website', 'geen website',
  'toe aan een website', 'website nodig voor', 'website nodig',
  'ik wil een website', 'wij willen een website', 'we willen een website',
  'website laten maken voor mijn', 'website laten bouwen voor mijn',
  'website laten maken', 'website laten bouwen', 'website laten doen',
  'website laten ontwerpen', 'website laten ontwikkelen',
  'website vernieuwen', 'website moderniseren', 'bestaande website vernieuwen',
  'website opnieuw laten bouwen', 'website redesign', 'oude website vervangen',
  'website werkt niet', 'website doet het niet', 'website aanpassen', 'website verbeteren',
  'mijn website vernieuwen', 'onze website vernieuwen', 'mijn website verbeteren',
  'onze website verbeteren', 'webshop hulp gezocht', 'webshop laten maken',
  'webshop laten bouwen', 'webshop vernieuwen', 'webshop verbeteren', 'webshop werkt niet',
  'webwinkel laten maken', 'webwinkel laten bouwen', 'online shop laten maken',
  'website voor mijn bedrijf', 'website voor mijn onderneming', 'website voor mijn praktijk',
  'website voor mijn winkel', 'website voor mijn zaak', 'website voor mijn dienst',
  'online aanwezigheid nodig',
]);

const CLIENT_CONTEXT_TERMS = Object.freeze([
  'mijn website', 'onze website', 'mijn webshop', 'onze webshop', 'mijn webwinkel',
  'onze webwinkel', 'voor mijn bedrijf', 'voor mijn onderneming', 'voor mijn dienst',
  'voor mijn praktijk', 'voor mijn winkel', 'voor mijn zaak', 'voor ons bedrijf',
  'voor onze onderneming', 'voor onze zaak', 'voor mijn klanten', 'ons bedrijf',
  'onze onderneming', 'mijn bedrijf', 'mijn onderneming',
]);

const BUYER_REQUEST_TERMS = Object.freeze([
  'wie kan een website', 'wie kent een goede webdesigner', 'wie weet een goede webdesigner',
  'kent iemand een goede webdesigner', 'iemand die een website kan', 'iemand nodig voor mijn website',
  'hulp gevraagd voor mijn website', 'website hulp gezocht', 'website hulp nodig', 'hulp met mijn website',
  'offerte voor een website', 'website offerte', 'websitebouwer gezocht', 'webdesigner gezocht',
  'webdeveloper gezocht', 'ik zoek een webdesigner', 'wij zoeken een webdesigner', 'we zoeken een webdesigner',
  'ik zoek een webdeveloper', 'wij zoeken een webdeveloper', 'we zoeken een webdeveloper',
  'nog geen website', 'toe aan een website', 'website nodig voor mijn', 'ik wil een website',
  'wij willen een website', 'we willen een website', 'aanbeveling', 'tip gevraagd', 'hulp gevraagd',
  'hulp gezocht',
]);

const RECRUITMENT_TERMS = Object.freeze([
  'vacature', 'we are hiring', 'we\'re hiring', 'hiring', 'team versterken',
  'ons team', 'voor ons mediateam', 'vrijwilliger', 'stagiair', 'stage',
  'fulltime', 'parttime', 'dienstverband', 'medewerker gezocht', 'collega gezocht',
  'junior webdeveloper', 'front-end webdeveloper', 'front end webdeveloper',
  'senior webdeveloper', 'werken bij', 'bij ons werken', 'profiel past',
]);

const PROVIDER_SALES_TERMS = Object.freeze([
  'wij bij', 'wij maken', 'wij bouwen', 'wij ontwerpen', 'wij ontwikkelen',
  'ik maak', 'ik bouw', 'kijk op', 'uw website bouwer', 'voor je bedrijf',
  'conversie gerichte website', 'resultaat gerichte aanpak', 'resultaatgerichte aanpak',
]);

const PROVIDER_ROLE_TERMS = Object.freeze([
  'webdesigner', 'websitedesigner', 'webdesign', 'webbureau', 'websitebouwer',
  'website bouwer', 'webdeveloper', 'web development', 'webdevelopment',
  'webshopbouwer', 'online marketing', 'marketingbureau', 'marketing bureau',
  'digital agency', 'marketing agency', 'seo bureau', 'seo specialist',
  'wordpress specialist', 'shopify partner', 'web tech bureau', 'websites en logo',
  'website onderhoud', 'website voor ondernemers',
]);

const PROVIDER_PROMO_TERMS = Object.freeze([
  'wij bouwen websites', 'wij bouwen webshops', 'wij maken websites', 'wij maken webshops',
  'wij helpen', 'wij ontwerpen', 'wij ontwikkelen', 'website laten maken?',
  'vraag direct een offerte aan', 'offerte aanvragen', 'neem contact op',
  'stuur me gerust een bericht', 'stuur me gerust een dm', 'breng een nieuwe klant bij ons',
  'verdien â‚¬', 'vanaf â‚¬', 'vanaf eur', 'scherpe prijs', 'betaalbaar', 'tijdelijk voor',
  'seo optimalisatie', 'online marketing', 'meer bezoekers', 'maatwerk website',
  'maatwerk websites', 'volledig via programmering', 'geschikt voor mobiel',
  'gemakkelijk zelf wijzigingen', 'ben shopify partner', 'wij helpen je',
  'heb je ook een nieuwe website nodig', 'heb jij ook een nieuwe website nodig',
  'tag iemand die een nieuwe website nodig heeft', 'ken jij iemand die een nieuwe website nodig heeft',
  'bekijk onze website', 'bezoek onze website', 'bekijk de website', 'neem contact met ons op',
  'stuur ons een bericht', 'wacht niet te lang', 'website opgeleverd', 'nieuwe website opgeleverd',
  'website mogen maken', 'websites voor bedrijven', 'websites voor ondernemers', 'onze klanten',
  'onze diensten', 'vraag vrijblijvend', 'gratis je website', 'zacht prijsje', 'scherpe prijs',
]);
const PROVIDER_SHOWCASE_TERMS = Object.freeze([
  'ontwikkeld door', 'gemaakt door', 'in samenwerking met', 'heeft een nieuwe website laten',
  'nieuwe website via', 'website mogen maken', 'creëren websites', 'creeren websites',
  'website voor bedrijven', 'website voor ondernemers', 'website opgeleverd',
]);
const PRODUCT_SEARCH_TERMS = Object.freeze([
  'marketplace', 'identieke auto', 'zelfde auto', 'te koop', 'te vinden', 'onderdeel gezocht',
  'product gezocht', 'artikel gezocht', 'auto gezocht', 'fiets gezocht', 'woning gezocht',
]);
const SEARCH_EXCLUSION_TERMS = Object.freeze([
  '-vacature', '-stage', '-cursus', '-tutorial', '-template', '-portfolio', '-showcase',
  '-"website opgeleverd"', '-"nieuwe website opgeleverd"', '-"wij bouwen websites"',
  '-"wij maken websites"', '-"bekijk onze website"', '-"neem contact op"',
  '-"online marketing"', '-marketingbureau', '-webbureau', '-"seo optimalisatie"',
]);

const DUTCH_MONTHS = Object.freeze({
  jan: 0, januari: 0, feb: 1, februari: 1, mrt: 2, maart: 2, apr: 3, april: 3,
  mei: 4, jun: 5, juni: 5, jul: 6, juli: 6, aug: 7, augustus: 7,
  sep: 8, sept: 8, september: 8, okt: 9, oktober: 9, nov: 10, november: 10,
  dec: 11, december: 11,
});

function createLeadRadarQuality(deps) {
  const { text, normalizeHttpUrl, normalizePlatform, normalizeDate, normalizeInteger, platformFromUrl } = deps;

  function countPhraseHits(value, phrases) {
    const normalized = String(value || '').toLowerCase();
    return phrases.reduce((count, phrase) => count + (normalized.includes(String(phrase).toLowerCase()) ? 1 : 0), 0);
  }

  function isLikelyPlatformProfileUrl(value) {
    const normalized = normalizeHttpUrl(value);
    if (!normalized || !platformFromUrl(normalized)) return false;
    try {
      const segments = new URL(normalized).pathname.split('/').filter(Boolean);
      if (platformFromUrl(normalized) === 'linkedin') {
        return /^(in|company)\//i.test(segments.join('/'));
      }
      return segments.length <= 1;
    } catch {
      return false;
    }
  }

  function isLikelyDirectPlatformPostUrl(value, platform = '') {
    const normalized = normalizeHttpUrl(value);
    const normalizedPlatform = normalizePlatform(platform) || platformFromUrl(normalized);
    if (!normalized || !normalizedPlatform) return false;
    try {
      const parsed = new URL(normalized);
      const path = parsed.pathname.toLowerCase();
      if (normalizedPlatform === 'linkedin') return /^\/posts\//.test(path) || /^\/feed\/update\//.test(path);
      return /\/(?:posts?|videos?|reels?|share\/p|share\/r)\/[^/]+/.test(path) ||
        (/\/(?:permalink|photo)\.php$/.test(path) && (parsed.searchParams.has('story_fbid') || parsed.searchParams.has('fbid'))) ||
        parsed.searchParams.has('story_fbid');
    } catch {
      return false;
    }
  }

  function normalizeProviderPublishedAt(item = {}) {
    // DataForSEO's result-level datetime is retrieval time, not publication time.
    // Relative SERP labels such as "3 days ago" are resolved against that
    // retrieval time so the inbox can still show a useful publication date.
    const base = normalizeDate(item.retrieved_at) || new Date().toISOString();
    for (const candidate of [item.timestamp, item.published_at, item.publishedAt, item.date]) {
      const normalized = normalizeProviderDate(candidate, base);
      if (normalized) return normalized;
    }
    return null;
  }

  function normalizeProviderDate(value, baseValue) {
    const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!raw) return null;
    const base = new Date(baseValue);
    if (Number.isNaN(base.getTime())) return null;
    if (/^(vandaag|today)$/.test(raw)) return base.toISOString();
    if (/^(gisteren|yesterday)$/.test(raw)) return new Date(base.getTime() - 86_400_000).toISOString();
    const relative = raw.match(/^(\d+)\s*(uur|u|hour|hours|dag|dagen|day|days|week|weken|weeks)\s*(geleden|ago)$/);
    if (relative) {
      const amount = Number(relative[1]);
      const unit = relative[2];
      const multiplier = /uur|u|hour/.test(unit) ? 3_600_000 : /week/.test(unit) || /weken/.test(unit) ? 7 * 86_400_000 : 86_400_000;
      return new Date(base.getTime() - amount * multiplier).toISOString();
    }
    const dutch = raw.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
    if (dutch && Object.prototype.hasOwnProperty.call(DUTCH_MONTHS, dutch[2])) {
      const date = new Date(Date.UTC(Number(dutch[3]), DUTCH_MONTHS[dutch[2]], Number(dutch[1])));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const numeric = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (numeric) {
      const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
      const date = new Date(Date.UTC(year, Number(numeric[2]) - 1, Number(numeric[1])));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return normalizeDate(value);
  }

  function isRecentPublication(value, maxAgeDays = 30) {
    const publishedAt = normalizeDate(value);
    const days = normalizeInteger(maxAgeDays, { min: 1, max: 3650 });
    if (!publishedAt || !days) return false;
    const ageMs = Date.now() - new Date(publishedAt).getTime();
    return ageMs >= -2 * 3_600_000 && ageMs <= days * 86_400_000;
  }

  function classifySignal(input = {}) {
    const author = text(input.author_name || input.authorName || input.title, 500).toLowerCase();
    const message = `${input.message_text || input.messageText || input.snippet || ''}`.toLowerCase();
    const sourceUrl = input.post_url || input.source_url || input.sourceUrl || input.url || '';
    const buyerIntentHits = countPhraseHits(message, BUYER_INTENT_TERMS);
    const providerRoleHits = countPhraseHits(author, PROVIDER_ROLE_TERMS);
    const providerMessageRoleHits = countPhraseHits(message, PROVIDER_ROLE_TERMS);
    const providerPromoHits = countPhraseHits(message, PROVIDER_PROMO_TERMS);
    const providerShowcaseHits = countPhraseHits(message, PROVIDER_SHOWCASE_TERMS);
    const recruitmentHits = countPhraseHits(message, RECRUITMENT_TERMS);
    const productSearch = countPhraseHits(message, PRODUCT_SEARCH_TERMS) > 0;
    const profileOnly = isLikelyPlatformProfileUrl(sourceUrl);
    const hasWebsiteContext = /\b(websites?|websitebouwers?|webshops?|webwinkels?|webdesign|webdevelopers?|site)\b/i.test(message);
    const hasClientContext = countPhraseHits(message, CLIENT_CONTEXT_TERMS) > 0 ||
      /\b(ik|wij|we)\s+(?:ben|zijn)\s+op\s*zoek naar iemand\b/i.test(message) ||
      /\b(ik|wij|we)\s+(?:wil|willen|zoek|zoeken)\b[^.]{0,120}\b(website|webshop|webdesigner|websitebouwer)\b/i.test(message);
    const hasConcreteWebsiteNeed = buyerIntentHits > 0;
    const buyerRequestHits = countPhraseHits(message, BUYER_REQUEST_TERMS);
    const firstPersonWebsiteNeed = /\b(?:ik|wij|we|mijn|onze|ons)\b[^.]{0,160}\b(?:website|webshop|webwinkel|webdesigner|websitebouwer|webdeveloper)\b/i.test(message);
    const hasBuyerVoice = hasClientContext || buyerRequestHits > 0 || firstPersonWebsiteNeed;
    const designerHiringPhrase = /\b(webdesigner|webdeveloper)\s+gezocht\b/i.test(message);
    const isRecruitment = Boolean(hasWebsiteContext && !hasClientContext && (recruitmentHits > 0 || designerHiringPhrase));
    const strongPromotion = providerPromoHits >= 2 ||
      (providerPromoHits >= 1 && (providerRoleHits > 0 || providerMessageRoleHits > 0));
    const commercialCopy = countPhraseHits(message, PROVIDER_SALES_TERMS) > 0;
    const directSalesCta = /\b(wil jij|wil je|heeft u|wilt u)\b[^.]{0,120}\b(website|webshop)\b[^.]{0,120}\b(laten|maken|bouwen|ontwikkelen|helpen)\b/i.test(message);
    const providerConfidence = Math.min(100,
      providerRoleHits * 45 + providerMessageRoleHits * 20 + providerPromoHits * 25 +
      (commercialCopy ? 20 : 0) + (profileOnly ? 15 : 0)
    );
    const isProvider = Boolean(
      hasWebsiteContext && !hasClientContext && !isRecruitment &&
      ((strongPromotion && (providerRoleHits > 0 || providerMessageRoleHits > 0 || profileOnly || providerPromoHits >= 2)) ||
        (profileOnly && commercialCopy && (providerRoleHits > 0 || providerPromoHits > 0 || hasConcreteWebsiteNeed)) ||
        (providerRoleHits > 0 && commercialCopy) || providerShowcaseHits > 0 || directSalesCta)
    );
    const isWebsiteNeed = hasWebsiteContext && hasConcreteWebsiteNeed && hasBuyerVoice && !isRecruitment && !productSearch;
    const reasons = [];
    if (isRecruitment) reasons.push('Recruitment- of vacaturebericht, geen klantvraag');
    if (isProvider) reasons.push('Zelfpromotie van webdesign-, SEO- of marketingaanbieder');
    if (productSearch) reasons.push('Product- of marktplaatszoekopdracht, geen websitevraag');
    if (!hasWebsiteContext) reasons.push('Geen duidelijke websitecontext in het bericht');
    if (!hasConcreteWebsiteNeed) reasons.push('Geen concrete vraag om websitebouw of verbetering gevonden');
    if (!hasBuyerVoice) reasons.push('Geen herkenbare klantvraag vanuit ondernemer gevonden');
    return {
      role: isRecruitment ? 'excluded' : (isProvider ? 'provider' : (isWebsiteNeed ? 'prospect' : 'unclear')),
      isProvider,
      isExcluded: isRecruitment || productSearch,
      isWebsiteNeed,
      providerConfidence,
      buyerIntentHits,
      recruitmentHits,
      reasons,
    };
  }

  function isEligibleAutomaticSignal(signal, { maxAgeDays = 30 } = {}) {
    if (!isLikelyDirectPlatformPostUrl(signal.post_url || signal.source_url, signal.platform)) return false;
    if (!isRecentPublication(signal.published_at, maxAgeDays)) return false;
    const classification = classifySignal(signal);
    return !classification.isProvider && !classification.isExcluded && classification.isWebsiteNeed;
  }

  return {
    classifySignal,
    isEligibleAutomaticSignal,
    isLikelyDirectPlatformPostUrl,
    isRecentPublication,
    normalizeProviderPublishedAt,
    searchExclusionTerms: SEARCH_EXCLUSION_TERMS,
  };
}

module.exports = { createLeadRadarQuality };


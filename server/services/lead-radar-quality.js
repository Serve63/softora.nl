'use strict';

const { classifyLeadSourceUrl } = require('./lead-radar-source-policy');

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
  'ik zoek iemand voor software', 'wij zoeken iemand voor software', 'software laten maken',
  'maatwerk software gezocht', 'softwareontwikkelaar gezocht', 'app laten maken',
  'app ontwikkelaar gezocht', 'crm laten maken', 'crm systeem nodig', 'portaal laten bouwen',
  'klantenportaal laten maken', 'koppeling laten maken', 'api koppeling gezocht',
  'iemand die kan automatiseren', 'automatisering hulp gezocht', 'processen automatiseren',
  'ai automatisering gezocht', 'chatbot laten maken', 'webapp laten maken',
  'dashboard laten maken', 'systeem laten bouwen', 'ai agent laten maken',
  'ai assistent laten bouwen',
]);

const CLIENT_CONTEXT_TERMS = Object.freeze([
  'mijn website', 'onze website', 'mijn webshop', 'onze webshop', 'mijn webwinkel',
  'onze webwinkel', 'voor mijn bedrijf', 'voor mijn onderneming', 'voor mijn dienst',
  'voor mijn praktijk', 'voor mijn winkel', 'voor mijn zaak', 'voor ons bedrijf',
  'voor onze onderneming', 'voor onze zaak', 'voor mijn klanten', 'ons bedrijf',
  'onze onderneming', 'mijn bedrijf', 'mijn onderneming', 'onze software', 'mijn software',
  'ons systeem', 'mijn systeem', 'ons proces', 'onze processen',
]);

const BUYER_REQUEST_TERMS = Object.freeze([
  'wie kan een website', 'wie kent een goede webdesigner', 'wie weet een goede webdesigner',
  'kent iemand een goede webdesigner', 'iemand die een website kan', 'iemand nodig voor mijn website',
  'hulp gevraagd voor mijn website', 'website hulp gezocht', 'website hulp nodig', 'hulp met mijn website',
  'offerte voor een website', 'website offerte', 'websitebouwer gezocht', 'webdesigner gezocht',
  'webdeveloper gezocht', 'ik zoek een webdesigner', 'wij zoeken een webdesigner', 'we zoeken een webdesigner',
  'ik zoek een webdeveloper', 'wij zoeken een webdeveloper', 'we zoeken een webdeveloper',
  'nog geen website', 'toe aan een website', 'website nodig voor mijn', 'ik wil een website',
  'wij willen een website', 'we willen een website', 'softwareontwikkelaar gezocht', 'app ontwikkelaar gezocht',
  'automatisering hulp gezocht', 'iemand die kan automatiseren', 'koppeling laten maken',
]);

const RECRUITMENT_TERMS = Object.freeze([
  'vacature', 'we are hiring', 'we\'re hiring', 'hiring', 'team versterken',
  'ons team', 'voor ons mediateam', 'vrijwilliger', 'stagiair', 'stage',
  'fulltime', 'parttime', 'dienstverband', 'medewerker gezocht', 'collega gezocht',
  'salespartner', 'sales partner', 'accountmanager', 'appointment setter', 'commercieel medewerker',
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
  'website onderhoud', 'website voor ondernemers', 'softwarebureau', 'software bedrijf',
  'app developer', 'app ontwikkelaar', 'automation agency', 'automatiseringsbureau',
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
      if (platformFromUrl(normalized) === 'bluesky') return /^profile\/[^/]+\/?$/i.test(segments.join('/'));
      if (platformFromUrl(normalized) === 'mastodon') return segments.length <= 1 || /^@[^/]+\/?$/i.test(segments.join('/'));
      if (platformFromUrl(normalized) === 'web') return false;
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
      const hostname = parsed.hostname.toLowerCase();
      const isFacebookHost = hostname === 'facebook.com' || hostname.endsWith('.facebook.com') ||
        hostname === 'fb.com' || hostname.endsWith('.fb.com');
      const isLinkedInHost = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
      if (normalizedPlatform === 'facebook' && !isFacebookHost) return false;
      if (normalizedPlatform === 'linkedin' && !isLinkedInHost) return false;
      const path = parsed.pathname.toLowerCase();
      if (normalizedPlatform === 'linkedin') return /^\/posts\//.test(path) || /^\/feed\/update\//.test(path);
      if (normalizedPlatform === 'bluesky') return parsed.hostname.toLowerCase() === 'bsky.app' && /^\/profile\/[^/]+\/post\/[^/]+/.test(path);
      if (normalizedPlatform === 'mastodon') return /^\/@[^/]+\/\d+/.test(path) || /^\/users\/[^/]+\/statuses\/\d+/.test(path);
      if (normalizedPlatform === 'web') return true;
      return /\/(?:posts?|videos?|reels?|share\/p|share\/r)\/[^/]+/.test(path) ||
        (/\/(?:permalink|photo)\.php$/.test(path) && (parsed.searchParams.has('story_fbid') || parsed.searchParams.has('fbid'))) ||
        parsed.searchParams.has('story_fbid');
    } catch {
      return false;
    }
  }

  function extractDateText(value) {
    const raw = String(value || '');
    const relative = raw.match(/\b(?:vandaag|gisteren|\d+\s*(?:uur|u|h|hour|hours|dag|dagen|d|day|days|week|weken|w|weeks)\s*(?:geleden|ago)?)\b/i);
    if (relative) return relative[0];
    const named = raw.match(/\b\d{1,2}\s+(?:jan(?:uari)?|feb(?:ruari)?|mrt|maart|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|aug(?:ustus)?|sep(?:t(?:ember)?)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?\b/i);
    if (named) return named[0];
    const numeric = raw.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/);
    return numeric ? numeric[0] : '';
  }

  function getProviderPublicationDetails(item = {}) {
    if (item.source_type === 'serp' && item.source_feed_url) {
      return { publishedAt: null, source: 'unknown', raw: null, confidence: 0 };
    }
    const base = normalizeDate(item.retrieved_at) || new Date().toISOString();
    const candidates = [
      ['provider_timestamp', item.timestamp, 100],
      ['provider_date', item.published_at || item.publishedAt, 95],
      ['serp_date', item.date || item.date_text || item.dateText, 90],
      ['serp_text', extractDateText(item.snippet || item.description), 60],
    ];
    for (const [source, value, confidence] of candidates) {
      const raw = String(value || '').trim();
      if (!raw) continue;
      const publishedAt = normalizeProviderDate(raw, base);
      if (publishedAt) return { publishedAt, source, raw: raw.slice(0, 250), confidence };
    }
    return { publishedAt: null, source: 'unknown', raw: null, confidence: 0 };
  }

  function normalizeProviderPublishedAt(item = {}) {
    return getProviderPublicationDetails(item).publishedAt;
  }

  function normalizeProviderDate(value, baseValue) {
    const raw = String(value || '').trim().toLowerCase().replace(/[·|•]+/g, ' ').replace(/\s+/g, ' ').replace(/[.,;]+$/, '');
    if (!raw) return null;
    const base = new Date(baseValue);
    if (Number.isNaN(base.getTime())) return null;
    if (/^(vandaag|today)$/.test(raw)) return base.toISOString();
    if (/^(gisteren|yesterday)$/.test(raw)) return new Date(base.getTime() - 86_400_000).toISOString();
    const relative = raw.match(/^(\d+)\s*(uur|u|h|hour|hours|dag|dagen|d|day|days|week|weken|w|weeks)\s*(geleden|ago)?$/);
    if (relative) {
      const amount = Number(relative[1]);
      const unit = relative[2];
      const multiplier = /uur|u|h|hour/.test(unit) ? 3_600_000 : /week|weken|w/.test(unit) ? 7 * 86_400_000 : 86_400_000;
      return new Date(base.getTime() - amount * multiplier).toISOString();
    }
    const dutch = raw.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
    if (dutch && Object.prototype.hasOwnProperty.call(DUTCH_MONTHS, dutch[2])) {
      let year = Number(dutch[3] || base.getUTCFullYear());
      let date = new Date(Date.UTC(year, DUTCH_MONTHS[dutch[2]], Number(dutch[1])));
      // Facebook/Google often omits the year. If that date would be in the
      // future, it belongs to the previous year.
      if (!dutch[3] && date.getTime() > base.getTime() + 2 * 86_400_000) {
        year -= 1;
        date = new Date(Date.UTC(year, DUTCH_MONTHS[dutch[2]], Number(dutch[1])));
      }
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

  function getPublicPagePublicationDetails(html, retrievedAt) {
    const source = String(html || '').slice(0, 1_500_000);
    const base = normalizeDate(retrievedAt) || new Date().toISOString();
    const readAttribute = (tag, name) => {
      const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
      return match ? match[1] : '';
    };
    const metaTags = source.match(/<meta\b[^>]*>/gi) || [];
    const metaCandidates = [
      ['article:published_time', 'post_meta', 100],
      ['og:published_time', 'post_meta', 98],
      ['datePublished', 'post_jsonld', 95],
    ];
    for (const [name, publicationSource, confidence] of metaCandidates) {
      const tag = metaTags.find((candidate) => {
        const key = (readAttribute(candidate, 'property') || readAttribute(candidate, 'name')).toLowerCase();
        return key === name.toLowerCase();
      });
      const value = tag ? readAttribute(tag, 'content') : '';
      const publishedAt = normalizeProviderDate(value, base);
      if (publishedAt) return { publishedAt, source: publicationSource, raw: value.slice(0, 250), confidence };
    }
    const jsonLd = source.match(/\"datePublished\"\s*:\s*\"([^\"]+)\"/i);
    if (jsonLd) {
      const publishedAt = normalizeProviderDate(jsonLd[1], base);
      if (publishedAt) return { publishedAt, source: 'post_jsonld', raw: jsonLd[1].slice(0, 250), confidence: 95 };
    }
    const timeTag = source.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/i);
    if (timeTag) {
      const publishedAt = normalizeProviderDate(timeTag[1], base);
      if (publishedAt) return { publishedAt, source: 'post_time', raw: timeTag[1].slice(0, 250), confidence: 90 };
    }
    const unixTime = source.match(/data-utime\s*=\s*["'](\d{9,12})["']/i);
    if (unixTime) {
      const value = new Date(Number(unixTime[1]) * 1_000).toISOString();
      return { publishedAt: value, source: 'post_time', raw: unixTime[1], confidence: 90 };
    }
    return { publishedAt: null, source: 'unknown', raw: null, confidence: 0 };
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
    const message = `${input.title || ''} ${input.message_text || input.messageText || input.snippet || ''}`.toLowerCase();
    const sourceUrl = input.post_url || input.source_url || input.sourceUrl || input.url || '';
    const buyerIntentHits = countPhraseHits(message, BUYER_INTENT_TERMS);
    const providerRoleHits = countPhraseHits(author, PROVIDER_ROLE_TERMS);
    const providerMessageRoleHits = countPhraseHits(message, PROVIDER_ROLE_TERMS);
    const providerPromoHits = countPhraseHits(message, PROVIDER_PROMO_TERMS);
    const providerShowcaseHits = countPhraseHits(message, PROVIDER_SHOWCASE_TERMS);
    const recruitmentHits = countPhraseHits(message, RECRUITMENT_TERMS);
    const productSearch = countPhraseHits(message, PRODUCT_SEARCH_TERMS) > 0;
    const profileOnly = isLikelyPlatformProfileUrl(sourceUrl);
    const sourcePolicy = sourceUrl ? classifyLeadSourceUrl(sourceUrl) : { allowed: true, category: 'unknown', reason: '' };
    const blockedSource = !sourcePolicy.allowed;
    const requestClosed = /\b(?:inmiddels|ondertussen|intussen|al)\s+(?:(?:een|de|goede|geschikte|passende)\s+)*(?:iemand|partij|partner|webdesigner|ontwikkelaar)\s+gevonden\b/i.test(message) ||
      /\b(?:opdracht|aanvraag|oproep)\s+(?:is\s+)?(?:gesloten|ingevuld|vergeven)\b/i.test(message);
    const publicSupportTopic = (() => {
      try {
        const parsed = new URL(sourceUrl);
        return parsed.hostname.toLowerCase() === 'nl.wordpress.org' &&
          /^\/support\/topic\/[^/]+\/?$/i.test(parsed.pathname);
      } catch {
        return false;
      }
    })();
    const professionalRequest = /\b(?:ik\s+(?:zoek|ben\s+op\s*zoek\s+naar)|(?:wij|we)\s+(?:zoeken|zijn\s+op\s*zoek\s+naar))\s+(?:een\s+)?(?:(?:goede?|betaalbare?|ervaren|betrouwbare|creatieve|zelfstandige|freelance|nederlandse|lokale|en)\s+){0,6}(?:(?:wordpress|shopify|webflow)[ -])?(?:webdesigner|webdeveloper|websitebouwer|webshopbouwer|softwareontwikkelaar|(?:app|software)[ -](?:ontwikkelaar|developer))\b/i.test(message);
    const hasWebsiteContext = /\b(?:\w*website\w*|webshops?|webwinkels?|webdesign(?:ers?)?|webdevelopers?|developers?|programmeurs?|programma|webapps?|dashboard|site|software|softwareontwikkelaars?|apps?|applicatie|systeem|crm|erp|portaal|klantenportaal|automatisering|automatiseren|automation|koppeling|api|database|tool|chatbot|ai[- ]?(?:agent|assistant|assistent|operator|workflow|oplossing|automatisering))\b/i.test(message);
    const directCustomerHelpRequest = /\bkan\s+iemand\s+(?:mij|me|ons)\b[^.!?]{0,220}\b(?:maken|bouwen|ontwikkelen|ontwerpen|implementeren|inrichten|opzetten|migreren|overzetten|integreren|automatiseren|moderniseren|vernieuwen|optimaliseren)\b/i.test(message) ||
      /\b(?:ik\s+ben|wij\s+zijn|we\s+zijn)\s+op\s*zoek\s+naar\s+(?:iemand|een\s+(?:partij|bureau|freelancer|ontwikkelaar|developer|programmeur|specialist|expert))\b/i.test(message) ||
      /\b(?:i(?:'|’)?m|we(?:'|’)?re|we are)\s+looking\s+for\b[^.!?]{0,220}\b(?:someone|developer|expert|specialist|agency|partner)\b/i.test(message);
    const explicitCommissionAction = /\b(?:wil|willen|zoek|zoeken|nodig|gezocht|gevraagd|offerte|opdracht|laten|help(?:en)?|looking for|need|want)\b[^.!?]{0,240}\b(?:maken|bouwen|ontwikkelen|ontwerpen|implementeren|inrichten|opzetten|migreren|overzetten|integreren|koppelen|automatiseren|moderniseren|vernieuwen|redesignen|optimaliseren|build|develop|create|implement|set up|migrate|integrate|connect|automate|redesign|optimi[sz]e)\b/i.test(message) ||
      /\b(?:maken(?!\s+gebruik\b)|bouwen|ontwikkelen|ontwerpen|implementeren|inrichten|opzetten|migreren|overzetten|integreren|koppelen|automatiseren|moderniseren|vernieuwen|redesignen|optimaliseren|build|develop|create|implement|migrate|integrate|automate|redesign|optimi[sz]e)\b[^.!?]{0,200}\b(?:website|webshop|software|programma|app|applicatie|crm|erp|portaal|dashboard|database|api|automation|ai[- ]?(?:agent|assistant|operator|workflow))\b/i.test(message);
    const hasClientContext = countPhraseHits(message, CLIENT_CONTEXT_TERMS) > 0 ||
      /\b(ik|wij|we)\s+(?:ben|zijn)\s+op\s*zoek naar iemand\b/i.test(message) ||
      /\b(ik|wij|we)\s+(?:wil|willen|zoek|zoeken)\b[^.]{0,160}\b(website|webshop|webdesigner|websitebouwer|software|ontwikkelaar|app|crm|portaal|automatisering|koppeling|chatbot)\b/i.test(message);
    const buyerRequestHits = countPhraseHits(message, BUYER_REQUEST_TERMS);
    const hasConcreteDigitalNeed = !publicSupportTopic && (
      buyerRequestHits > 0 || professionalRequest || directCustomerHelpRequest || explicitCommissionAction
    );
    const firstPersonWebsiteNeed = /\b(?:ik|wij|we|mijn|onze|ons)\b[^.]{0,180}\b(?:\w*website\w*|webshop|webwinkel|webdesigner|webdeveloper|software|ontwikkelaar|app|applicatie|crm|portaal|automatisering|koppeling|chatbot)\b/i.test(message);
    const hasBuyerVoice = hasClientContext || buyerRequestHits > 0 || professionalRequest || firstPersonWebsiteNeed || directCustomerHelpRequest;
    const designerHiringPhrase = /\b(webdesigner|webdeveloper)\s+gezocht\b/i.test(message);
    const staffingRequest = /\b(?:\d{2,3}\s*uur(?:\s+per\s+week)?|voor\s+(?:een\s+)?(?:internationale\s+)?eindklant|team[^.!?]{0,100}versterken|dienstverband)\b/i.test(message);
    const nonBuildServiceRequest = /\b(?:google ads|social media|contentmarketing|leadgeneratie|cold calling|seo-specialist|cro-specialist|salespartner)\b/i.test(message) &&
      !/\b(?:maken|bouwen|ontwikkelen|ontwerpen|implementeren|inrichten|opzetten|migreren|overzetten|integreren|build|develop|create|implement|set up|migrate|integrate)\b[^.!?]{0,220}\b(?:website|webshop|software|programma|app|applicatie|crm|erp|portaal|dashboard|database|api|ai[- ]?(?:agent|assistant|operator|workflow))\b/i.test(message);
    const guidanceRequest = /\b(?:looking for|seeking)\s+(?:some\s+)?(?:guidance|advice|tips?)\b/i.test(message) ||
      /\b(?:zoek|zoeken|wil|willen|gevraagd)\b[^.!?]{0,100}\b(?:begeleiding|advies|tips?)\b/i.test(message);
    const peerAdviceRequest = /\b(?:hoe\s+kan\s+ik|hoe\s+doen\s+jullie|welke\s+(?:programma'?s|software|tools?)\b[^.!?]{0,100}\bgebruiken|graag\s+van\s+anderen\s+horen|ben\s+benieuwd\s+hoe\s+andere)\b/i.test(message);
    const selfBuildPlan = /\b(?:write|build|develop)\b[^.!?]{0,160}\b(?:the\s+code|it|the\s+app)\b[^.!?]{0,80}\bmyself\b/i.test(message) ||
      /\bzelf\b[^.!?]{0,120}\b(?:bouwen|ontwikkelen|programmeren|coderen|code\s+schrijven)\b/i.test(message);
    const selfBuildGuidanceOnly = guidanceRequest && selfBuildPlan;
    const adviceOnly = (guidanceRequest || peerAdviceRequest) && !directCustomerHelpRequest && buyerRequestHits === 0 && !explicitCommissionAction;
    const isRecruitment = Boolean(hasWebsiteContext && (
      recruitmentHits > 0 || staffingRequest || (designerHiringPhrase && !hasClientContext)
    ));
    const strongPromotion = providerPromoHits >= 2 ||
      (providerPromoHits >= 1 && (providerRoleHits > 0 || providerMessageRoleHits > 0));
    const commercialCopy = countPhraseHits(message, PROVIDER_SALES_TERMS) > 0;
    const directSalesCta = /\b(wil jij|wil je|heeft u|wilt u)\b[^.]{0,120}\b(website|webshop)\b[^.]{0,120}\b(laten|maken|bouwen|ontwikkelen|helpen)\b/i.test(message);
    const providerPitch = /\b(?:wij|we|our\s+(?:team|agency))\b[^.!?]{0,100}\b(?:bouwen|maken|ontwerpen|ontwikkelen|build|design|develop|create|deliver)\b[^.!?]{0,140}\b(?:\w*website\w*|webshop|webapp|software|app|automation)\b/i.test(message) &&
      !/\b(?:zoek|zoeken|looking\s+for|nodig|need|iemand|someone|laten|offerte)\b/i.test(message);
    const providerConfidence = Math.min(100,
      providerRoleHits * 45 + providerMessageRoleHits * 20 + providerPromoHits * 25 +
      (commercialCopy ? 20 : 0) + (profileOnly ? 15 : 0) + (providerPitch ? 45 : 0)
    );
    const isProvider = Boolean(
      hasWebsiteContext && !hasClientContext && !isRecruitment &&
      ((strongPromotion && (providerRoleHits > 0 || providerMessageRoleHits > 0 || profileOnly || providerPromoHits >= 2)) ||
        (profileOnly && commercialCopy && (providerRoleHits > 0 || providerPromoHits > 0 || hasConcreteDigitalNeed)) ||
        (providerRoleHits > 0 && commercialCopy) || providerShowcaseHits > 0 || directSalesCta || providerPitch)
    );
    const isWebsiteNeed = hasWebsiteContext && hasConcreteDigitalNeed && hasBuyerVoice && !blockedSource && !isRecruitment && !productSearch && !publicSupportTopic && !selfBuildGuidanceOnly && !adviceOnly;
    const reasons = [];
    if (requestClosed) reasons.push('De opdrachtgever meldt dat de aanvraag al is ingevuld.');
    if (blockedSource) reasons.push(sourcePolicy.reason);
    if (isRecruitment) reasons.push('Recruitment- of vacaturebericht, geen klantvraag');
    if (isProvider) reasons.push('Zelfpromotie van webdesign-, SEO- of marketingaanbieder');
    if (productSearch) reasons.push('Product- of marktplaatszoekopdracht, geen websitevraag');
    if (nonBuildServiceRequest) reasons.push('Marketing- of salesopdracht zonder concrete bouwvraag');
    if (publicSupportTopic) reasons.push('Openbare WordPress-supportvraag, geen concrete koopopdracht');
    if (selfBuildGuidanceOnly) reasons.push('Zelfbouwvraag om begeleiding of advies, geen uit te besteden bouwopdracht');
    if (adviceOnly) reasons.push('Advies- of ervaringsvraag zonder uit te besteden bouwopdracht');
    if (!hasWebsiteContext) reasons.push('Geen duidelijke website-, software- of automatiseringscontext in het bericht');
    if (!hasConcreteDigitalNeed) reasons.push('Geen concrete digitale hulpvraag gevonden');
    if (!hasBuyerVoice) reasons.push('Geen herkenbare klantvraag vanuit ondernemer gevonden');
    return {
      role: (requestClosed || blockedSource || isRecruitment || publicSupportTopic || nonBuildServiceRequest || selfBuildGuidanceOnly || adviceOnly) ? 'excluded' : (isProvider ? 'provider' : (isWebsiteNeed ? 'prospect' : 'unclear')),
      isProvider,
      isExcluded: requestClosed || blockedSource || isRecruitment || productSearch || publicSupportTopic || nonBuildServiceRequest || selfBuildGuidanceOnly || adviceOnly,
      isWebsiteNeed,
      providerConfidence,
      buyerIntentHits,
      recruitmentHits,
      reasons,
    };
  }

  function isEligibleAutomaticSignal(signal, { maxAgeDays = 30, allowUnknownPublicationDate = true } = {}) {
    if (!isLikelyDirectPlatformPostUrl(signal.post_url || signal.source_url, signal.platform)) return false;
    const hasPublicationDate = Boolean(normalizeDate(signal.published_at));
    if (!hasPublicationDate && !allowUnknownPublicationDate) return false;
    // A missing post date is acceptable only when the signal itself was found
    // recently. This prevents historic undated rows from resurfacing forever.
    const freshnessDate = signal.published_at || signal.found_at;
    if (freshnessDate && !isRecentPublication(freshnessDate, maxAgeDays)) return false;
    const classification = classifySignal(signal);
    return !classification.isProvider && !classification.isExcluded && classification.isWebsiteNeed;
  }

  return {
    classifySignal,
    isEligibleAutomaticSignal,
    isLikelyDirectPlatformPostUrl,
    isRecentPublication,
    getPublicPagePublicationDetails,
    getProviderPublicationDetails,
    normalizeProviderPublishedAt,
    searchExclusionTerms: SEARCH_EXCLUSION_TERMS,
  };
}

module.exports = { createLeadRadarQuality };

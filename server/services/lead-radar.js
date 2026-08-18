'use strict';

const crypto = require('crypto');
const { createLeadRadarQuality } = require('./lead-radar-quality'); const { createLeadRadarMaintenance } = require('./lead-radar-maintenance'); const { createQueryDiagnostics, summarizeScanDiagnostics } = require('./lead-radar-diagnostics');

const SIGNALS_TABLE = 'softora_social_lead_signals';
const SCAN_RUNS_TABLE = 'softora_social_lead_scan_runs';
const DATAFORSEO_ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
const WEBSITE_STATUSES = Object.freeze([
  'website_found',
  'no_website_found',
  'website_not_working',
  'website_unverified',
  'website_not_checked',
  'provider_unavailable',
]);
const LEAD_STATUSES = Object.freeze(['new', 'relevant', 'not_relevant', 'follow_up', 'archived']);
const PLATFORMS = Object.freeze(['facebook', 'linkedin']);
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_NOTE_LENGTH = 5_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SCAN_QUERY_LIMIT = 50;
// Een ronde blijft bewust begrensd op de huidige batchgrootte. Dat houdt kosten,
// looptijd en de hoeveelheid nieuwe ruis per handmatige scan beheersbaar.
const MAX_SCAN_QUERY_LIMIT = 50;
const DEFAULT_WEBSITE_LOOKUP_LIMIT = 10;
const MAX_WEBSITE_LOOKUP_LIMIT = 50;
const DEFAULT_SOURCE_CHECK_LIMIT = 10;
const DEFAULT_AUTO_SCAN_INTERVAL_MINUTES = 15;
const DEFAULT_AUTO_SCAN_INITIAL_LOOKBACK_DAYS = 30;
const DEFAULT_AUTO_SCAN_REFRESH_LOOKBACK_DAYS = 3;
const DEFAULT_LEAD_RADAR_SUPABASE_TIMEOUT_MS = 10_000;

const KEYWORD_GROUPS = Object.freeze({
  direct_website: [
    'websitebouwer gezocht', 'webdesigner gezocht', 'webdeveloper gezocht',
    'website laten maken', 'website laten bouwen', 'nieuwe website nodig', 'nieuwe site nodig',
    'website laten doen', 'website hulp gezocht', 'hulp met website',
    'iemand die een website kan maken', 'wie kan een website maken', 'wie bouwt websites',
    'bedrijfswebsite laten maken', 'website voor mijn bedrijf',
    'website voor mijn onderneming', 'website voor mijn praktijk', 'website voor mijn winkel',
    'website voor mijn zaak', 'website voor mijn vereniging',
    'webdesign gezocht', 'website offerte', 'website nodig',
    'aanbeveling websitebouwer', 'kent iemand een goede webdesigner', 'iemand voor mijn website',
    'iemand nodig voor website', 'ik zoek iemand voor mijn website', 'wij zoeken iemand voor onze website', 'wie kan een website maken voor mijn bedrijf', 'websitebouwer gezocht voor mijn bedrijf', 'webdesigner gezocht voor mijn bedrijf', 'website nodig voor mijn bedrijf', 'website opdracht ondernemer',
  ],
  renew_or_repair: [
    'website vernieuwen', 'website moderniseren', 'bestaande website vernieuwen',
    'oude website vervangen', 'nieuwe site voor bestaand bedrijf', 'website redesign',
    'website werkt niet', 'website doet het niet', 'website aanpassen', 'website verbeteren',
    'website onderhoud gezocht', 'website hulp nodig', 'website mobiel maken',
    'website sneller maken', 'website professioneel maken', 'website opnieuw laten bouwen',
  ],
  webshop: [
    'webshop laten maken', 'webshop laten bouwen', 'webwinkel laten maken', 'webwinkel laten bouwen',
    'online shop laten maken', 'webshop hulp gezocht', 'webshop vernieuwen', 'webshop werkt niet',
    'website voor webshop',
  ],
  new_business: [
    'bedrijf online zichtbaar maken',
    'onderneming online zetten', 'nog geen website', 'geen website',
    'wij hebben nog geen website', 'toe aan een website', 'eindelijk online gaan',
    'online aanwezigheid nodig',
  ],
  visibility: [
    'online zichtbaar worden', 'beter online vindbaar', 'Google vindbaar worden',
    'online gevonden worden', 'website en Google', 'online aanwezigheid verbeteren',
    'professioneel online zichtbaar', 'meer klanten via website', 'website voor meer klanten',
    'online groeien', 'bedrijf online promoten', 'online marketing hulp',
    'website en online marketing', 'lokale website laten maken', 'lokale ondernemer website',
    'website voor zzp', 'website voor mkb', 'website voor lokaal bedrijf',
  ],
  question: [
    'gezocht', 'wie weet', 'aanbeveling', 'tip gevraagd', 'hulp gevraagd', 'hulp gezocht',
    'opdracht', 'offerte', 'iemand nodig', 'dringend', 'binnenkort', 'lokaal', 'in de buurt',
    'omgeving', 'regio', 'Nederland',
  ],
  business_context: [
    'bedrijf', 'onderneming', 'ondernemer', 'zzp', 'praktijk', 'salon', 'winkel', 'webshop',
    'restaurant', 'horeca', 'aannemer', 'coach', 'therapeut', 'fotograaf', 'makelaar',
    'installateur', 'bouwbedrijf', 'sportschool', 'vereniging', 'stichting', 'lokaal bedrijf',
  ],
});
const DEFAULT_KEYWORD_GROUPS = Object.freeze(['direct_website', 'renew_or_repair', 'webshop', 'new_business']);

const PROVINCES = Object.freeze([
  'Groningen', 'Friesland', 'Drenthe', 'Overijssel', 'Flevoland', 'Gelderland',
  'Utrecht', 'Noord-Holland', 'Zuid-Holland', 'Zeeland', 'Noord-Brabant', 'Limburg',
]);
const IMPORTANT_CITIES = Object.freeze([
  'Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg',
  'Almere', 'Breda', 'Nijmegen', 'Apeldoorn', 'Haarlem', 'Arnhem', 'Enschede', 'Amersfoort',
  'Dordrecht', 'Leiden', 'Zwolle', 'Maastricht', 'Delft', 'Deventer', 'Alkmaar', 'Venlo',
]);

const NEGATIVE_TERMS = Object.freeze([
  'vacature', 'stage', 'opleiding', 'cursus', 'tutorial', 'template', 'inspiratie',
  'gratis website maken', 'website handleiding', 'software installeren', 'website baan',
  'webdesigner vacature', 'marketing vacature', 'portfolio', 'showcase', 'website opgeleverd',
  'nieuwe website opgeleverd', 'website laten maken voor klanten', 'website voor ondernemers',
  'website voor bedrijven', 'te koop', 'te vinden', 'identieke', 'marketplace',
]);
class LeadRadarValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LeadRadarValidationError';
    this.statusCode = 400;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}
function normalizePlatform(value) {
  const normalized = text(value, 30).toLowerCase();
  if (PLATFORMS.includes(normalized)) return normalized;
  return platformFromUrl(normalized);
}
function normalizeStatus(value) {
  const normalized = text(value, 30).toLowerCase();
  return LEAD_STATUSES.includes(normalized) ? normalized : '';
}
function normalizeWebsiteStatus(value) {
  const normalized = text(value, 40).toLowerCase();
  return WEBSITE_STATUSES.includes(normalized) ? normalized : '';
}
function normalizeInteger(value, { min = 0, max = 2_000_000 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function normalizeHttpUrl(value, { allowPlatform = true } = {}) {
  const raw = text(value, 2_000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return '';
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname)) return '';
    if (hostname === '::1' || hostname === '[::1]') return '';
    if (!allowPlatform && isPlatformHostname(hostname)) return '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}
function isPlatformHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'facebook.com' || value.endsWith('.facebook.com') ||
    value === 'fb.com' || value.endsWith('.fb.com') ||
    value === 'linkedin.com' || value.endsWith('.linkedin.com');
}
function platformFromUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return '';
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.com' || hostname.endsWith('.fb.com')) return 'facebook';
    if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) return 'linkedin';
    return '';
  } catch {
    return '';
  }
}

const leadRadarQuality = createLeadRadarQuality({ text, normalizeHttpUrl, normalizePlatform, normalizeDate, normalizeInteger, platformFromUrl });
const {
  classifySignal,
  isEligibleAutomaticSignal,
  isLikelyDirectPlatformPostUrl,
  isRecentPublication,
  normalizeProviderPublishedAt,
  searchExclusionTerms,
} = leadRadarQuality;

function assertSourceUrl(value, expectedPlatform = '') {
  const normalized = normalizeHttpUrl(value);
  const platform = platformFromUrl(normalized);
  if (!normalized || !platform || (expectedPlatform && platform !== expectedPlatform) || !isLikelyDirectPlatformPostUrl(normalized, platform)) {
    throw new LeadRadarValidationError('Gebruik de directe URL van een openbare Facebook- of LinkedIn-post, niet van een profielpagina.');
  }
  return normalized;
}

function extractUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return matches
    .map((candidate) => normalizeHttpUrl(candidate.replace(/[),.;!?]+$/, ''), { allowPlatform: false }))
    .filter(Boolean);
}

function normalizeTextForFingerprint(value) {
  return text(value, 10_000).toLowerCase().replace(/\s+/g, ' ');
}

function buildFingerprint(input = {}) {
  const platform = normalizePlatform(input.platform);
  const externalId = text(input.external_id || input.externalId, 300).toLowerCase();
  const sourceUrl = normalizeHttpUrl(input.post_url || input.source_url || input.sourceUrl || '');
  const author = normalizeTextForFingerprint(input.author_name || input.authorName);
  const publishedAt = normalizeDate(input.published_at || input.publishedAt) || '';
  const message = normalizeTextForFingerprint(input.message_text || input.messageText || input.snippet);
  const identity = externalId || sourceUrl || [author, publishedAt.slice(0, 10), message].join('|');
  return crypto.createHash('sha256').update(`${platform}|${identity}`).digest('hex');
}

function containsAny(value, phrases) {
  const normalized = String(value || '').toLowerCase();
  return phrases.some((phrase) => normalized.includes(String(phrase).toLowerCase()));
}

function scoreSignal(input = {}, { targetRegion = '' } = {}) {
  const message = `${input.message_text || input.messageText || ''} ${input.snippet || ''}`.toLowerCase();
  let score = 0;
  const reasons = [];
  const publishedAt = normalizeDate(input.published_at || input.publishedAt);

  if (publishedAt) {
    const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3_600_000);
    if (ageHours <= 24) { score += 35; reasons.push('Geplaatst binnen 24 uur'); }
    else if (ageHours <= 72) { score += 28; reasons.push('Geplaatst binnen 3 dagen'); }
    else if (ageHours <= 168) { score += 20; reasons.push('Geplaatst binnen 7 dagen'); }
    else if (ageHours <= 720) { score += 10; reasons.push('Geplaatst binnen 30 dagen'); }
  } else {
    reasons.push('Publicatiedatum onbekend');
  }

  const classification = classifySignal({ message_text: message });
  const directWebsiteIntent = classification.isWebsiteNeed && !classification.isProvider && !classification.isExcluded;
  if (directWebsiteIntent) {
    score += 30;
    reasons.push('Bevat directe websitevraag');
  } else if (containsAny(message, ['website', 'webshop', 'webdesign'])) {
    score += 16;
    reasons.push('Bevat websitecontext');
  }
  if (containsAny(message, KEYWORD_GROUPS.business_context)) {
    score += 15;
    reasons.push('Duidelijke zakelijke context');
  }
  if (containsAny(message, ['offerte', 'opdracht', 'prijs', 'kosten', 'iemand nodig', 'dringend'])) {
    score += 15;
    reasons.push('Concrete koop- of hulpintentie');
  }
  if (targetRegion && input.region && String(input.region).toLowerCase().includes(String(targetRegion).toLowerCase())) {
    score += 10;
    reasons.push('Regio komt overeen');
  }
  if (input.engagement_known) {
    score += 5;
    reasons.push('Engagementinformatie beschikbaar');
  } else {
    reasons.push('Engagement onbekend');
  }
  if (containsAny(message, NEGATIVE_TERMS)) {
    score -= 15;
    reasons.push('Mogelijk lage-prioriteitssignaal');
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: Array.from(new Set(reasons)),
  };
}

function getRegionList(value, mode = '') {
  if (Array.isArray(value) && value.length) return value.map((item) => text(item, 100)).filter(Boolean).slice(0, 100);
  const normalized = text(value, 100);
  if (normalized) return [normalized];
  if (String(mode).toLowerCase() === 'regional') return ['Nederland', ...PROVINCES, ...IMPORTANT_CITIES];
  return ['Nederland'];
}

function getSelectedGroups(value) {
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_KEYWORD_GROUPS];
  return value.map((item) => text(item, 50)).filter((item) => Object.prototype.hasOwnProperty.call(KEYWORD_GROUPS, item));
}

function getAutomaticScanConfig(env = process.env) {
  const enabled = false;
  const intervalMinutes = Math.max(
    15,
    Math.min(1_440, Math.round(Number(env.LEAD_RADAR_AUTO_SCAN_INTERVAL_MINUTES) || DEFAULT_AUTO_SCAN_INTERVAL_MINUTES))
  );
  const maxQueries = safeLimit(env.LEAD_RADAR_AUTO_SCAN_MAX_QUERIES, DEFAULT_SCAN_QUERY_LIMIT, MAX_SCAN_QUERY_LIMIT);
  const websiteLookupLimit = env.LEAD_RADAR_AUTO_SCAN_WEBSITE_LOOKUP_LIMIT === '0'
    ? 0
    : safeLimit(env.LEAD_RADAR_AUTO_SCAN_WEBSITE_LOOKUP_LIMIT, DEFAULT_WEBSITE_LOOKUP_LIMIT, MAX_WEBSITE_LOOKUP_LIMIT);
  const initialLookbackDays = safeLimit(
    env.LEAD_RADAR_AUTO_SCAN_INITIAL_MAX_AGE_DAYS,
    DEFAULT_AUTO_SCAN_INITIAL_LOOKBACK_DAYS,
    365
  );
  const refreshLookbackDays = safeLimit(
    env.LEAD_RADAR_AUTO_SCAN_REFRESH_MAX_AGE_DAYS || env.LEAD_RADAR_AUTO_SCAN_MAX_AGE_DAYS,
    DEFAULT_AUTO_SCAN_REFRESH_LOOKBACK_DAYS,
    365
  );
  return {
    enabled,
    intervalMinutes,
    maxQueries,
    websiteLookupLimit,
    initialLookbackDays,
    refreshLookbackDays,
    // Keep maxAgeDays in the response for older clients and configuration screens.
    maxAgeDays: refreshLookbackDays,
    platforms: [...PLATFORMS],
    regionMode: 'nationwide',
    keywordGroups: [...DEFAULT_KEYWORD_GROUPS],
  };
}

function hasCompletedInitialBackfill(run, config) {
  const queryCount = Array.isArray(run?.query_plan) ? run.query_plan.length : 0;
  return Boolean(
    run
      && Number(run.max_age_days) >= Number(config.initialLookbackDays)
      && ['completed', 'completed_with_errors'].includes(run.status)
      && Number(run.query_cursor || 0) >= queryCount
  );
}

function getFreshnessSuffix(maxAgeDays) {
  const days = normalizeInteger(maxAgeDays, { min: 1, max: 3650 });
  if (!days) return '';
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return ` after:${cutoff}`;
}

function buildSearchPlan(options = {}) {
  const platforms = Array.isArray(options.platforms) && options.platforms.length
    ? options.platforms.map(normalizePlatform).filter(Boolean)
    : [...PLATFORMS];
  const regions = getRegionList(options.regions || options.region, options.regionMode);
  const groups = getSelectedGroups(options.keywordGroups);
  const freshnessSuffix = getFreshnessSuffix(options.maxAgeDays || options.max_age_days);
  const plan = [];
  for (const region of regions) {
    for (const group of groups) {
      for (const term of KEYWORD_GROUPS[group]) {
        for (const platform of platforms) {
          const site = platform === 'facebook'
            ? 'site:facebook.com'
            : '(site:linkedin.com/posts OR site:linkedin.com/feed/update)';
          plan.push({
            platform,
            region,
            keywordGroup: group,
            term,
            query: `${site} "${term}" ${region} ${searchExclusionTerms.join(' ')}${freshnessSuffix}`.trim(),
          });
        }
      }
    }
  }
  return plan;
}

function safeLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function extractTaskItems(body) {
  const task = body?.tasks?.[0];
  const result = task?.result?.[0];
  if (!Array.isArray(result?.items)) return [];
  return result.items.map((item) => ({ ...item, retrieved_at: result.datetime || null }));
}

function createDataForSeoProvider({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const login = text(env.LEAD_RADAR_DATAFORSEO_LOGIN || env.DATAFORSEO_LOGIN, 500);
  const password = text(env.LEAD_RADAR_DATAFORSEO_PASSWORD || env.DATAFORSEO_PASSWORD, 500);
  const endpoint = DATAFORSEO_ENDPOINT;

  async function search({ query, maxResults = 10 } = {}) {
    if (!login || !password) {
      const error = new Error('Lead Radar SERP-provider is niet geconfigureerd.');
      error.code = 'LEAD_RADAR_PROVIDER_UNAVAILABLE';
      throw error;
    }
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is niet beschikbaar.');
    const auth = Buffer.from(`${login}:${password}`).toString('base64');
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        language_code: 'nl',
        location_name: 'Netherlands',
        keyword: text(query, 700),
        depth: safeLimit(maxResults, 10, 100),
        device: 'desktop',
      }]),
    });
    const body = await response.json().catch(() => null);
    const taskStatusCode = body?.tasks?.[0]?.status_code;
    if (!response.ok || body?.status_code !== 20000 || taskStatusCode !== 20000) {
      const message = text(body?.status_message || body?.tasks?.[0]?.status_message || `SERP-provider HTTP ${response.status}`, 500);
      const error = new Error(message || 'SERP-provider gaf een fout.');
      error.code = 'LEAD_RADAR_PROVIDER_ERROR';
      throw error;
    }
    return extractTaskItems(body)
      .filter((item) => item && (item.type === 'organic' || item.url))
      .slice(0, safeLimit(maxResults, 10, 100))
      .map((item) => ({
        url: text(item.url, 2_000),
        title: text(item.title, 500),
        snippet: text(item.description || item.snippet, 5_000),
        date: item.date || item.date_text || item.dateText || null,
        timestamp: item.timestamp || item.posted_at || item.postedAt || null,
        published_at: item.published_at || item.publishedAt || item.publication_date || item.publicationDate || null,
        retrieved_at: item.retrieved_at || null,
        rank: normalizeInteger(item.rank_absolute, { min: 1, max: 10_000 }),
      }));
  }

  return {
    name: 'dataforseo',
    configured: Boolean(login && password),
    endpoint,
    search,
    getStatus() {
      return {
        configured: Boolean(login && password),
        provider: 'dataforseo',
        endpoint: login && password ? endpoint : null,
        message: login && password ? 'SERP-provider is geconfigureerd.' : 'Configureer LEAD_RADAR_DATAFORSEO_LOGIN en LEAD_RADAR_DATAFORSEO_PASSWORD.',
      };
    },
  };
}

function buildWebsiteSearchQuery(signal) {
  const name = text(signal.author_name || signal.authorName || '', 180)
    .split('|')[0]
    .replace(/^#\s*/, '')
    .replace(/["']/g, ' ')
    .trim();
  const region = text(signal.region, 100).replace(/["']/g, ' ');
  if (!name || name.length < 3) return '';
  // Exclude social profiles and ask for the public company site itself.
  return `"${name}" ${region} website -site:facebook.com -site:linkedin.com`.trim();
}

function buildSignalFromProviderItem(item, context = {}) { const reject = (reason) => { if (typeof context.onReject === 'function') context.onReject(reason); return null; };
  const url = normalizeHttpUrl(item?.post_url || item?.postUrl || item?.url || '');
  const platform = platformFromUrl(url);
  if (!platform) return reject('unsupported_platform');
  const messageText = text(item?.snippet || item?.description || '', MAX_MESSAGE_LENGTH);
  const classification = classifySignal({
    url,
    source_url: url,
    post_url: url,
    title: item?.title,
    author_name: item?.title,
    message_text: messageText,
    snippet: messageText,
  });
  // SERP-resultaten van partijen die zelf websites/SEO verkopen zijn geen
  // acquisitielead. Ook resultaten zonder echte websitevraag zijn te vaak
  // algemene content die alleen toevallig het woord website bevat.
  if (classification.isProvider) return reject('provider_or_showcase'); if (classification.isExcluded) return reject('excluded_content'); if (!classification.isWebsiteNeed) return reject('not_buyer_request');
  const maxAgeDays = normalizeInteger(context.maxAgeDays, { min: 1, max: 3650 });
  // Store only direct posts with a provider-supplied publication timestamp.
  if (!isLikelyDirectPlatformPostUrl(url, platform)) return reject('not_direct_post');
  const publishedAt = normalizeProviderPublishedAt(item); if (!publishedAt) return reject('missing_publication_date'); if (!isRecentPublication(publishedAt, maxAgeDays || 30)) return reject('outside_date_window');
  const directWebsite = extractUrls(messageText)[0] || '';
  const region = text(context.region, 120);
  const authorName = text(item?.title || '', 500);
  const input = {
    platform,
    source_type: 'serp',
    provider: text(context.provider || 'dataforseo', 100),
    source_url: url,
    post_url: url,
    profile_url: normalizeHttpUrl(item?.profile_url || item?.profileUrl || item?.author_url || item?.authorUrl || ''),
    message_text: messageText,
    snippet: messageText,
    author_name: authorName,
    region,
    query: text(context.query, 2_000),
    keyword_group: text(context.keywordGroup, 100),
    published_at: publishedAt,
    found_at: new Date().toISOString(),
    engagement_known: false,
    likes: null,
    comments: null,
    website_url: directWebsite || null,
    website_domain: directWebsite ? new URL(directWebsite).hostname : null,
    // A URL found in a snippet is a candidate until the server-side check succeeds.
    website_status: 'website_not_checked',
    website_source: directWebsite ? 'post' : 'not_checked',
    website_confidence_score: directWebsite ? 100 : null,
  };
  const scored = scoreSignal(input, { targetRegion: context.targetRegion || '' });
  input.relevance_score = scored.score;
  input.score_reasons = scored.reasons;
  input.fingerprint = buildFingerprint(input);
  return input;
}

function mergeSignal(existing, incoming) {
  const merged = { ...(existing || {}), ...(incoming || {}) };
  for (const field of ['website_url', 'website_domain', 'website_title', 'website_http_status', 'website_checked_at', 'website_check_error']) {
    if (!incoming?.[field] && existing?.[field]) merged[field] = existing[field];
  }
  if (incoming?.website_status === 'website_not_checked' && existing?.website_status && existing.website_status !== 'website_not_checked') {
    merged.website_status = existing.website_status;
    merged.website_source = existing.website_source;
    merged.website_confidence_score = existing.website_confidence_score;
  }
  if (existing?.lead_status && existing.lead_status !== 'new' && (!incoming?.lead_status || incoming.lead_status === 'new')) {
    merged.lead_status = existing.lead_status;
  }
  if (existing?.internal_notes && !incoming?.internal_notes) merged.internal_notes = existing.internal_notes;
  merged.last_seen = new Date().toISOString();
  merged.updated_at = new Date().toISOString();
  return merged;
}

function createLeadRadarService(deps = {}) {
  const {
    env = process.env,
    logger = console,
    getSupabaseClient = () => null,
    isSupabaseConfigured = () => false,
    fetchImpl = globalThis.fetch,
  } = deps;
  const provider = deps.provider || createDataForSeoProvider({ env, fetchImpl, logger }); const maintenance = createLeadRadarMaintenance({ getDb, env, logger });

  function getDb() {
    if (typeof isSupabaseConfigured === 'function' && !isSupabaseConfigured()) return null;
    if (typeof getSupabaseClient !== 'function') return null;
    const timeoutMs = Math.max(
      5_000,
      Math.min(60_000, Number(env.LEAD_RADAR_SUPABASE_TIMEOUT_MS) || DEFAULT_LEAD_RADAR_SUPABASE_TIMEOUT_MS)
    );
    // Lead Radar mag niet op de algemene 1,5s-client en globale REST-cooldown
    // leunen. Een telling of inbox-query kan iets langer duren zonder dat een
    // tijdelijke storing andere onderdelen van Softora blokkeert.
    return getSupabaseClient({
      timeoutMs,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
  }

  function requireDb() {
    const db = getDb();
    if (!db) {
      const error = new Error('Lead Radar-opslag is tijdelijk niet beschikbaar. Configureer Supabase server-side.');
      error.code = 'LEAD_RADAR_STORAGE_UNAVAILABLE';
      throw error;
    }
    return db;
  }

  async function findByFingerprint(db, fingerprint) {
    const result = await db.from(SIGNALS_TABLE).select('*').eq('fingerprint', fingerprint).limit(1);
    if (result.error) throw result.error;
    return result.data?.[0] || null;
  }

  async function upsertSignal(payload) {
    const db = requireDb();
    const fingerprint = payload.fingerprint || buildFingerprint(payload);
    const existing = await findByFingerprint(db, fingerprint);
    const now = new Date().toISOString();
    const row = mergeSignal(existing, {
      ...payload,
      id: existing?.id,
      fingerprint,
      created_at: existing?.created_at || now,
      updated_at: now,
      last_seen: now,
    });
    const result = await db.from(SIGNALS_TABLE).upsert(row, { onConflict: 'fingerprint' }).select('*').single();
    if (result.error) throw result.error;
    return { row: result.data, created: !existing };
  }

  async function listSignals(query = {}) {
    const db = requireDb();
    const limit = safeLimit(query.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = Math.max(0, Math.min(100_000, Number(query.offset) || 0));
    let request = db.from(SIGNALS_TABLE).select('*').order('published_at', { ascending: false, nullsFirst: false }).order('found_at', { ascending: false });
    const platform = normalizePlatform(query.platform);
    const leadStatus = normalizeStatus(query.status);
    const websiteStatus = normalizeWebsiteStatus(query.website_status || query.websiteStatus);
    if (platform) request = request.eq('platform', platform);
    if (leadStatus) request = request.eq('lead_status', leadStatus);
    if (websiteStatus) request = request.eq('website_status', websiteStatus);
    if (query.region) request = request.ilike('region', `%${text(query.region, 100)}%`);
    if (query.search) request = request.or(`message_text.ilike.%${text(query.search, 100).replace(/[,()]/g, ' ')}%,author_name.ilike.%${text(query.search, 100).replace(/[,()]/g, ' ')}%,query.ilike.%${text(query.search, 100).replace(/[,()]/g, ' ')}%`);
    const minScore = normalizeInteger(query.min_score ?? query.minScore, { min: 0, max: 100 });
    if (minScore !== null) request = request.gte('relevance_score', minScore);
    const days = normalizeInteger(query.days, { min: 0, max: 3650 });
    if (days > 0) request = request.gte('published_at', new Date(Date.now() - days * 86_400_000).toISOString());
    if (typeof request.in === 'function' && !platform) request = request.in('platform', [...PLATFORMS]);
    if (typeof request.range === 'function') request = request.range(0, 4_999);
    const result = await request;
    if (result.error) throw result.error;
    const visibleSignals = (result.data || []).filter((signal) => {
      if (!PLATFORMS.includes(signal.platform)) return false;
      const requestedDays = normalizeInteger(query.days, { min: 1, max: 3650 }) || 3650;
      return isEligibleAutomaticSignal(signal, { maxAgeDays: requestedDays });
    });
    const page = visibleSignals.slice(offset, offset + limit);
    return {
      signals: page,
      total: visibleSignals.length,
      limit,
      offset,
    };
  }

  async function getSignal(id) {
    const db = requireDb();
    const normalizedId = text(id, 100);
    if (!normalizedId) throw new LeadRadarValidationError('Ongeldig lead-ID.');
    const result = await db.from(SIGNALS_TABLE).select('*').eq('id', normalizedId).limit(1);
    if (result.error) throw result.error;
    if (!result.data?.[0]) {
      const error = new Error('Lead niet gevonden.');
      error.statusCode = 404;
      throw error;
    }
    return result.data[0];
  }

  async function updateSignal(id, input = {}) {
    const db = requireDb();
    const existing = await getSignal(id);
    const patch = {};
    if (input.lead_status !== undefined || input.status !== undefined) {
      const status = normalizeStatus(input.lead_status ?? input.status);
      if (!status) throw new LeadRadarValidationError('Ongeldige leadstatus.');
      patch.lead_status = status;
    }
    if (input.internal_notes !== undefined) patch.internal_notes = text(input.internal_notes, MAX_NOTE_LENGTH);
    if (input.suggested_reply !== undefined) patch.suggested_reply = text(input.suggested_reply, MAX_NOTE_LENGTH);
    if (input.website_url !== undefined) {
      const websiteUrl = normalizeHttpUrl(input.website_url, { allowPlatform: false });
      if (!websiteUrl) throw new LeadRadarValidationError('Ongeldige website-URL.');
      patch.website_url = websiteUrl;
      patch.website_domain = new URL(websiteUrl).hostname;
      patch.website_status = 'website_found';
      patch.website_source = 'manual';
      patch.website_confidence_score = 100;
      patch.website_checked_at = new Date().toISOString();
    }
    if (input.website_status !== undefined) {
      const websiteStatus = normalizeWebsiteStatus(input.website_status);
      if (!websiteStatus) throw new LeadRadarValidationError('Ongeldige website-status.');
      patch.website_status = websiteStatus;
    }
    if (!Object.keys(patch).length) throw new LeadRadarValidationError('Geen geldige wijziging ontvangen.');
    patch.updated_at = new Date().toISOString();
    const result = await db.from(SIGNALS_TABLE).update(patch).eq('id', existing.id).select('*').single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function importSignal(input = {}) {
    const platform = normalizePlatform(input.platform);
    if (!platform) throw new LeadRadarValidationError('Kies Facebook of LinkedIn.');
    const sourceUrl = assertSourceUrl(input.source_url || input.sourceUrl || input.post_url || input.postUrl, platform);
    const messageText = text(input.message_text || input.messageText || input.snippet, MAX_MESSAGE_LENGTH);
    if (!messageText) throw new LeadRadarValidationError('Voeg de tekst of snippet van het bericht toe.');
    const publishedAt = normalizeDate(input.published_at || input.publishedAt);
    if (!publishedAt) throw new LeadRadarValidationError('Publicatiedatum is verplicht voor een Lead Radar-lead.');
    const classification = classifySignal({ platform, post_url: sourceUrl, author_name: input.author_name || input.authorName, message_text: messageText, snippet: messageText });
    if (classification.isProvider || classification.isExcluded || !classification.isWebsiteNeed) {
      throw new LeadRadarValidationError('Dit bericht lijkt geen concrete websitevraag van een ondernemer te zijn.');
    }
    const websiteUrl = input.website_url ? normalizeHttpUrl(input.website_url, { allowPlatform: false }) : extractUrls(messageText)[0] || '';
    if (input.website_url && !websiteUrl) throw new LeadRadarValidationError('Ongeldige website-URL.');
    const payload = {
      platform,
      source_type: 'manual',
      provider: 'manual',
      source_url: sourceUrl,
      post_url: sourceUrl,
      profile_url: normalizeHttpUrl(input.profile_url || input.profileUrl || ''),
      message_text: messageText,
      snippet: messageText,
      author_name: text(input.author_name || input.authorName, 500) || null,
      region: text(input.region, 120) || null,
      query: null,
      keyword_group: 'manual',
      published_at: publishedAt,
      found_at: new Date().toISOString(),
      likes: normalizeInteger(input.likes),
      comments: normalizeInteger(input.comments),
      engagement_known: input.likes !== undefined || input.comments !== undefined,
      lead_status: 'new',
      internal_notes: text(input.internal_notes || input.internalNotes, MAX_NOTE_LENGTH) || null,
      website_url: websiteUrl || null,
      website_domain: websiteUrl ? new URL(websiteUrl).hostname : null,
      website_status: websiteUrl ? 'website_found' : 'website_not_checked',
      website_source: websiteUrl ? (input.website_url ? 'manual' : 'post') : 'not_checked',
      website_confidence_score: websiteUrl ? 100 : null,
      website_checked_at: websiteUrl ? new Date().toISOString() : null,
    };
    const scored = scoreSignal(payload, { targetRegion: payload.region || '' });
    payload.relevance_score = scored.score;
    payload.score_reasons = scored.reasons;
    payload.fingerprint = buildFingerprint(payload);
    return upsertSignal(payload);
  }

  async function checkWebsiteForSignal(signal, { force = false } = {}) {
    const existingUrl = normalizeHttpUrl(signal.website_url, { allowPlatform: false });
    const existingStatus = normalizeWebsiteStatus(signal.website_status);
    if (existingUrl && !force && ['website_found', 'website_not_working', 'website_unverified'].includes(existingStatus)) {
      return {
        website_url: existingUrl,
        website_domain: new URL(existingUrl).hostname,
        website_title: signal.website_title || null,
        website_status: existingStatus,
        website_source: signal.website_source || 'manual',
        website_confidence_score: signal.website_confidence_score ?? null,
        website_http_status: signal.website_http_status ?? null,
        website_checked_at: signal.website_checked_at || null,
        website_check_error: signal.website_check_error || null,
        website_candidates: Array.isArray(signal.website_candidates) ? signal.website_candidates : [],
      };
    }
    const sourceText = `${signal.message_text || ''} ${signal.snippet || ''}`;
    const directUrl = extractUrls(sourceText)[0] || '';
    let candidateUrl = existingUrl || directUrl;
    let source = existingUrl ? (signal.website_source || 'post') : (directUrl ? 'post' : 'not_found');
    let candidates = [];
    if (!candidateUrl && provider?.configured && typeof provider.search === 'function') {
      const websiteQuery = buildWebsiteSearchQuery(signal);
      if (websiteQuery) {
        const items = await provider.search({ query: websiteQuery, maxResults: 10 });
        candidates = items
          .map((item) => ({ url: normalizeHttpUrl(item.url, { allowPlatform: false }), title: text(item.title, 500), snippet: text(item.snippet, 2_000) }))
          .filter((item) => item.url);
        const exactName = text(signal.author_name, 120).split('|')[0].toLowerCase().trim();
        const nameTokens = exactName
          .replace(/[^a-z0-9\s-]/gi, ' ')
          .split(/\s+/)
          .filter((token) => token.length >= 3 && !['website', 'webdesign', 'media', 'bureau', 'bedrijf'].includes(token));
        const regionName = text(signal.region, 100).toLowerCase();
        const scoredCandidates = candidates.map((item) => ({
          ...item,
          score: (() => {
            const candidateText = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
            const matchingTokens = nameTokens.filter((token) => candidateText.includes(token)).length;
            const exactMatch = exactName && candidateText.includes(exactName);
            const regionMatch = regionName && candidateText.includes(regionName);
            const directory = /\b(facebook|linkedin|offerte|vacature|yelp|bedrijvengids|gouden gids)\b/i.test(candidateText);
            return (exactMatch ? 55 : Math.min(45, matchingTokens * 20)) + (regionMatch ? 15 : 0) +
              (item.title.toLowerCase().includes('website') ? 5 : 0) - (directory ? 35 : 0);
          })(),
        })).sort((a, b) => b.score - a.score);
        candidates = scoredCandidates;
        if (scoredCandidates[0] && scoredCandidates[0].score >= 30) {
          candidateUrl = scoredCandidates[0].url;
          source = 'public_search';
        }
      }
    }
    if (!candidateUrl) {
      const hasWebsiteCandidate = candidates.length > 0;
      return {
        website_status: provider?.configured ? (hasWebsiteCandidate ? 'website_unverified' : 'no_website_found') : 'provider_unavailable',
        website_source: provider?.configured && hasWebsiteCandidate ? 'public_search' : (provider?.configured ? 'not_found' : 'not_checked'),
        website_checked_at: new Date().toISOString(),
        website_check_error: hasWebsiteCandidate ? 'Mogelijke website gevonden, maar de koppeling is nog niet betrouwbaar genoeg bevestigd.' : null,
        website_candidates: candidates,
      };
    }
    const check = await verifyWebsite(candidateUrl);
    return {
      website_url: candidateUrl,
      website_domain: new URL(candidateUrl).hostname,
      website_title: check.title || null,
      website_http_status: check.status,
      website_status: check.ok ? 'website_found' : 'website_not_working',
      website_source: source,
      website_confidence_score: source === 'post' ? 100 : (candidates[0]?.score >= 55 ? 90 : 60),
      website_checked_at: new Date().toISOString(),
      website_check_error: check.ok ? null : check.error,
      website_candidates: candidates,
    };
  }

  async function verifyWebsite(url) {
    const normalized = normalizeHttpUrl(url, { allowPlatform: false });
    if (!normalized) return { ok: false, status: null, title: '', error: 'Ongeldige of niet-openbare website-URL.' };
    if (typeof fetchImpl !== 'function') return { ok: false, status: null, title: '', error: 'Fetch is niet beschikbaar.' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 8_000) : null;
    try {
      const response = await fetchImpl(normalized, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller?.signal,
      });
      const body = await response.text().catch(() => '');
      const title = text((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '', 500).replace(/\s+/g, ' ');
      return { ok: response.ok, status: response.status, title, error: response.ok ? '' : `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, status: null, title: '', error: text(error?.message || error, 500) };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function verifyPublicSource(url) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized || typeof fetchImpl !== 'function') return true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 5_000) : null;
    try {
      const response = await fetchImpl(normalized, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller?.signal,
      });
      if ([404, 410].includes(Number(response.status))) return false;
      const body = await response.text().catch(() => '');
      return !/(this content isn't available|this page isn't available|content is not available|pagina is niet beschikbaar|pagina niet gevonden)/i.test(body);
    } catch {
      // A platform timeout or bot protection is inconclusive; do not discard a
      // possibly valid public lead because our server could not inspect it.
      return true;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function lookupWebsite(id, { force = false } = {}) {
    const signal = await getSignal(id);
    const website = await checkWebsiteForSignal(signal, { force });
    const db = requireDb();
    const result = await db.from(SIGNALS_TABLE).update({ ...website, updated_at: new Date().toISOString() }).eq('id', signal.id).select('*').single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function bulkLookupWebsite(input = {}) {
    const ids = Array.isArray(input.signalIds || input.signal_ids) ? (input.signalIds || input.signal_ids).map((id) => text(id, 100)).filter(Boolean).slice(0, MAX_WEBSITE_LOOKUP_LIMIT) : [];
    if (!ids.length) throw new LeadRadarValidationError('Selecteer minimaal één lead voor websitecontrole.');
    const results = [];
    for (const id of ids) {
      try { results.push(await lookupWebsite(id, { force: Boolean(input.force) })); }
      catch (error) { results.push({ id, error: text(error?.message || error, 300) }); }
    }
    return results;
  }

  async function createRun(row) {
    const db = requireDb();
    const result = await db.from(SCAN_RUNS_TABLE).insert(row).select('*').single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function updateRun(id, patch) {
    const db = requireDb();
    const result = await db.from(SCAN_RUNS_TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function listRuns(limit = 10) {
    const db = requireDb();
    const result = await db.from(SCAN_RUNS_TABLE).select('*').order('started_at', { ascending: false }).limit(safeLimit(limit, 10, 50));
    if (result.error) throw result.error;
    return (result.data || []).filter((run) => {
      const platforms = Array.isArray(run.platforms) ? run.platforms : [];
      return platforms.length === 0 || platforms.every((platform) => PLATFORMS.includes(platform));
    }).map((run) => ({ ...run, ...summarizeScanRun(run) }));
  }

  async function runScan(input = {}) {
    const maxQueries = safeLimit(input.maxQueries || input.max_queries, DEFAULT_SCAN_QUERY_LIMIT, MAX_SCAN_QUERY_LIMIT);
    const websiteLookupInput = input.websiteLookupLimit ?? input.website_lookup_limit;
    const websiteLookupLimit = websiteLookupInput === 0
      ? 0
      : safeLimit(websiteLookupInput, DEFAULT_WEBSITE_LOOKUP_LIMIT, MAX_WEBSITE_LOOKUP_LIMIT);
    let run;
    let plan;
    let cursor = 0;
    const requestedScanMode = text(input.scanMode || input.scan_mode, 20).toLowerCase();
    const scanMode = ['automatic', 'manual'].includes(requestedScanMode) ? requestedScanMode : 'manual';
    const maxAgeDays = normalizeInteger(input.maxAgeDays ?? input.max_age_days, { min: 1, max: 3650 }) || 30;
    if (input.runId || input.run_id) {
      const db = requireDb();
      const result = await db.from(SCAN_RUNS_TABLE).select('*').eq('id', text(input.runId || input.run_id, 100)).limit(1);
      if (result.error) throw result.error;
      run = result.data?.[0];
      if (!run) throw new LeadRadarValidationError('Scanrun niet gevonden.');
      plan = Array.isArray(run.query_plan) ? run.query_plan : [];
      cursor = normalizeInteger(run.query_cursor, { min: 0, max: plan.length }) || 0;
    } else {
      plan = buildSearchPlan(input);
      run = await createRun({
        provider: provider?.name || 'dataforseo',
        scan_mode: scanMode,
        max_age_days: maxAgeDays,
        platforms: plan.map((item) => item.platform).filter((item, index, array) => array.indexOf(item) === index),
        regions: plan.map((item) => item.region).filter((item, index, array) => array.indexOf(item) === index),
        query_plan: plan,
        query_cursor: 0,
        used_queries: [],
        max_queries: maxQueries,
        website_lookup_limit: websiteLookupLimit,
        result_count: 0,
        new_signal_count: 0,
        duplicate_count: 0,
        website_check_count: 0,
        website_found_count: 0,
        error_count: 0,
        status: 'running',
      });
    }
    if (!provider?.configured || typeof provider.search !== 'function') {
      return updateRun(run.id, { status: 'provider_unavailable', finished_at: new Date().toISOString(), last_error: 'SERP-provider is niet geconfigureerd.' });
    }
    try { await maintenance.cleanup(); } catch (error) { logger.warn('[LeadRadar][cleanup]', error?.message || error); } const end = Math.min(plan.length, cursor + maxQueries);
    const usedQueries = Array.isArray(run.used_queries) ? [...run.used_queries] : [];
    let resultCount = Number(run.result_count) || 0;
    let newSignalCount = Number(run.new_signal_count) || 0;
    let duplicateCount = Number(run.duplicate_count) || 0;
    let websiteCheckCount = Number(run.website_check_count) || 0;
    let websiteFoundCount = Number(run.website_found_count) || 0;
    let errorCount = Number(run.error_count) || 0;
    let websiteLookupsLeft = websiteLookupLimit;
    let sourceChecksLeft = DEFAULT_SOURCE_CHECK_LIMIT;
    for (let index = cursor; index < end; index += 1) {
      const query = plan[index];
      try {
        const items = await provider.search({ query: query.query, maxResults: 10 });
        resultCount += items.length;
        const queryDiagnostics = createQueryDiagnostics(); const queryRecord = { ...query, executedAt: new Date().toISOString(), resultCount: items.length, ...queryDiagnostics.snapshot(), status: 'completed' }; usedQueries.push(queryRecord);
        for (const item of items) {
          const signal = buildSignalFromProviderItem(item, {
            ...query,
            provider: provider.name,
            targetRegion: query.region,
            maxAgeDays: run.max_age_days || maxAgeDays,
            requireFresh: true, onReject: queryDiagnostics.reject,
          });
          if (!signal) continue;
          if (sourceChecksLeft > 0) {
            sourceChecksLeft -= 1;
            const sourceAvailable = await verifyPublicSource(signal.post_url);
            // Alleen een definitieve 404/410 of een expliciete platformmelding
            // dat de content niet bestaat mag een resultaat blokkeren. 403/429
            // en loginblokkades zijn geen bewijs dat de post verwijderd is.
            if (!sourceAvailable) { queryDiagnostics.reject('source_not_available'); continue; }
          }
          queryDiagnostics.accept(); const saved = await upsertSignal(signal);
          if (saved.created) newSignalCount += 1; else duplicateCount += 1;
          if (websiteLookupsLeft > 0 && signal.website_status === 'website_not_checked' && signal.author_name && signal.author_name.length > 3) {
            websiteLookupsLeft -= 1;
            websiteCheckCount += 1;
            try {
              const website = await checkWebsiteForSignal(saved.row, { force: false });
              const db = requireDb();
              await db.from(SIGNALS_TABLE).update({ ...website, updated_at: new Date().toISOString() }).eq('id', saved.row.id);
              if (website.website_status === 'website_found') websiteFoundCount += 1;
            } catch (error) {
              logger.warn('[LeadRadar][website-lookup]', error?.message || error);
            }
          }
        } Object.assign(queryRecord, queryDiagnostics.snapshot());
      } catch (error) {
        errorCount += 1;
        usedQueries.push({ ...query, executedAt: new Date().toISOString(), resultCount: 0, status: 'error', error: text(error?.message || error, 500) });
        logger.warn('[LeadRadar][scan-query]', error?.message || error);
      }
      await updateRun(run.id, {
        query_cursor: index + 1,
        used_queries: usedQueries,
        result_count: resultCount,
        new_signal_count: newSignalCount,
        duplicate_count: duplicateCount,
        website_check_count: websiteCheckCount,
        website_found_count: websiteFoundCount,
        error_count: errorCount,
        status: 'running',
      });
    }
    const completed = end >= plan.length;
    return updateRun(run.id, {
      query_cursor: end,
      used_queries: usedQueries,
      result_count: resultCount,
      new_signal_count: newSignalCount,
      duplicate_count: duplicateCount,
      website_check_count: websiteCheckCount,
      website_found_count: websiteFoundCount,
      error_count: errorCount,
      status: completed ? (errorCount ? 'completed_with_errors' : 'completed') : 'paused',
      finished_at: completed ? new Date().toISOString() : null,
    });
  }

  async function getLatestAutomaticRun() {
    const db = getDb();
    if (!db) return null;
    const result = await db.from(SCAN_RUNS_TABLE)
      .select('*')
      .eq('scan_mode', 'automatic')
      .order('started_at', { ascending: false })
      .limit(1);
    if (result.error) {
      logger.warn('[LeadRadar][automatic-status]', result.error.message || result.error);
      return null;
    }
    return (result.data || []).find((run) => {
      const platforms = Array.isArray(run.platforms) ? run.platforms : [];
      return platforms.length === 0 || platforms.every((platform) => PLATFORMS.includes(platform));
    }) || null;
  }

  function summarizeScanRun(run) {
    if (!run) return null; const diagnostics = summarizeScanDiagnostics(run.used_queries);
    return {
      id: run.id,
      scan_mode: run.scan_mode || 'manual',
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      updated_at: run.updated_at,
      query_cursor: Number(run.query_cursor || 0),
      query_count: Array.isArray(run.query_plan) ? run.query_plan.length : 0,
      result_count: Number(run.result_count || 0),
      new_signal_count: Number(run.new_signal_count || 0),
      duplicate_count: Number(run.duplicate_count || 0),
      error_count: Number(run.error_count || 0), accepted_signal_count: diagnostics.acceptedSignalCount, rejection_reasons: diagnostics.rejectionReasons,
    };
  }

  async function runScheduledScan() {
    const config = getAutomaticScanConfig(env);
    if (!config.enabled) return { skipped: true, status: 'disabled', config };
    if (!getDb()) return { skipped: true, status: 'storage_unavailable', config };
    if (!provider?.configured || typeof provider.search !== 'function') {
      return { skipped: true, status: 'provider_unavailable', config };
    }

    const latest = await getLatestAutomaticRun();
    const latestUpdatedAt = latest?.updated_at ? new Date(latest.updated_at).getTime() : 0;
    const latestFinishedAt = latest?.finished_at ? new Date(latest.finished_at).getTime() : 0;
    const now = Date.now();
    const activeRun = latest && ['running', 'paused'].includes(latest.status) &&
      Number(latest.query_cursor || 0) < (Array.isArray(latest.query_plan) ? latest.query_plan.length : 0);

    if (activeRun && (!latestUpdatedAt || now - latestUpdatedAt < 2 * 60 * 60 * 1000)) {
      return {
        skipped: false,
        resumed: true,
        run: await runScan({
          runId: latest.id,
          maxQueries: config.maxQueries,
          websiteLookupLimit: config.websiteLookupLimit,
        }),
        config,
      };
    }
    if (latestFinishedAt && now - latestFinishedAt < config.intervalMinutes * 60 * 1000) {
      return { skipped: true, status: 'waiting_for_next_interval', run: latest, config };
    }

    const initialBackfillCompleted = hasCompletedInitialBackfill(latest, config);

    return {
      skipped: false,
      resumed: false,
      run: await runScan({
        platforms: config.platforms,
        regionMode: config.regionMode,
        keywordGroups: config.keywordGroups,
        maxQueries: config.maxQueries,
        websiteLookupLimit: config.websiteLookupLimit,
        maxAgeDays: initialBackfillCompleted ? config.refreshLookbackDays : config.initialLookbackDays,
        scanMode: 'automatic',
      }),
      config,
    };
  }

  async function getStatus() {
    const storageConfigured = Boolean(getDb());
    const autoScanConfig = getAutomaticScanConfig(env);
    const status = {
      storageConfigured,
      provider: provider?.getStatus ? provider.getStatus() : { configured: false, provider: 'unknown' },
      websiteStatuses: WEBSITE_STATUSES,
      leadStatuses: LEAD_STATUSES,
      keywordGroups: Object.fromEntries(Object.entries(KEYWORD_GROUPS).map(([key, values]) => [key, values.length])),
      negativeTerms: NEGATIVE_TERMS,
      regionalCoverage: { provinces: PROVINCES.length, cities: IMPORTANT_CITIES.length },
      defaults: { maxQueries: DEFAULT_SCAN_QUERY_LIMIT, websiteLookupLimit: DEFAULT_WEBSITE_LOOKUP_LIMIT },
      autoScan: { ...autoScanConfig, initialBackfillCompleted: false, lastRun: null },
    };
    if (!storageConfigured) return status;
    const db = getDb();
    const count = async (column, value) => {
      let request = db.from(SIGNALS_TABLE).select('id', { count: 'exact', head: true });
      if (typeof request.in === 'function') request = request.in('platform', [...PLATFORMS]);
      if (typeof request.not === 'function') request = request.not('published_at', 'is', null).not('post_url', 'is', null);
      if (column) request = request.eq(column, value);
      const result = await request;
      return result.error ? null : result.count || 0;
    };
    const [total, newCount, websiteFound, noWebsiteFound, notChecked, notWorking, latestAutomaticRun] = await Promise.all([
      count(),
      count('lead_status', 'new'),
      count('website_status', 'website_found'),
      count('website_status', 'no_website_found'),
      count('website_status', 'website_not_checked'),
      count('website_status', 'website_not_working'),
      getLatestAutomaticRun(),
    ]);
    status.counts = { total, new: newCount, websiteFound, noWebsiteFound, notChecked, notWorking };
    status.autoScan.lastRun = summarizeScanRun(latestAutomaticRun);
    status.autoScan.initialBackfillCompleted = hasCompletedInitialBackfill(latestAutomaticRun, autoScanConfig);
    status.autoScan.nextLookbackDays = status.autoScan.initialBackfillCompleted
      ? autoScanConfig.refreshLookbackDays
      : autoScanConfig.initialLookbackDays;
    return status;
  }

  return {
    buildFingerprint,
    buildSearchPlan,
    extractUrls,
    normalizeHttpUrl,
    normalizePlatform,
    normalizeStatus,
    normalizeWebsiteStatus,
    isLikelyDirectPlatformPostUrl,
    isRecentPublication,
    normalizeProviderPublishedAt,
    scoreSignal,
    hasCompletedInitialBackfill,
    getStatus,
    listSignals,
    getSignal,
    updateSignal,
    importSignal,
    lookupWebsite,
    bulkLookupWebsite,
    runScan,
    runScheduledScan,
    listRuns,
    constants: { SIGNALS_TABLE, SCAN_RUNS_TABLE, WEBSITE_STATUSES, LEAD_STATUSES, KEYWORD_GROUPS },
  };
}

module.exports = {
  createDataForSeoProvider,
  createLeadRadarService,
  buildFingerprint,
  buildSignalFromProviderItem,
  buildSearchPlan,
  hasCompletedInitialBackfill,
  classifySignal,
  isLikelyDirectPlatformPostUrl,
  isRecentPublication,
  normalizeProviderPublishedAt,
  getAutomaticScanConfig,
  normalizeHttpUrl,
  normalizePlatform,
  normalizeStatus,
  normalizeWebsiteStatus,
  scoreSignal,
  WEBSITE_STATUSES,
  LEAD_STATUSES,
};


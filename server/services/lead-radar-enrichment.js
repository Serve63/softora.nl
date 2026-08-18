'use strict';

const BUSINESS_LISTINGS_ENDPOINT = 'https://api.dataforseo.com/v3/business_data/business_listings/search/live';
const ONPAGE_INSTANT_ENDPOINT = 'https://api.dataforseo.com/v3/on_page/instant_pages';
const AGENCY_TERMS = Object.freeze([
  'webdesign', 'webdesigner', 'websitebouwer', 'webbureau', 'web development',
  'webdeveloper', 'online marketing', 'marketingbureau', 'marketing bureau',
  'seo bureau', 'seo specialist', 'digital agency', 'reclamebureau', 'internetbureau',
  'webshopbouwer', 'wordpress specialist', 'shopify partner', 'website maken',
  'websites maken', 'websites bouwen',
]);
const SOCIAL_HOSTS = /(?:^|\.)facebook\.|(?:^|\.)linkedin\.|(?:^|\.)instagram\.|(?:^|\.)google\.(?:com|nl)$/i;
const MAP_HOSTS = /(?:^|\.)(?:google\.|googleusercontent\.|maps\.)/i;

function limitText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeName(value) {
  return limitText(value, 300)
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\b(bv|b\.v\.|vof|eenmanszaak|stichting|vereniging|bedrijf|onderneming)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeName(value).split(' ').filter((token) => token.length >= 3);
}

function containsAgencyTerms(value) {
  const normalized = String(value || '').toLowerCase();
  return AGENCY_TERMS.some((term) => normalized.includes(term));
}

function normalizeDomain(value) {
  const raw = limitText(value, 500).replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) ? raw : '';
}

function websiteUrlFromListing(item, normalizeHttpUrl) {
  const domain = normalizeDomain(item?.domain);
  if (domain) return normalizeHttpUrl(`https://${domain}`, { allowPlatform: false });
  const candidate = normalizeHttpUrl(item?.url, { allowPlatform: false });
  if (!candidate) return '';
  try {
    const hostname = new URL(candidate).hostname;
    if (SOCIAL_HOSTS.test(hostname) || MAP_HOSTS.test(hostname)) return '';
    return candidate;
  } catch {
    return '';
  }
}

function ratingValue(item) {
  const value = item?.rating?.value ?? item?.rating;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratingVotes(item) {
  const value = item?.rating?.votes_count ?? item?.rating?.votesCount;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

function compactLinks(item) {
  const links = Array.isArray(item?.links) ? item.links : (Array.isArray(item?.meta?.links) ? item.meta.links : []);
  return links.slice(0, 25).map((link) => ({
    url: limitText(link?.url || link?.href, 2_000),
    title: limitText(link?.title || link?.anchor, 300),
    type: limitText(link?.type, 50),
  })).filter((link) => link.url);
}

function compactChecks(item) {
  const checks = item?.checks && typeof item.checks === 'object' ? item.checks : {};
  const allowed = [
    'is_redirect', 'is_4xx_code', 'is_5xx_code', 'is_broken', 'is_https',
    'is_http', 'no_doctype', 'no_h1_tag', 'broken_links', 'broken_resources',
    'high_loading_time', 'low_content_rate', 'has_html_doctype',
  ];
  return Object.fromEntries(allowed.filter((key) => checks[key] !== undefined).map((key) => [key, checks[key]]));
}

function createLeadRadarEnrichment({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  normalizeHttpUrl,
} = {}) {
  const login = limitText(env.LEAD_RADAR_DATAFORSEO_LOGIN || env.DATAFORSEO_LOGIN, 500);
  const password = limitText(env.LEAD_RADAR_DATAFORSEO_PASSWORD || env.DATAFORSEO_PASSWORD, 500);
  const configured = Boolean(login && password);

  async function postLive(endpoint, payload) {
    if (!configured) {
      const error = new Error('DataForSEO-verrijking is niet geconfigureerd.');
      error.code = 'LEAD_RADAR_ENRICHMENT_UNAVAILABLE';
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
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    const task = body?.tasks?.[0];
    if (!response.ok || body?.status_code !== 20000 || task?.status_code !== 20000) {
      const message = limitText(body?.status_message || task?.status_message || `DataForSEO HTTP ${response.status}`, 500);
      const error = new Error(message || 'DataForSEO gaf een fout bij verrijking.');
      error.code = 'LEAD_RADAR_ENRICHMENT_ERROR';
      throw error;
    }
    return { body, task };
  }

  function normalizeListing(item, signal) {
    const name = limitText(item?.title || item?.original_title, 300);
    const description = limitText(item?.description || item?.snippet, 1_000);
    const category = limitText(item?.category, 200);
    const city = limitText(item?.address_info?.city, 160);
    const region = limitText(item?.address_info?.region, 160);
    const sourceText = `${name} ${description} ${category}`;
    const signalName = normalizeName(signal.author_name);
    const listingName = normalizeName(name);
    const nameTokens = tokens(signalName);
    const matchingTokens = nameTokens.filter((token) => listingName.includes(token)).length;
    const exactName = Boolean(signalName && listingName && (signalName === listingName || listingName.includes(signalName) || signalName.includes(listingName)));
    const requestedRegion = normalizeName(signal.region);
    const listingRegion = normalizeName(`${city} ${region} ${item?.address}`);
    const regionMatch = Boolean(requestedRegion && listingRegion && (listingRegion.includes(requestedRegion) || requestedRegion.includes(listingRegion)));
    const score = Math.max(0, Math.min(100,
      (exactName ? 65 : Math.min(55, matchingTokens * 22)) +
      (regionMatch ? 25 : 0) +
      (item?.phone ? 5 : 0) +
      (item?.domain || item?.url ? 5 : 0)
    ));
    const agencyDetected = containsAgencyTerms(sourceText);
    return {
      business_name: name || null,
      business_address: limitText(item?.address || item?.address_info?.address, 300) || null,
      business_city: city || null,
      business_region: region || null,
      business_postal_code: limitText(item?.address_info?.zip, 30) || null,
      business_phone: limitText(item?.phone, 80) || null,
      business_domain: normalizeDomain(item?.domain) || null,
      business_website_url: websiteUrlFromListing(item, normalizeHttpUrl) || null,
      business_place_id: limitText(item?.place_id, 200) || null,
      business_cid: limitText(item?.cid, 200) || null,
      business_category: category || null,
      business_is_claimed: typeof item?.is_claimed === 'boolean' ? item.is_claimed : null,
      business_rating: ratingValue(item),
      business_rating_votes: ratingVotes(item),
      business_match_score: score,
      business_agency_detected: agencyDetected,
      business_match_reasons: [
        exactName ? 'Bedrijfsnaam komt sterk overeen' : (matchingTokens ? `${matchingTokens} naamdelen komen overeen` : 'Bedrijfsnaam komt onvoldoende overeen'),
        regionMatch ? 'Plaats/regio komt overeen' : 'Plaats/regio niet bevestigd',
        agencyDetected ? 'Mogelijk marketing- of webdesignbedrijf' : 'Geen duidelijke agency-indicatie in bedrijfsgegevens',
      ],
      business_source: 'business_listings',
    };
  }

  async function lookupBusiness(signal = {}) {
    const name = limitText(signal.author_name, 200);
    if (!name || name.length < 3) return { business_match_status: 'not_checked', business_source: 'unknown' };
    if (!configured) return { business_match_status: 'provider_unavailable', business_source: 'unknown' };
    try {
      const { task } = await postLive(BUSINESS_LISTINGS_ENDPOINT, [{
        language_code: 'nl',
        title: name,
        description: limitText(`${signal.region || 'Nederland'}, Nederland`, 200),
        limit: 10,
        order_by: ['rating.votes_count,desc'],
      }]);
      const result = task?.result?.[0];
      const items = Array.isArray(result?.items) ? result.items : [];
      const candidates = items.map((item) => normalizeListing(item, signal))
        .filter((item) => item.business_name || item.business_domain)
        .sort((a, b) => b.business_match_score - a.business_match_score)
        .slice(0, 5);
      const best = candidates[0];
      if (!best) {
        return {
          business_match_status: 'not_found',
          business_source: 'business_listings',
          business_checked_at: new Date().toISOString(),
          business_candidates: [],
        };
      }
      const status = best.business_agency_detected
        ? 'agency_detected'
        : (best.business_match_score >= 70 ? 'matched' : (best.business_match_score >= 40 ? 'ambiguous' : 'not_found'));
      const matched = status === 'matched' || status === 'agency_detected';
      return {
        ...(matched ? best : {}),
        business_match_status: status,
        business_source: 'business_listings',
        business_checked_at: new Date().toISOString(),
        business_candidates: candidates,
        business_check_error: status === 'not_found' ? 'Geen betrouwbare bedrijfsvermelding gevonden.' : null,
      };
    } catch (error) {
      logger.warn('[LeadRadar][business-listings]', error?.message || error);
      return {
        business_match_status: 'provider_error',
        business_source: 'business_listings',
        business_checked_at: new Date().toISOString(),
        business_check_error: limitText(error?.message || error, 500),
        business_candidates: [],
      };
    }
  }

  async function inspectWebsite(url) {
    const normalized = normalizeHttpUrl(url, { allowPlatform: false });
    if (!normalized || !configured) return { available: false };
    try {
      const { task } = await postLive(ONPAGE_INSTANT_ENDPOINT, [{ url: normalized }]);
      const result = task?.result?.[0];
      const item = result?.items?.find((entry) => entry.resource_type === 'html') || result?.items?.[0];
      if (!item) return { available: false, error: 'OnPage gaf geen HTML-pagina terug.' };
      const status = Number(item.status_code) || null;
      const checks = compactChecks(item);
      const technicalFailure = Boolean(checks.is_4xx_code || checks.is_5xx_code || checks.is_broken || (status && status >= 400));
      return {
        available: true,
        website_http_status: status,
        website_title: limitText(item.meta?.title, 500) || null,
        website_redirect_url: limitText(item.location, 2_000) || null,
        website_status: technicalFailure ? 'website_not_working' : 'website_found',
        website_check_provider: 'dataforseo_onpage',
        website_technical_checks: checks,
        website_links: compactLinks(item),
        website_check_error: technicalFailure ? `Websitecontrole meldt HTTP ${status || 'fout'} of een kapotte pagina.` : null,
      };
    } catch (error) {
      logger.warn('[LeadRadar][onpage]', error?.message || error);
      return { available: false, error: limitText(error?.message || error, 500) };
    }
  }

  return {
    configured,
    businessListingsConfigured: configured,
    onPageConfigured: configured,
    lookupBusiness,
    inspectWebsite,
    getStatus() {
      return {
        configured,
        businessListingsConfigured: configured,
        onPageConfigured: configured,
        businessListingsEndpoint: configured ? BUSINESS_LISTINGS_ENDPOINT : null,
        onPageEndpoint: configured ? ONPAGE_INSTANT_ENDPOINT : null,
      };
    },
  };
}

module.exports = {
  createLeadRadarEnrichment,
  normalizeName,
  normalizeDomain,
  compactChecks,
};

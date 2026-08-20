'use strict';

const { createLeadRadarPublicFetcher, decodeEntities, stripHtml } = require('./lead-radar-public-scraper');

const AGENCY_TERMS = Object.freeze([
  'webdesign', 'webdesigner', 'websitedesigner', 'websitebouwer', 'webbureau', 'web development',
  'webdeveloper', 'online marketing', 'marketingbureau', 'marketing bureau',
  'seo bureau', 'seo specialist', 'digital agency', 'reclamebureau', 'internetbureau',
  'webshopbouwer', 'wordpress specialist', 'shopify partner', 'website maken',
  'websites maken', 'websites bouwen', 'softwarebureau', 'software agency',
]);
const EXCLUDED_WEBSITE_HOSTS = /(?:^|\.)(?:facebook|linkedin|instagram|bsky)\.(?:com|app)$|(?:^|\.)google\.(?:com|nl)$/i;

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

function containsAgencyTerms(value) {
  const normalized = String(value || '').toLowerCase();
  return AGENCY_TERMS.some((term) => normalized.includes(term));
}

function normalizeDomain(value) {
  const raw = limitText(value, 500).replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) ? raw : '';
}

function readAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

function extractTitle(html) {
  const source = String(html || '').slice(0, 1_000_000);
  const metaTags = source.match(/<meta\b[^>]*>/gi) || [];
  const ogTitle = metaTags.find((tag) => ['og:title', 'twitter:title'].includes(
    (readAttribute(tag, 'property') || readAttribute(tag, 'name')).toLowerCase()
  ));
  const value = ogTitle ? readAttribute(ogTitle, 'content') : source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripHtml(value, 500);
}

function extractLinks(html, baseUrl, normalizeHttpUrl) {
  const source = String(html || '').slice(0, 1_000_000);
  const links = [];
  for (const tag of source.match(/<a\b[^>]*>/gi) || []) {
    const href = readAttribute(tag, 'href');
    if (!href) continue;
    try {
      const url = normalizeHttpUrl(new URL(href, baseUrl).toString(), { allowPlatform: false });
      if (!url || new URL(url).origin === new URL(baseUrl).origin) continue;
      links.push({ url, title: '', type: 'external' });
    } catch { /* Skip malformed links. */ }
    if (links.length >= 25) break;
  }
  return [...new Map(links.map((link) => [link.url, link])).values()];
}

function directWebsiteCandidate(signal, normalizeHttpUrl) {
  const candidates = [signal.website_url, signal.business_website_url]
    .map((value) => normalizeHttpUrl(value, { allowPlatform: false }))
    .filter(Boolean);
  return candidates.find((value) => {
    try { return !EXCLUDED_WEBSITE_HOSTS.test(new URL(value).hostname); } catch { return false; }
  }) || '';
}

function createLeadRadarEnrichment({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  normalizeHttpUrl,
} = {}) {
  const publicFetcher = createLeadRadarPublicFetcher({ env, fetchImpl, logger });
  const configured = typeof fetchImpl === 'function';

  async function lookupBusiness(signal = {}) {
    const websiteUrl = directWebsiteCandidate(signal, normalizeHttpUrl);
    const name = limitText(signal.author_name, 300);
    if (!websiteUrl) {
      return {
        business_match_status: 'not_found',
        business_source: 'direct_public_source',
        business_checked_at: new Date().toISOString(),
        business_candidates: [],
        business_check_error: 'De openbare bron bevat geen controleerbare bedrijfswebsite.',
      };
    }
    const agencyDetected = containsAgencyTerms(`${name} ${signal.message_text || ''}`);
    return {
      business_name: name || null,
      business_domain: normalizeDomain(websiteUrl) || null,
      business_website_url: websiteUrl,
      business_match_score: 80,
      business_agency_detected: agencyDetected,
      business_match_reasons: [
        'Website rechtstreeks gevonden in de openbare bron of het openbare profiel',
        agencyDetected ? 'Mogelijk marketing- of webdesignbedrijf' : 'Geen duidelijke agency-indicatie',
      ],
      business_match_status: agencyDetected ? 'agency_detected' : 'matched',
      business_source: 'direct_public_source',
      business_checked_at: new Date().toISOString(),
      business_candidates: [{
        business_name: name || null,
        business_domain: normalizeDomain(websiteUrl) || null,
        business_website_url: websiteUrl,
        business_match_score: 80,
      }],
      business_check_error: null,
    };
  }

  async function inspectWebsite(url) {
    const normalized = normalizeHttpUrl(url, { allowPlatform: false });
    if (!normalized || !configured) return { available: false };
    try {
      const result = await publicFetcher.fetchPublic(normalized, {
        accept: 'text/html,application/xhtml+xml;q=0.9',
        allowHttpErrors: true,
      });
      const status = Number(result.response.status) || null;
      const contentType = String(result.response.headers?.get?.('content-type') || '').toLowerCase();
      const isHtml = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
      const technicalFailure = Boolean(!status || status >= 400 || !isHtml);
      const finalUrl = normalizeHttpUrl(result.url, { allowPlatform: false }) || result.url;
      const redirected = finalUrl !== normalized;
      return {
        available: true,
        website_http_status: status,
        website_title: isHtml ? extractTitle(result.body) || null : null,
        website_redirect_url: redirected ? finalUrl : null,
        website_status: technicalFailure ? 'website_not_working' : 'website_found',
        website_check_provider: 'softora_direct_fetch',
        website_technical_checks: {
          is_redirect: redirected,
          is_4xx_code: Boolean(status && status >= 400 && status < 500),
          is_5xx_code: Boolean(status && status >= 500),
          is_broken: technicalFailure,
          is_https: finalUrl.startsWith('https://'),
          has_html_doctype: /<!doctype\s+html/i.test(result.body),
          no_h1_tag: isHtml ? !/<h1\b/i.test(result.body) : null,
        },
        website_links: isHtml ? extractLinks(result.body, result.url, normalizeHttpUrl) : [],
        website_check_error: technicalFailure
          ? `Eigen websitecontrole meldt HTTP ${status || 'onbekend'} of geen HTML-pagina.`
          : null,
      };
    } catch (error) {
      logger.warn('[LeadRadar][direct-website]', error?.message || error);
      return { available: false, error: limitText(error?.message || error, 500) };
    }
  }

  return {
    configured,
    businessListingsConfigured: false,
    onPageConfigured: configured,
    lookupBusiness,
    inspectWebsite,
    getStatus() {
      return {
        configured,
        businessListingsConfigured: false,
        onPageConfigured: configured,
        provider: 'softora_direct_fetch',
        paid: false,
      };
    },
  };
}

module.exports = {
  createLeadRadarEnrichment,
  normalizeName,
  normalizeDomain,
  extractLinks,
  extractTitle,
};

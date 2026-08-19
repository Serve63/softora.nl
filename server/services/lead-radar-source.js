'use strict';

const CONTENT_MATCH_THRESHOLD = 65;
const STOP_WORDS = new Set([
  'aan', 'als', 'bij', 'dat', 'de', 'die', 'dit', 'een', 'en', 'er', 'het', 'ik',
  'in', 'is', 'je', 'kan', 'met', 'naar', 'niet', 'of', 'om', 'op', 'te', 'van',
  'voor', 'wat', 'we', 'wij', 'ze', 'zijn', 'the', 'and', 'for', 'from', 'this',
  'that', 'with', 'you', 'your', 'www', 'http', 'https', 'com',
]);

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
}

function decodeJsonText(value) {
  return decodeHtml(String(value || ''))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n|\\r|\\t/g, ' ')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function readAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeHtml(match[1]).trim() : '';
}

function getMetaContent(html, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (readAttribute(tag, 'property') || readAttribute(tag, 'name')).toLowerCase();
    if (wanted.has(key)) return readAttribute(tag, 'content');
  }
  return '';
}

function extractCanonicalUrl(html, normalizeHttpUrl) {
  const links = String(html || '').match(/<link\b[^>]*>/gi) || [];
  const canonical = links.find((tag) => /rel\s*=\s*["'][^"']*canonical/i.test(tag));
  return normalizeHttpUrl(readAttribute(canonical, 'href') || getMetaContent(html, ['og:url']));
}

function extractPostId(value) {
  try {
    const parsed = new URL(String(value || ''));
    const path = decodeURIComponent(parsed.pathname);
    if (/linkedin\.com$/i.test(parsed.hostname) || /\.linkedin\.com$/i.test(parsed.hostname)) {
      const activity = path.match(/(?:activity[-_:]|urn:li:activity:)(\d{8,})/i);
      return activity ? `linkedin:${activity[1]}` : path.match(/^\/posts\/([^/?#]+)/i)?.[1] ? `linkedin:${path.match(/^\/posts\/([^/?#]+)/i)[1]}` : '';
    }
    const groupPost = path.match(/^\/groups\/[^/]+\/posts\/(\d+)/i);
    const pathPost = path.match(/\/(?:posts?|videos?|reels?|share\/p|share\/r)\/([^/?#]+)/i);
    const queryPost = parsed.searchParams.get('story_fbid') || parsed.searchParams.get('fbid');
    const id = groupPost?.[1] || queryPost || pathPost?.[1] || '';
    return id ? `facebook:${id}` : '';
  } catch {
    return '';
  }
}

function extractPublicPostText(html) {
  const source = String(html || '').slice(0, 2_000_000);
  const candidates = [
    getMetaContent(source, ['og:description', 'twitter:description', 'description']),
  ];
  for (const key of ['articleBody', 'article_body', 'text', 'description']) {
    const expression = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\]){8,})"`, 'gi');
    for (const match of source.matchAll(expression)) candidates.push(decodeJsonText(match[1]));
  }
  return [...new Set(candidates.map(decodeJsonText).filter((value) => value.length >= 20))].join(' ');
}

function contentMatchScore(expected, actual) {
  const tokenize = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g) || [];
  const expectedTokens = [...new Set(tokenize(expected).filter((token) => !STOP_WORDS.has(token)))];
  const actualTokens = new Set(tokenize(actual).filter((token) => !STOP_WORDS.has(token)));
  if (expectedTokens.length < 5 || actualTokens.size < 5) return 0;
  const matched = expectedTokens.filter((token) => actualTokens.has(token)).length;
  return Math.round((matched / expectedTokens.length) * 100);
}

function createLeadRadarSourceVerifier({ fetchImpl = globalThis.fetch, normalizeHttpUrl, getPublicPagePublicationDetails }) {
  async function verifyPublicSource(url, options = {}) {
    const normalized = normalizeHttpUrl(url);
    const baseResult = {
      status: 'unverified', reason: 'Bron kon niet worden gecontroleerd.', available: true,
      publication: null, canonicalUrl: '', postId: extractPostId(normalized), contentMatchScore: 0,
    };
    if (!normalized || typeof fetchImpl !== 'function') return baseResult;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 5_000) : null;
    try {
      const response = await fetchImpl(normalized, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller?.signal,
      });
      if ([404, 410].includes(Number(response.status))) {
        return { ...baseResult, status: 'rejected', reason: `Bron geeft HTTP ${response.status}.`, available: false };
      }
      if ([401, 403, 429].includes(Number(response.status))) {
        return { ...baseResult, reason: `Broncontrole geblokkeerd met HTTP ${response.status}.` };
      }
      const body = await response.text().catch(() => '');
      const unavailable = /(this content isn't available|this page isn't available|content is not available|pagina is niet beschikbaar|pagina niet gevonden)/i.test(body);
      if (unavailable) return { ...baseResult, status: 'rejected', reason: 'Platform meldt dat de post niet beschikbaar is.', available: false };
      const canonicalUrl = extractCanonicalUrl(body, normalizeHttpUrl);
      const requestedPostId = extractPostId(normalized);
      const canonicalPostId = extractPostId(canonicalUrl);
      if (requestedPostId && canonicalPostId && requestedPostId !== canonicalPostId) {
        return { ...baseResult, status: 'rejected', reason: 'De bron verwijst naar een andere post.', canonicalUrl, postId: canonicalPostId };
      }
      const sourceText = extractPublicPostText(body);
      const matchScore = contentMatchScore(options.expectedText, sourceText);
      if (sourceText && options.expectedText && matchScore < CONTENT_MATCH_THRESHOLD) {
        return {
          ...baseResult, status: 'rejected', reason: 'De geopende post bevat niet dezelfde aanvraagtekst.',
          canonicalUrl, postId: canonicalPostId || requestedPostId, contentMatchScore: matchScore,
        };
      }
      if (!sourceText || !options.expectedText) {
        return {
          ...baseResult, reason: 'De openbare bron gaf geen controleerbare posttekst.',
          canonicalUrl, postId: canonicalPostId || requestedPostId,
        };
      }
      const pagePublication = getPublicPagePublicationDetails(body, new Date().toISOString());
      const providerPublication = options.providerPublication?.publishedAt ? options.providerPublication : null;
      const publication = pagePublication?.publishedAt ? pagePublication : providerPublication;
      if (!publication?.publishedAt) {
        return {
          ...baseResult, reason: 'De openbare bron en zoekprovider gaven geen betrouwbare publicatiedatum.',
          canonicalUrl, postId: canonicalPostId || requestedPostId, contentMatchScore: matchScore,
        };
      }
      return {
        status: 'verified', reason: 'Directe post, aanvraagtekst en publicatiedatum zijn bevestigd.', available: true,
        publication, canonicalUrl, postId: canonicalPostId || requestedPostId, contentMatchScore: matchScore,
      };
    } catch (error) {
      return { ...baseResult, reason: error?.name === 'AbortError' ? 'Broncontrole liep in een timeout.' : 'Broncontrole is technisch mislukt.' };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  return { verifyPublicSource };
}

module.exports = {
  CONTENT_MATCH_THRESHOLD,
  contentMatchScore,
  createLeadRadarSourceVerifier,
  extractPostId,
  extractPublicPostText,
};


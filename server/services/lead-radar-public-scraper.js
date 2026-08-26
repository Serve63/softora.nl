'use strict';

const { parseDocument } = require('htmlparser2');
const { assertWebsitePreviewUrlIsPublic } = require('../security/public-url');

const DEFAULT_PUBLIC_FEEDS = Object.freeze([
  'https://www.higherlevel.nl/rss/2-forum.xml/',
  'https://nl.wordpress.org/support/view/all-topics/feed/',
]);
const DEFAULT_MASTODON_INSTANCES = Object.freeze([
  'https://mastodon.nl',
]);
const BLUESKY_SEARCH_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const DEFAULT_USER_AGENT = 'SoftoraLeadRadar/1.0 (+https://www.softora.nl/lead-radar)';
const MAX_RESPONSE_BYTES = 2_000_000;
const ROBOTS_CACHE_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 8_000;

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function safeLimit(value, fallback = 25, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseUrlList(value, defaults = []) {
  const configured = String(value || '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean);
  return [...new Set((configured.length ? configured : defaults).map((entry) => {
    try {
      const parsed = new URL(entry);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '';
    }
  }).filter(Boolean))];
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    })[name.toLowerCase()] || entity);
}

function stripHtml(value, maxLength = 20_000) {
  const document = parseDocument(String(value || ''), { decodeEntities: true });
  function readNodes(nodes = []) {
    return nodes.map((node) => {
      if (node?.type === 'text') return node.data || '';
      const name = String(node?.name || '').toLowerCase();
      if (name === 'script' || name === 'style') return '';
      const content = readNodes(node?.children || []);
      return ['br', 'p', 'div', 'li', 'article', 'section'].includes(name) ? `${content}\n` : content;
    }).join('');
  }
  return text(readNodes(document.children)
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n'), maxLength);
}

function firstTag(block, names) {
  for (const name of names) {
    const match = String(block || '').match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeEntities(match[1]).trim();
  }
  return '';
}

function atomLink(block) {
  const candidates = String(block || '').match(/<link\b[^>]*>/gi) || [];
  const preferred = candidates.find((tag) => !/\brel\s*=\s*["'](?:self|hub)["']/i.test(tag)) || candidates[0] || '';
  return decodeEntities(preferred.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '');
}

function absoluteUrl(value, baseUrl) {
  try {
    const parsed = new URL(decodeEntities(value), baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function parsePublicFeed(xml, feedUrl) {
  const source = String(xml || '').slice(0, MAX_RESPONSE_BYTES);
  const rssItems = source.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const atomEntries = source.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  return [...rssItems, ...atomEntries].map((block) => {
    const linkValue = firstTag(block, ['link']) || atomLink(block);
    const url = absoluteUrl(stripHtml(linkValue, 2_000), feedUrl);
    const title = stripHtml(firstTag(block, ['title']), 500);
    const description = stripHtml(firstTag(block, ['content:encoded', 'content', 'description', 'summary']), 20_000);
    const publishedAt = firstTag(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const authorName = stripHtml(firstTag(block, ['dc:creator', 'author', 'name']), 500);
    const externalId = stripHtml(firstTag(block, ['guid', 'id']), 500) || url;
    if (!url || (!title && !description)) return null;
    return {
      platform: 'web',
      source_type: 'feed',
      provider: 'softora_public_scraper',
      source_feed_url: feedUrl,
      url,
      title,
      snippet: `${title}${title && description ? '\n' : ''}${description}`.trim(),
      author_name: authorName || null,
      external_id: externalId,
      published_at: publishedAt || null,
      retrieved_at: new Date().toISOString(),
      source_verified: true,
      source_verification_reason: 'Aanvraag rechtstreeks gelezen uit een openbare RSS/Atom-feed.',
    };
  }).filter(Boolean);
}

function parseRobotsGroups(body) {
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length) groups.push({ agents: [...agents], rules: [...rules] });
    agents = [];
    rules = [];
  };
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && agents.length) {
      rules.push({ type: key, path: value });
    }
  }
  flush();
  return groups;
}

function robotsPathMatches(rulePath, pathname) {
  if (!rulePath) return false;
  const anchored = rulePath.endsWith('$');
  const pattern = anchored ? rulePath.slice(0, -1) : rulePath;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try { return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(pathname); } catch { return pathname.startsWith(pattern); }
}

function isRobotsAllowed(body, targetUrl, userAgent = DEFAULT_USER_AGENT) {
  let pathname = '/';
  try {
    const parsed = new URL(targetUrl);
    pathname = `${parsed.pathname}${parsed.search}`;
  } catch { return false; }
  const normalizedAgent = String(userAgent || '').toLowerCase();
  const groups = parseRobotsGroups(body);
  const named = groups.filter((group) => group.agents.some((agent) => agent !== '*' && normalizedAgent.includes(agent)));
  const selected = named.length ? named : groups.filter((group) => group.agents.includes('*'));
  const matching = selected.flatMap((group) => group.rules)
    .filter((rule) => robotsPathMatches(rule.path, pathname))
    .sort((a, b) => b.path.length - a.path.length || (a.type === 'allow' ? -1 : 1));
  return !matching.length || matching[0].type === 'allow';
}

function createLeadRadarPublicFetcher({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const timeoutMs = REQUEST_TIMEOUT_MS;
  const maxBytes = Math.max(50_000, Math.min(5_000_000, Number(env.LEAD_RADAR_SCRAPER_MAX_BYTES) || MAX_RESPONSE_BYTES));
  const configuredInterval = Number(env.LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS);
  const minIntervalMs = Number.isFinite(configuredInterval)
    ? Math.max(0, Math.min(5_000, configuredInterval))
    : 300;
  const userAgent = text(env.LEAD_RADAR_SCRAPER_USER_AGENT || DEFAULT_USER_AGENT, 300);
  const robotsCache = new Map();
  const lastRequestAt = new Map();

  async function waitForOrigin(origin) {
    const previous = lastRequestAt.get(origin) || 0;
    const remaining = previous + minIntervalMs - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    lastRequestAt.set(origin, Date.now());
  }

  async function rawRequest(url, { accept = 'text/html,application/xml,application/json;q=0.9', maxRedirects = 3 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is niet beschikbaar.');
    let currentUrl = await assertWebsitePreviewUrlIsPublic(url);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const parsed = new URL(currentUrl);
      await waitForOrigin(parsed.origin);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: { Accept: accept, 'User-Agent': userAgent },
          signal: controller?.signal,
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if ([301, 302, 303, 307, 308].includes(Number(response.status))) {
        const location = response.headers?.get?.('location');
        if (!location || redirectCount >= maxRedirects) throw new Error('Publieke bron heeft te veel redirects.');
        currentUrl = await assertWebsitePreviewUrlIsPublic(new URL(location, currentUrl).toString());
        continue;
      }
      const declaredLength = Number(response.headers?.get?.('content-length')) || 0;
      if (declaredLength > maxBytes) throw new Error('Publieke bron is groter dan de toegestane responslimiet.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('Publieke bron overschrijdt de responslimiet.');
      return { response, body: buffer.toString('utf8'), url: currentUrl };
    }
    throw new Error('Publieke bron kon niet veilig worden gevolgd.');
  }

  async function robotsFor(url) {
    const parsed = new URL(url);
    const cached = robotsCache.get(parsed.origin);
    if (cached && cached.expiresAt > Date.now()) return cached.body;
    const robotsUrl = `${parsed.origin}/robots.txt`;
    try {
      const result = await rawRequest(robotsUrl, { accept: 'text/plain,*/*;q=0.1', maxRedirects: 1 });
      const body = result.response.status === 404 ? '' : result.body;
      if (!result.response.ok && result.response.status !== 404) throw new Error(`robots.txt HTTP ${result.response.status}`);
      robotsCache.set(parsed.origin, { body, expiresAt: Date.now() + ROBOTS_CACHE_MS });
      return body;
    } catch (error) {
      logger.warn('[LeadRadar][robots]', parsed.origin, error?.message || error);
      throw new Error(`robots.txt van ${parsed.hostname} kon niet veilig worden gecontroleerd.`);
    }
  }

  async function fetchPublic(url, options = {}) {
    const normalized = await assertWebsitePreviewUrlIsPublic(url);
    if (options.checkRobots !== false) {
      const robots = await robotsFor(normalized);
      if (!isRobotsAllowed(robots, normalized, userAgent)) {
        const error = new Error('robots.txt staat deze bron niet toe voor Lead Radar.');
        error.code = 'LEAD_RADAR_ROBOTS_BLOCKED';
        throw error;
      }
    }
    const result = await rawRequest(normalized, options);
    if (!result.response.ok && !options.allowHttpErrors) throw new Error(`Publieke bron gaf HTTP ${result.response.status}.`);
    return result;
  }

  return { fetchPublic, getConfig: () => ({ timeoutMs, maxBytes, minIntervalMs, userAgent }) };
}

function compactBlueskyTerms(keywordGroups = {}, selectedGroups = []) {
  const groups = selectedGroups.length ? selectedGroups : Object.keys(keywordGroups);
  const preferred = groups.flatMap((group) => keywordGroups[group] || [])
    .filter((term) => /(?:zoek|gezocht|nodig|wie kan|laten maken|laten bouwen|hulp)/i.test(term));
  return [...new Set(preferred)].slice(0, 18);
}

function buildPublicScraperPlan(options = {}) {
  const env = options.env || process.env;
  const requested = Array.isArray(options.platforms) && options.platforms.length
    ? options.platforms.map((value) => text(value, 30).toLowerCase())
    : ['web', 'mastodon', 'bluesky'];
  const platforms = [...new Set(requested.filter((value) => ['web', 'mastodon', 'bluesky'].includes(value)))];
  const feeds = parseUrlList(env.LEAD_RADAR_PUBLIC_FEED_URLS, DEFAULT_PUBLIC_FEEDS);
  const mastodonInstances = parseUrlList(env.LEAD_RADAR_MASTODON_INSTANCES, DEFAULT_MASTODON_INSTANCES)
    .map((value) => value.replace(/\/$/, ''));
  const region = 'Nederland';
  const plan = [];
  if (platforms.includes('web')) {
    feeds.forEach((sourceUrl) => plan.push({
      adapter: 'feed', platform: 'web', region, keywordGroup: 'public_feed', term: 'openbare ondernemersvraag',
      query: sourceUrl, sourceUrl, maxResults: 100,
    }));
  }
  if (platforms.includes('mastodon')) {
    mastodonInstances.forEach((sourceUrl) => plan.push({
      adapter: 'mastodon', platform: 'mastodon', region, keywordGroup: 'public_timeline', term: 'openbare Nederlandse tijdlijn',
      query: `${sourceUrl}/api/v1/timelines/public`, sourceUrl, maxResults: 120,
    }));
  }
  if (platforms.includes('bluesky') && parseBoolean(env.LEAD_RADAR_BLUESKY_ENABLED, false)) {
    compactBlueskyTerms(options.keywordGroups || {}, options.selectedGroups || []).forEach((term) => plan.push({
      adapter: 'bluesky', platform: 'bluesky', region, keywordGroup: 'buyer_intent', term,
      query: term, sourceUrl: BLUESKY_SEARCH_ENDPOINT, maxResults: 25,
    }));
  }
  return plan;
}

function createLeadRadarScraperProvider({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const publicFetcher = createLeadRadarPublicFetcher({ env, fetchImpl, logger });
  const config = {
    feeds: parseUrlList(env.LEAD_RADAR_PUBLIC_FEED_URLS, DEFAULT_PUBLIC_FEEDS),
    mastodonInstances: parseUrlList(env.LEAD_RADAR_MASTODON_INSTANCES, DEFAULT_MASTODON_INSTANCES).map((value) => value.replace(/\/$/, '')),
    blueskyEnabled: parseBoolean(env.LEAD_RADAR_BLUESKY_ENABLED, false),
    mastodonPages: safeLimit(env.LEAD_RADAR_MASTODON_PAGES, 3, 5),
  };

  async function searchFeed(context, maxResults) {
    const result = await publicFetcher.fetchPublic(context.sourceUrl, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9' });
    return parsePublicFeed(result.body, result.url).slice(0, maxResults);
  }

  async function searchMastodon(context, maxResults) {
    const items = [];
    let maxId = '';
    for (let page = 0; page < config.mastodonPages && items.length < maxResults; page += 1) {
      const endpoint = new URL('/api/v1/timelines/public', context.sourceUrl);
      endpoint.searchParams.set('local', 'true');
      endpoint.searchParams.set('limit', '40');
      if (maxId) endpoint.searchParams.set('max_id', maxId);
      const result = await publicFetcher.fetchPublic(endpoint.toString(), { accept: 'application/json' });
      const pageItems = JSON.parse(result.body);
      if (!Array.isArray(pageItems) || !pageItems.length) break;
      for (const item of pageItems) {
        const message = stripHtml(`${item?.spoiler_text || ''} ${item?.content || ''}`, 20_000);
        const profileFields = Array.isArray(item?.account?.fields) ? item.account.fields : [];
        const website = profileFields.map((field) => String(field?.value || '').match(/href=["']([^"']+)["']/i)?.[1]).find(Boolean) || '';
        if (!item?.url || !message) continue;
        items.push({
          platform: 'mastodon', source_type: 'public_api', provider: 'softora_public_scraper',
          url: text(item.url, 2_000), title: text(item?.account?.display_name || item?.account?.acct, 500),
          snippet: message, author_name: text(item?.account?.display_name || item?.account?.acct, 500),
          profile_url: text(item?.account?.url, 2_000), website_url: absoluteUrl(website, item?.account?.url),
          external_id: text(item?.uri || item?.id, 500), published_at: item?.created_at || null,
          retrieved_at: new Date().toISOString(), likes: Number(item?.favourites_count) || 0,
          comments: Number(item?.replies_count) || 0, engagement_known: true,
          source_verified: true, source_post_id: `mastodon:${text(item?.id, 200)}`,
          source_verification_reason: 'Aanvraag rechtstreeks gelezen uit de toegestane openbare Mastodon-API.',
        });
      }
      maxId = text(pageItems.at(-1)?.id, 200);
      if (!maxId) break;
    }
    return items.slice(0, maxResults);
  }

  async function searchBluesky(context, maxResults) {
    const endpoint = new URL(BLUESKY_SEARCH_ENDPOINT);
    endpoint.searchParams.set('q', text(context.term || context.query, 300));
    endpoint.searchParams.set('limit', String(Math.min(100, maxResults)));
    endpoint.searchParams.set('sort', 'latest');
    const result = await publicFetcher.fetchPublic(endpoint.toString(), { accept: 'application/json' });
    const body = JSON.parse(result.body);
    return (Array.isArray(body?.posts) ? body.posts : []).map((post) => {
      const uriParts = String(post?.uri || '').split('/');
      const rkey = uriParts.at(-1) || '';
      const handle = text(post?.author?.handle, 300);
      const url = handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : '';
      return {
        platform: 'bluesky', source_type: 'public_api', provider: 'softora_public_scraper', url,
        title: text(post?.author?.displayName || handle, 500), snippet: text(post?.record?.text, 20_000),
        author_name: text(post?.author?.displayName || handle, 500),
        profile_url: handle ? `https://bsky.app/profile/${encodeURIComponent(handle)}` : '',
        external_id: text(post?.uri || post?.cid, 500), published_at: post?.record?.createdAt || post?.indexedAt || null,
        retrieved_at: new Date().toISOString(), likes: Number(post?.likeCount) || 0,
        comments: Number(post?.replyCount) || 0, engagement_known: true,
        source_verified: true, source_post_id: post?.uri ? `bluesky:${text(post.uri, 450)}` : null,
        source_verification_reason: 'Aanvraag rechtstreeks gelezen uit de openbare Bluesky-AppView API.',
      };
    }).filter((item) => item.url && item.snippet).slice(0, maxResults);
  }

  async function search({ query, maxResults = 25, context = {} } = {}) {
    const normalizedContext = { ...context, query: context.query || query };
    const limit = safeLimit(maxResults, 25, 200);
    if (normalizedContext.adapter === 'feed') return searchFeed(normalizedContext, limit);
    if (normalizedContext.adapter === 'mastodon') return searchMastodon(normalizedContext, limit);
    if (normalizedContext.adapter === 'bluesky') return searchBluesky(normalizedContext, limit);
    const error = new Error('Onbekende openbare scraperadapter.');
    error.code = 'LEAD_RADAR_SOURCE_UNSUPPORTED';
    throw error;
  }

  return {
    name: 'softora_public_scraper',
    configured: Boolean(config.feeds.length || config.mastodonInstances.length || config.blueskyEnabled),
    buildPlan(options = {}) {
      return buildPublicScraperPlan({ ...options, env });
    },
    search,
    getStatus() {
      return {
        configured: Boolean(config.feeds.length || config.mastodonInstances.length || config.blueskyEnabled),
        provider: 'softora_public_scraper',
        paid: false,
        message: 'Eigen Softora-scraper actief; er worden geen betaalde zoek-API’s gebruikt.',
        sources: {
          publicFeeds: config.feeds.length,
          mastodonInstances: config.mastodonInstances.length,
          blueskyEnabled: config.blueskyEnabled,
        },
        fetchPolicy: publicFetcher.getConfig(),
      };
    },
  };
}

module.exports = {
  BLUESKY_SEARCH_ENDPOINT,
  DEFAULT_MASTODON_INSTANCES,
  DEFAULT_PUBLIC_FEEDS,
  buildPublicScraperPlan,
  createLeadRadarPublicFetcher,
  createLeadRadarScraperProvider,
  decodeEntities,
  isRobotsAllowed,
  parsePublicFeed,
  parseUrlList,
  stripHtml,
};

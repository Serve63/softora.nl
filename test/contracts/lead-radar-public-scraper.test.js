'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifySignal } = require('../../server/services/lead-radar');
const {
  BLUESKY_SEARCH_ENDPOINT,
  buildPublicScraperPlan,
  createLeadRadarPublicFetcher,
  createLeadRadarScraperProvider,
  isRobotsAllowed,
  parsePublicFeed,
} = require('../../server/services/lead-radar-public-scraper');

function fetchResponse(body = '', { status = 200, headers = {} } = {}) {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const buffer = Buffer.from(String(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalizedHeaders.get(String(name).toLowerCase()) || null },
    arrayBuffer: async () => buffer,
  };
}

test('Lead Radar leest RSS en Atom rechtstreeks als controleerbaar bronbewijs', () => {
  const items = parsePublicFeed(`<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Websitebouwer gezocht]]></title><link>https://example.com/vraag/1</link>
      <description><![CDATA[Wij zoeken iemand die onze website kan vernieuwen.]]></description>
      <pubDate>Wed, 19 Aug 2026 10:00:00 GMT</pubDate><dc:creator>Studio Noord</dc:creator><guid>vraag-1</guid></item>
  </channel></rss>`, 'https://example.com/feed.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].platform, 'web');
  assert.equal(items[0].provider, 'softora_public_scraper');
  assert.equal(items[0].source_verified, true);
  assert.equal(items[0].author_name, 'Studio Noord');
  assert.match(items[0].snippet, /website kan vernieuwen/i);
});

test('Lead Radar respecteert robots.txt, redirect-SSRF en responslimieten', async () => {
  const robots = `User-agent: *\nDisallow: /private$\nDisallow: /map/*\nAllow: /map/openbaar`;
  assert.equal(isRobotsAllowed(robots, 'https://example.com/private'), false);
  assert.equal(isRobotsAllowed(robots, 'https://example.com/private/vervolg'), true);
  assert.equal(isRobotsAllowed(robots, 'https://example.com/map/geheim'), false);
  assert.equal(isRobotsAllowed(robots, 'https://example.com/map/openbaar'), true);

  const blockedCalls = [];
  const blockedFetcher = createLeadRadarPublicFetcher({
    env: { LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0' },
    fetchImpl: async (url) => {
      blockedCalls.push(String(url));
      return String(url).endsWith('/robots.txt')
        ? fetchResponse('User-agent: *\nDisallow: /afgeschermd')
        : fetchResponse('mag niet worden gelezen');
    },
  });
  await assert.rejects(blockedFetcher.fetchPublic('https://example.com/afgeschermd'), (error) => {
    return error.code === 'LEAD_RADAR_ROBOTS_BLOCKED';
  });
  assert.deepEqual(blockedCalls, ['https://example.com/robots.txt']);

  const redirectFetcher = createLeadRadarPublicFetcher({
    env: { LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0' },
    fetchImpl: async () => fetchResponse('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
  });
  await assert.rejects(
    redirectFetcher.fetchPublic('https://example.com/start', { checkRobots: false }),
    /Private netwerk|niet toegestaan/i
  );

  const oversizedFetcher = createLeadRadarPublicFetcher({
    env: { LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0', LEAD_RADAR_SCRAPER_MAX_BYTES: '50000' },
    fetchImpl: async () => fetchResponse('te groot', { headers: { 'content-length': '50001' } }),
  });
  await assert.rejects(
    oversizedFetcher.fetchPublic('https://example.org/feed', { checkRobots: false }),
    /groter dan de toegestane responslimiet/i
  );
});

test('Lead Radar bouwt een begrensd plan voor openbare bronadapters', () => {
  const plan = buildPublicScraperPlan({
    platforms: ['web', 'mastodon', 'bluesky', 'facebook'],
    keywordGroups: {
      direct_website: [
        'website laten maken', 'websitebouwer gezocht', 'website hulp nodig',
        'nieuwe website nodig', 'wie kan een website bouwen', 'website offerte',
      ],
    },
    selectedGroups: ['direct_website'],
    env: {
      LEAD_RADAR_PUBLIC_FEED_URLS: 'https://example.com/feed.xml,https://example.org/vragen.atom',
      LEAD_RADAR_MASTODON_INSTANCES: 'https://mastodon.nl',
      LEAD_RADAR_BLUESKY_ENABLED: 'true',
    },
  });
  assert.equal(plan.filter((item) => item.adapter === 'feed').length, 2);
  assert.equal(plan.filter((item) => item.adapter === 'mastodon').length, 1);
  assert.ok(plan.filter((item) => item.adapter === 'bluesky').length >= 5);
  assert.ok(plan.filter((item) => item.adapter === 'bluesky').length <= 18);
  assert.ok(plan.every((item) => ['web', 'mastodon', 'bluesky'].includes(item.platform)));
  assert.ok(plan.some((item) => item.sourceUrl === BLUESKY_SEARCH_ENDPOINT));
  assert.ok(plan.every((item) => !String(item.query).includes('site:facebook.com')));
});

test('Lead Radar normaliseert feed-, Mastodon- en Bluesky-resultaten zonder betaalde provider', async () => {
  const calls = [];
  const provider = createLeadRadarScraperProvider({
    env: {
      LEAD_RADAR_PUBLIC_FEED_URLS: 'https://example.com/feed.xml',
      LEAD_RADAR_MASTODON_INSTANCES: 'https://example.org',
      LEAD_RADAR_MASTODON_PAGES: '1',
      LEAD_RADAR_BLUESKY_ENABLED: 'true',
      LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0',
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname === '/robots.txt') return fetchResponse('User-agent: *\nAllow: /');
      if (parsed.hostname === 'example.com') {
        return fetchResponse('<rss><channel><item><title>Website nodig</title><link>https://example.com/vraag/7</link><description>Wij zoeken iemand voor onze website.</description><pubDate>Wed, 19 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>');
      }
      if (parsed.hostname === 'example.org') {
        return fetchResponse(JSON.stringify([{
          id: '42', uri: 'https://example.org/users/studio/statuses/42', url: 'https://example.org/@studio/42',
          created_at: '2026-08-19T11:00:00Z', content: '<p>Wij zoeken iemand die ons CRM kan bouwen.</p>',
          favourites_count: 3, replies_count: 1,
          account: { acct: 'studio', display_name: 'Studio', url: 'https://example.org/@studio', fields: [{ value: '<a href="https://studio.example">Website</a>' }] },
        }]));
      }
      return fetchResponse(JSON.stringify({ posts: [{
        uri: 'at://did:plc:softora/app.bsky.feed.post/abc', cid: 'cid', indexedAt: '2026-08-19T12:00:00Z',
        record: { text: 'Wij zoeken iemand om onze processen te automatiseren.', createdAt: '2026-08-19T12:00:00Z' },
        author: { handle: 'studio.bsky.social', displayName: 'Studio' }, likeCount: 4, replyCount: 2,
      }] }));
    },
  });
  const feed = await provider.search({ context: { adapter: 'feed', sourceUrl: 'https://example.com/feed.xml' } });
  const mastodon = await provider.search({ context: { adapter: 'mastodon', sourceUrl: 'https://example.org' } });
  const bluesky = await provider.search({ query: 'automatisering hulp gezocht', context: { adapter: 'bluesky', term: 'automatisering hulp gezocht' } });
  assert.equal(feed[0].source_type, 'feed');
  assert.equal(mastodon[0].platform, 'mastodon');
  assert.equal(mastodon[0].website_url, 'https://studio.example/');
  assert.equal(bluesky[0].url, 'https://bsky.app/profile/studio.bsky.social/post/abc');
  assert.ok([...feed, ...mastodon, ...bluesky].every((item) => item.source_verified === true));
  assert.equal(provider.getStatus().paid, false);
  assert.equal(provider.getStatus().provider, 'softora_public_scraper');
  assert.ok(calls.some((url) => url.endsWith('/robots.txt')));
});

test('Lead Radar herkent natuurlijke website-, CRM- en AI-hulpvragen als prospects', () => {
  assert.equal(classifySignal({ snippet: 'Kan iemand me helpen bij het bouwen van een website voor ons bedrijf?' }).role, 'prospect');
  assert.equal(classifySignal({ snippet: 'Kan iemand ons helpen een CRM en dashboard te ontwikkelen?' }).role, 'prospect');
  assert.equal(classifySignal({ snippet: 'Wij zijn op zoek naar een partij voor een AI-agent die klantvragen automatiseert.' }).role, 'prospect');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifySignal, isEligibleAutomaticSignal } = require('../../server/services/lead-radar');
const {
  BLUESKY_SEARCH_ENDPOINT,
  DEFAULT_MASTODON_TAGS,
  DEFAULT_PUBLIC_FEEDS,
  buildPublicScraperPlan,
  createLeadRadarPublicFetcher,
  createLeadRadarScraperProvider,
  isRobotsAllowed,
  parsePublicFeed,
  stripHtml,
} = require('../../server/services/lead-radar-public-scraper');
const {
  classifyLeadSourceUrl,
} = require('../../server/services/lead-radar-source-policy');

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
  assert.equal(stripHtml('<p>Welkom<script >alert(1)</script ><br>Ondernemer</p>'), 'Welkom\nOndernemer');
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
      LEAD_RADAR_MASTODON_TAGS: 'website',
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

test('Mastodon gebruikt kleine lokale batches en stopt zodra het scanvenster is bereikt', async () => {
  const calls = [];
  const provider = createLeadRadarScraperProvider({
    env: { LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0' },
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/robots.txt') return fetchResponse('User-agent: *\nAllow: /');
      calls.push(parsed);
      const secondPage = parsed.searchParams.has('max_id');
      return fetchResponse(JSON.stringify([{
        id: secondPage ? '90' : '100', url: `https://example.org/@ondernemer/${secondPage ? '90' : '100'}`,
        content: '<p>Ik zoek iemand die onze website kan bouwen.</p>',
        created_at: new Date(Date.now() - (secondPage ? 40 : 1) * 86_400_000).toISOString(),
        account: { display_name: 'Ondernemer' },
      }]));
    },
  });
  const items = await provider.search({ maxResults: 40, context: { adapter: 'mastodon', sourceUrl: 'https://example.org', term: 'website', maxAgeDays: 31 } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.searchParams.get('local') === 'true' && Number(url.searchParams.get('limit')) <= 10));
  assert.equal(calls[1].searchParams.get('max_id'), '100');
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.source_verified));
});

test('Publieke bron herstelt een tijdelijke timeout met één retry en herhaalt geen toegangsfout', async () => {
  let calls = 0;
  let mode = 'timeout';
  const fetcher = createLeadRadarPublicFetcher({
    env: { LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0' },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/robots.txt') return fetchResponse('User-agent: *\nAllow: /');
      calls += 1;
      if (mode === 'forbidden') return fetchResponse('', { status: 403 });
      if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return fetchResponse('<rss><channel/></rss>');
    },
  });
  const result = await fetcher.fetchPublic('https://example.org/feed');
  assert.equal(result.response.status, 200);
  assert.equal(calls, 2);
  mode = 'forbidden';
  await assert.rejects(fetcher.fetchPublic('https://example.org/feed'), /HTTP 403/);
  assert.equal(calls, 3);
});

test('Kleine Mastodon-batches behouden de limiet van veertig recente berichten', async () => {
  let page = 0;
  const provider = createLeadRadarScraperProvider({
    env: { LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0' },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/robots.txt') return fetchResponse('User-agent: *\nAllow: /');
      page += 1;
      return fetchResponse(JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
        id: String(1000 - page * 10 - index), url: `https://example.org/@ondernemer/${1000 - page * 10 - index}`,
        content: '<p>Website gezocht voor onze winkel.</p>', created_at: new Date().toISOString(),
        account: { display_name: 'Ondernemer' },
      }))));
    },
  });
  const items = await provider.search({ maxResults: 40, context: { adapter: 'mastodon', sourceUrl: 'https://example.org', term: 'website' } });
  assert.equal(page, 4);
  assert.equal(items.length, 40);
  assert.equal(new Set(items.map((item) => item.url)).size, 40);
});

test('Lead Radar scant standaard directe ondernemersbronnen en nooit opdrachtmarktplaatsen', async () => {
  const plan = buildPublicScraperPlan({
    platforms: ['web', 'mastodon', 'bluesky'],
    keywordGroups: { direct_website: ['website hulp gezocht'] },
    selectedGroups: ['direct_website'],
    env: {
      LEAD_RADAR_PUBLIC_FEED_URLS: 'https://freelancer.nl/feed.xml,https://www.hoofdkraan.nl/rss,https://www.higherlevel.nl/rss/2-forum.xml/',
      LEAD_RADAR_PROJECT_INDEX_URLS: 'https://freelancer.nl/opdrachten/development-en-it',
    },
  });
  assert.deepEqual(DEFAULT_PUBLIC_FEEDS, ['https://www.higherlevel.nl/rss/2-forum.xml/']);
  assert.equal(plan.filter((item) => item.adapter === 'feed').length, 1);
  assert.equal(plan.filter((item) => item.adapter === 'mastodon').length, DEFAULT_MASTODON_TAGS.length);
  assert.equal(plan.some((item) => item.adapter === 'project_index'), false);
  assert.equal(plan.some((item) => /freelancer|hoofdkraan/i.test(String(item.sourceUrl))), false);
  assert.equal(plan.some((item) => String(item.sourceUrl).includes('nl.wordpress.org/support')), false);
  assert.equal(plan.some((item) => item.adapter === 'bluesky'), false);
  assert.equal(classifyLeadSourceUrl('https://www.upwork.com/jobs/~123').category, 'project_marketplace');
  assert.equal(classifyLeadSourceUrl('https://www.linkedin.com/jobs/view/123').category, 'recruitment_platform');

  const provider = createLeadRadarScraperProvider({ env: {}, fetchImpl: async () => fetchResponse('') });
  await assert.rejects(
    provider.search({ context: { adapter: 'feed', sourceUrl: 'https://www.fiverr.com/feed.xml' } }),
    (error) => error.code === 'LEAD_RADAR_SOURCE_BLOCKED'
  );
});

test('Lead Radar normaliseert feed-, Mastodon- en Bluesky-resultaten zonder betaalde provider', async () => {
  const calls = [];
  const provider = createLeadRadarScraperProvider({
    env: {
      LEAD_RADAR_PUBLIC_FEED_URLS: 'https://example.com/feed.xml',
      LEAD_RADAR_MASTODON_INSTANCES: 'https://example.org',
      LEAD_RADAR_MASTODON_TAGS: 'website',
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
  const mastodon = await provider.search({ context: { adapter: 'mastodon', sourceUrl: 'https://example.org', term: 'website' } });
  const bluesky = await provider.search({ query: 'automatisering hulp gezocht', context: { adapter: 'bluesky', term: 'automatisering hulp gezocht' } });
  assert.equal(feed[0].source_type, 'feed');
  assert.equal(mastodon[0].platform, 'mastodon');
  assert.equal(mastodon[0].website_url, 'https://studio.example/');
  assert.equal(bluesky[0].url, 'https://bsky.app/profile/studio.bsky.social/post/abc');
  assert.ok([...feed, ...mastodon, ...bluesky].every((item) => item.source_verified === true));
  assert.equal(provider.getStatus().paid, false);
  assert.equal(provider.getStatus().provider, 'softora_public_scraper');
  assert.ok(calls.some((url) => url.endsWith('/robots.txt')));
  assert.ok(calls.some((url) => new URL(url).pathname === '/api/v1/timelines/tag/website'));
});

test('Lead Radar herkent natuurlijke website-, CRM- en AI-hulpvragen als prospects', () => {
  assert.equal(classifySignal({ snippet: 'Kan iemand me helpen bij het bouwen van een website voor ons bedrijf?' }).role, 'prospect');
  assert.equal(classifySignal({ snippet: 'Kan iemand ons helpen een CRM en dashboard te ontwikkelen?' }).role, 'prospect');
  assert.equal(classifySignal({ snippet: 'Wij zijn op zoek naar een partij voor een AI-agent die klantvragen automatiseert.' }).role, 'prospect');
  assert.equal(classifySignal({
    url: 'https://nl.wordpress.org/support/topic/niet-kunnen-inloggen/',
    snippet: 'Sinds de update kan ik niet meer inloggen op mijn dashboard.',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://example.com/blog/inlog-probleem',
    snippet: 'Sinds de update kan ik niet meer inloggen op mijn dashboard.',
  }).role, 'unclear');
  assert.equal(classifySignal({
    url: 'https://freelancer.nl/opdrachten/ai/ai-operator-123',
    snippet: 'I’m looking for a hands-on AI expert to help me build an operator connected to our CRM and business systems.',
  }).role, 'excluded');
  assert.equal(isEligibleAutomaticSignal({
    platform: 'web',
    post_url: 'https://freelancer.nl/opdrachten/ai/ai-operator-123',
    message_text: 'Voor ons bedrijf zoeken wij iemand die een AI-agent kan bouwen.',
    published_at: new Date().toISOString(),
  }, { allowUnknownPublicationDate: false }), false);
  assert.equal(classifySignal({
    url: 'https://freelancer.nl/opdrachten/automation/automation-developer-123',
    snippet: 'Voor een internationale eindklant zoeken wij een Automation Developer voor 40 uur per week om het team te versterken.',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://freelancer.nl/opdrachten/marketing/shopify-cro-123',
    snippet: 'Wij zoeken een Google Ads en CRO-specialist om onze Shopify-webshop verder te laten groeien.',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://www.hoofdkraan.nl/j/rekenprogramma/60962',
    snippet: 'Ik zoek een computerprogrammeur die een programma voor kansberekeningen kan maken.',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://www.higherlevel.nl/forums/topic/123-website-gezocht/',
    snippet: 'Voor mijn nieuwe kapsalon zoek ik iemand die een boekingswebsite kan bouwen.',
  }).role, 'prospect');
  assert.equal(classifySignal({
    url: 'https://www.higherlevel.nl/forums/topic/124-inlogprobleem/',
    snippet: 'Na de WordPress-update werkt mijn login niet meer. Hoe kan ik dit zelf oplossen?',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://www.higherlevel.nl/forums/topic/78648-zoeken-naar-informatie-binnen-een-website/',
    snippet: 'Op onze site staan honderden artikelen. Wij maken gebruik van Sitesearch360 en willen graag van anderen horen welke programma’s zij gebruiken voor het zoeken binnen hun website.',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://mastodon.social/@panwebsites/117151397080898222',
    title: 'Pan Websites',
    snippet: 'Not every business is the same. We build the website around your business goals. #WebDesign',
  }).role, 'provider');
  assert.equal(classifySignal({
    url: 'https://freelancer.nl/opdrachten/voorschoten/ai-development/personal-project-web-app-with-mysql-en-python-d8412b34',
    snippet: 'I’m looking for some guidance in developing an app for personal use. My goal is to write as much of the code myself as possible and learn along the way.',
  }).role, 'excluded');
  assert.equal(classifySignal({
    url: 'https://freelancer.nl/opdrachten/tilburg/app-development/zelf-app-bouwen-123',
    snippet: 'Ik wil zelf leren programmeren en zoek alleen begeleiding en advies om de app zelf te bouwen.',
  }).role, 'excluded');
});

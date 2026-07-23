const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SEARCH_CONSOLE_READONLY_SCOPE,
  buildSearchConsoleAgentReport,
  buildTechnicalOnlyAgentReport,
  createSearchConsoleClient,
  extractSitemapUrls,
  fetchSearchConsoleSnapshot,
  fetchTechnicalSeoSnapshot,
  formatAgentMarkdown,
  getMissingSearchConsoleConfig,
  resolveDateWindows,
} = require('../../scripts/lib/search-console-agent-report');
const {
  getBusinessFit,
  isBrandedQuery,
  rankSeoOpportunities,
} = require('../../scripts/lib/seo-opportunity-scoring');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

test('seo agent report client uses OAuth refresh token and Search Console endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'access-token', expires_in: 3600 });
    }
    if (String(url).includes('/searchAnalytics/query')) {
      return jsonResponse({
        rows: [{ keys: ['oligofructose'], clicks: 3, impressions: 200, ctr: 0.015, position: 8.4 }],
      });
    }
    if (String(url).includes('/sitemaps')) {
      return jsonResponse({ sitemap: [{ path: 'https://www.softora.nl/sitemap.xml', errors: 0, warnings: 0 }] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const client = createSearchConsoleClient({
    fetchImpl,
    config: {
      siteUrl: 'sc-domain:softora.nl',
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
    },
  });

  const rows = await client.querySearchAnalytics({
    startDate: '2026-05-01',
    endDate: '2026-05-18',
    dimensions: ['query'],
  });
  const sitemaps = await client.listSitemaps();

  assert.equal(rows[0].keys[0], 'oligofructose');
  assert.equal(sitemaps[0].path, 'https://www.softora.nl/sitemap.xml');
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.match(calls[1].url, /\/sites\/sc-domain%3Asoftora\.nl\/searchAnalytics\/query$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access-token');
});

test('seo agent snapshot queries current and previous pages, queries, page-query rows and sitemaps', async () => {
  const calls = [];
  const client = {
    querySearchAnalytics: async (query) => {
      calls.push(query);
      return [{ keys: query.dimensions, clicks: 1, impressions: 10, ctr: 0.1, position: 9 }];
    },
    listSitemaps: async () => [{ path: 'https://www.softora.nl/sitemap.xml', errors: 0, warnings: 0 }],
  };

  const snapshot = await fetchSearchConsoleSnapshot({
    client,
    siteUrl: 'sc-domain:softora.nl',
    days: 28,
    now: new Date('2026-05-19T12:00:00Z'),
  });

  assert.equal(snapshot.dateWindows.current.startDate, '2026-04-21');
  assert.equal(snapshot.dateWindows.current.endDate, '2026-05-18');
  assert.equal(snapshot.dateWindows.previous.startDate, '2026-03-24');
  assert.equal(snapshot.dateWindows.previous.endDate, '2026-04-20');
  assert.deepEqual(calls.map((call) => call.dimensions.join(',')), ['', '', 'page', 'page', 'query', 'query', 'page,query']);
  assert.equal(snapshot.totalsCurrent[0].clicks, 1);
});

test('seo agent keeps property totals separate from visible and unclassified query rows', () => {
  const report = buildSearchConsoleAgentReport({
    totalsCurrent: [{ keys: [], clicks: 23, impressions: 1972, ctr: 23 / 1972, position: 49.61 }],
    totalsPrevious: [{ keys: [], clicks: 18, impressions: 1600, ctr: 18 / 1600, position: 51 }],
    queriesCurrent: [
      { keys: ['softora'], clicks: 9, impressions: 17, ctr: 9 / 17, position: 1 },
      { keys: ['bedrijfssoftware laten maken'], clicks: 0, impressions: 1709, ctr: 0, position: 55.49 },
    ],
    queriesPrevious: [],
    pagesCurrent: [],
    pagesPrevious: [],
    pageQueryCurrent: [],
    sitemaps: [],
  });

  assert.equal(report.totals.current.clicks, 23);
  assert.equal(report.totals.current.impressions, 1972);
  assert.equal(report.segments.visibleQueries.clicks, 9);
  assert.equal(report.segments.unclassified.clicks, 14);
  assert.equal(report.segments.unclassified.impressions, 246);
  assert.equal(report.segments.unclassified.position, null);
  assert.match(formatAgentMarkdown(report), /Niet classificeerbaar: 14 klikken, 246 vertoningen/);
});

test('seo agent preserves sitemap download freshness and supports URL Inspection', async () => {
  const calls = [];
  const client = createSearchConsoleClient({
    config: { siteUrl: 'sc-domain:softora.nl', accessToken: 'token' },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } },
      });
    },
  });
  const inspection = await client.inspectUrl('https://www.softora.nl/crm-systeem-op-maat');

  assert.equal(inspection.inspectionResult.indexStatusResult.verdict, 'PASS');
  assert.match(calls[0].url, /urlInspection\/index:inspect$/);
  assert.match(calls[0].options.body, /crm-systeem-op-maat/);
  const normalized = require('../../scripts/lib/search-console-agent-report').normalizeSitemaps([
    { path: 'https://www.softora.nl/sitemap.xml', lastDownloaded: '2026-07-22T08:00:00Z' },
  ]);
  assert.equal(normalized[0].lastDownloaded, '2026-07-22T08:00:00Z');
});

test('seo agent report ranks low CTR, striking distance and declining page actions', () => {
  const report = buildSearchConsoleAgentReport({
    generatedAt: '2026-05-19T13:00:00.000Z',
    siteUrl: 'sc-domain:softora.nl',
    dateWindows: resolveDateWindows({ now: new Date('2026-05-19T12:00:00Z') }),
    queriesCurrent: [
      { keys: ['website laten maken'], clicks: 1, impressions: 200, ctr: 0.005, position: 7 },
      { keys: ['ai telefonist'], clicks: 8, impressions: 120, ctr: 0.0667, position: 11 },
    ],
    queriesPrevious: [
      { keys: ['website laten maken'], clicks: 4, impressions: 120, ctr: 0.033, position: 6 },
      { keys: ['ai telefonist'], clicks: 3, impressions: 40, ctr: 0.075, position: 13 },
    ],
    pagesCurrent: [
      { keys: ['https://www.softora.nl/'], clicks: 2, impressions: 70, ctr: 0.0285, position: 14 },
    ],
    pagesPrevious: [
      { keys: ['https://www.softora.nl/'], clicks: 8, impressions: 130, ctr: 0.0615, position: 10 },
    ],
    pageQueryCurrent: [
      {
        keys: ['https://www.softora.nl/website-laten-maken', 'website laten maken'],
        clicks: 1,
        impressions: 200,
        ctr: 0.005,
        position: 7,
      },
    ],
    sitemaps: [{ path: 'https://www.softora.nl/sitemap.xml', errors: 0, warnings: 0 }],
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.totals.current.clicks, 9);
  assert.equal(report.totals.clicksDelta, 2);
  assert.equal(report.queries.lowCtr[0].query, 'website laten maken');
  assert.equal(report.queries.lowCtr[0].page, 'https://www.softora.nl/website-laten-maken');
  assert.equal(report.queries.strikingDistance[0].query, 'website laten maken');
  assert.equal(report.pages.declining[0].page, 'https://www.softora.nl/');
  assert.match(formatAgentMarkdown(report), /Lage CTR kansen/);
});

test('seo agent prioritizes non-branded buyer intent and includes zero CTR opportunities once', () => {
  const report = buildSearchConsoleAgentReport({
    queriesCurrent: [
      { keys: ['softora'], clicks: 10, impressions: 100, ctr: 0.1, position: 1 },
      { keys: ['crm op maat'], clicks: 0, impressions: 80, ctr: 0, position: 8 },
      { keys: ['algemene uitleg'], clicks: 0, impressions: 200, ctr: 0, position: 8 },
    ],
    queriesPrevious: [],
    pagesCurrent: [],
    pagesPrevious: [],
    pageQueryCurrent: [
      {
        keys: ['https://www.softora.nl/crm-op-maat', 'crm op maat'],
        clicks: 0,
        impressions: 80,
        ctr: 0,
        position: 8,
      },
    ],
    sitemaps: [],
  });

  assert.equal(report.queries.lowCtr[0].query, 'algemene uitleg');
  assert.equal(report.queries.prioritized[0].query, 'crm op maat');
  assert.equal(report.queries.prioritized[0].businessFit, 5);
  assert.deepEqual(report.queries.prioritized[0].types, ['low_ctr', 'striking_distance']);
  assert.equal(report.segments.branded.clicks, 10);
  assert.equal(report.segments.nonBranded.impressions, 280);
  assert.equal(
    report.actionQueue.filter((item) => item.query === 'crm op maat').length,
    1
  );
  assert.match(formatAgentMarkdown(report), /Geprioriteerde kansen/);
  assert.match(formatAgentMarkdown(report), /Non-branded: 0 klikken, 280 vertoningen/);
});

test('seo opportunity scoring exposes deterministic business-fit inputs', () => {
  assert.equal(isBrandedQuery('Softora Oisterwijk'), true);
  assert.equal(getBusinessFit('crm op maat laten maken'), 5);
  assert.equal(getBusinessFit('software uitleg'), 3);

  const ranked = rankSeoOpportunities([
    { type: 'low_ctr', query: 'algemene uitleg', impressions: 200, ctr: 0, position: 8 },
    { type: 'low_ctr', query: 'crm op maat', impressions: 80, ctr: 0, position: 8 },
  ]);
  assert.equal(ranked[0].query, 'crm op maat');
  assert.ok(ranked[0].opportunityScore > ranked[1].opportunityScore);
});

test('seo agent keeps high-intent position 20-40 queries as lower-leverage emerging opportunities', () => {
  const report = buildSearchConsoleAgentReport({
    queriesCurrent: [
      { keys: ['bedrijfssoftware laten maken'], clicks: 0, impressions: 130, ctr: 0, position: 29 },
      { keys: ['breed informatief onderwerp'], clicks: 0, impressions: 400, ctr: 0, position: 29 },
      { keys: ['crm op maat'], clicks: 0, impressions: 200, ctr: 0, position: 55 },
    ],
    queriesPrevious: [],
    pagesCurrent: [],
    pagesPrevious: [],
    pageQueryCurrent: [],
    sitemaps: [],
  });

  assert.deepEqual(report.queries.emerging.map((item) => item.query), ['bedrijfssoftware laten maken']);
  assert.equal(report.queries.prioritized[0].types[0], 'emerging');
  assert.equal(report.actionQueue[0].type, 'strengthen_page');
  assert.equal(report.actionQueue.some((item) => item.query === 'crm op maat'), false);
});

test('seo agent technical report works without GSC secrets and keeps output local-only', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/sitemap.xml')) {
      return jsonResponse(
        '<?xml version="1.0"?><urlset><url><loc>https://www.softora.nl/</loc></url><url><loc>https://www.softora.nl/premium-websites</loc></url></urlset>'
      );
    }
    if (String(url).endsWith('/robots.txt')) {
      return jsonResponse('User-agent: *\nAllow: /\nSitemap: https://www.softora.nl/sitemap.xml\n');
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const technical = await fetchTechnicalSeoSnapshot({
    siteOrigin: 'https://www.softora.nl',
    fetchImpl,
  });
  const report = buildTechnicalOnlyAgentReport(
    { technical },
    { config: { siteUrl: 'sc-domain:softora.nl' } }
  );

  assert.deepEqual(extractSitemapUrls('<loc>https://www.softora.nl/</loc>'), ['https://www.softora.nl/']);
  assert.equal(technical.sitemap.urlCount, 2);
  assert.equal(technical.robots.hasSitemapDirective, true);
  assert.equal(report.status, 'technical-only');
  assert.equal(report.requiredScope, SEARCH_CONSOLE_READONLY_SCOPE);
  assert.deepEqual(getMissingSearchConsoleConfig({}), ['GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'GSC_REFRESH_TOKEN']);
  assert.match(report.actionQueue[0].action, /Search Console OAuth/);
});

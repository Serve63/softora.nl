const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoReadCoordinator } = require('../../server/services/seo-read');

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createSeoReadFixture(overrides = {}) {
  const htmlByFile = new Map(
    Object.entries(
      overrides.htmlByFile || {
        'premium-website.html': '<html><head><title>Softora Website</title></head><body></body></html>',
        'premium-blog.html': '<html><head><title>Softora Blog</title></head><body></body></html>',
      }
    )
  );

  return createSeoReadCoordinator({
    logger: {
      error: () => {},
    },
    getSeoConfigCached: async () =>
      overrides.config || {
        pages: {
          'premium-website.html': {
            title: 'Softora | Website',
            metaDescription: 'Website beschrijving',
          },
        },
        images: {
          'premium-website.html': {
            '/hero.png': 'Hero alt',
          },
        },
        automation: {
          preferredModel: 'gpt-5.1',
        },
      },
    normalizeSeoConfig: (value) => ({
      version: 2,
      pages: {},
      images: {},
      automation: {},
      ...(value || {}),
    }),
    getSeoEditableHtmlFiles: () => overrides.files || ['premium-website.html', 'premium-blog.html'],
    readHtmlPageContent: async (fileName) => htmlByFile.get(fileName) || '',
    extractSeoSourceFromHtml: (html) => ({
      title: /<title>(.*?)<\/title>/i.exec(html)?.[1] || '',
      metaDescription: html.includes('Blog') ? 'Blog bron' : 'Bron beschrijving',
    }),
    normalizeSeoStoredPageOverrides: (value) => ({ ...(value || {}) }),
    normalizeSeoStoredImageOverrides: (value) => ({ ...(value || {}) }),
    mergeSeoSourceWithOverrides: (source, overridesValue) => ({
      ...source,
      ...(overridesValue || {}),
    }),
    extractImageEntriesFromHtml: (html) =>
      html.includes('Website')
        ? [{ src: '/hero.png', alt: '' }, { src: '/team.png', alt: 'Team' }]
        : [{ src: '/blog-cover.png', alt: '' }],
    normalizeString: (value) => String(value || '').trim(),
    resolveSeoPageFileFromRequest: (file, slug) => {
      const fileName = String(file || '').trim();
      if (fileName === 'premium-website.html' || fileName === 'premium-blog.html') return fileName;
      const slugValue = String(slug || '').trim();
      if (slugValue === 'premium-website') return 'premium-website.html';
      if (slugValue === 'premium-blog') return 'premium-blog.html';
      return '';
    },
    buildSeoPageAuditEntry: (fileName, sourceSeo, pageOverrides, effectiveSeo, images) => ({
      file: fileName,
      path: `/${String(fileName).replace(/\.html$/i, '')}`,
      title: effectiveSeo.title || sourceSeo.title || fileName,
      score: fileName === 'premium-website.html' ? 92 : 64,
      imageCount: images.length,
      missingAltCount: images.filter((image) => !image.effectiveAlt).length,
      health: {
        titleHealthy: true,
        descriptionHealthy: fileName === 'premium-website.html',
        canonicalHealthy: true,
        ogTitleHealthy: true,
        ogDescriptionHealthy: true,
        twitterTitleHealthy: true,
        twitterDescriptionHealthy: fileName === 'premium-website.html',
      },
      pageOverrideCount: Object.keys(pageOverrides || {}).length,
      suggestedPageOverrides: {},
      suggestedImageOverrides: {},
    }),
    getSeoModelPresetOptions: () => [{ value: 'gpt-5.1', label: 'GPT-5.1' }],
    normalizeSeoAutomationSettings: (value) => ({
      preferredModel: 'gpt-5.1',
      ...(value || {}),
    }),
  });
}

test('seo read coordinator builds a stable site audit summary', async () => {
  const coordinator = createSeoReadFixture();

  const audit = await coordinator.buildSeoSiteAudit();

  assert.equal(audit.ok, true);
  assert.equal(audit.totals.pages, 2);
  assert.equal(audit.totals.images, 3);
  assert.equal(audit.overallScore, 78);
  assert.ok(Array.isArray(audit.metrics));
  assert.ok(Array.isArray(audit.pages));
  assert.equal(audit.pages[0].file, 'premium-blog.html');
});

test('seo read coordinator lists pages and filters by query', async () => {
  const coordinator = createSeoReadFixture();
  const req = { query: { q: 'blog' } };
  const res = createResponseRecorder();

  await coordinator.listSeoPagesResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.pages[0].file, 'premium-blog.html');
});

test('seo read coordinator returns 400 for unknown page requests and 404 for unreadable files', async () => {
  const coordinator = createSeoReadFixture({
    htmlByFile: {
      'premium-website.html': '<html><head><title>Softora Website</title></head></html>',
    },
  });

  const invalidReq = { query: { file: 'unknown.html' } };
  const invalidRes = createResponseRecorder();
  await coordinator.getSeoPageResponse(invalidReq, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'Ongeldig of onbekend HTML-bestand.');

  const missingReq = { query: { file: 'premium-blog.html' } };
  const missingRes = createResponseRecorder();
  await coordinator.getSeoPageResponse(missingReq, missingRes);
  assert.equal(missingRes.statusCode, 404);
  assert.equal(missingRes.body.error, 'Pagina niet gevonden of onleesbaar.');
});

test('seo read coordinator returns page detail payload with effective image alts', async () => {
  const coordinator = createSeoReadFixture();
  const req = { query: { slug: 'premium-website' } };
  const res = createResponseRecorder();

  await coordinator.getSeoPageResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.file, 'premium-website.html');
  assert.equal(res.body.slug, 'premium-website');
  assert.equal(res.body.images[0].effectiveAlt, 'Hero alt');
  assert.equal(res.body.images[1].effectiveAlt, 'Team');
});

test('seo read coordinator wraps site audit failures in a stable 500 response', async () => {
  const coordinator = createSeoReadCoordinator({
    logger: {
      error: () => {},
    },
    getSeoConfigCached: async () => {
      throw new Error('boom');
    },
    normalizeSeoConfig: (value) => value || {},
    getSeoEditableHtmlFiles: () => [],
    readHtmlPageContent: async () => '',
    extractSeoSourceFromHtml: () => ({}),
    normalizeSeoStoredPageOverrides: () => ({}),
    normalizeSeoStoredImageOverrides: () => ({}),
    mergeSeoSourceWithOverrides: (source) => source,
    extractImageEntriesFromHtml: () => [],
    normalizeString: (value) => String(value || '').trim(),
    resolveSeoPageFileFromRequest: () => '',
    buildSeoPageAuditEntry: () => ({}),
    getSeoModelPresetOptions: () => [],
    normalizeSeoAutomationSettings: (value) => value || {},
  });
  const res = createResponseRecorder();

  await coordinator.getSeoSiteAuditResponse({}, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Kon de volledige SEO-scan niet uitvoeren.');
});

test('seo read coordinator returns Search Console performance rows for the premium dashboard', async () => {
  const dateWindows = {
    current: { startDate: '2026-04-21', endDate: '2026-05-18' },
    previous: { startDate: '2026-03-24', endDate: '2026-04-20' },
  };
  const clientCalls = [];
  const coordinator = createSeoReadCoordinator({
    logger: { error: () => {} },
    getSearchConsoleConfigFromEnv: () => ({
      siteUrl: 'sc-domain:softora.nl',
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
    }),
    getMissingSearchConsoleConfig: () => [],
    resolveDateWindows: (options) => {
      assert.equal(options.days, 28);
      return dateWindows;
    },
    createSearchConsoleClient: () => ({
      resolveAccessToken: async () => 'access-token',
      querySearchAnalytics: async (query) => {
        clientCalls.push(query.dimensions.join(','));
        if (query.dimensions.join(',') === 'date') {
          return [
            { keys: ['2026-05-17'], clicks: 2, impressions: 80, ctr: 0.025, position: 12 },
            { keys: ['2026-05-18'], clicks: 4, impressions: 120, ctr: 0.0333, position: 10 },
          ];
        }
        if (query.dimensions.join(',') === 'country') {
          return [{ keys: ['nld'], clicks: 6, impressions: 200, ctr: 0.03, position: 11 }];
        }
        if (query.dimensions.join(',') === 'device') {
          return [{ keys: ['DESKTOP'], clicks: 5, impressions: 160, ctr: 0.0312, position: 9.5 }];
        }
        if (query.dimensions.join(',') === 'searchAppearance') {
          return [{ keys: ['Web Light results'], clicks: 1, impressions: 40, ctr: 0.025, position: 14 }];
        }
        return [];
      },
    }),
    fetchSearchConsoleSnapshot: async (options) => {
      assert.equal(options.days, 28);
      return { generatedAt: '2026-05-20T08:00:00.000Z', siteUrl: 'sc-domain:softora.nl', dateWindows };
    },
    buildSearchConsoleAgentReport: () => ({
      generatedAt: '2026-05-20T08:00:00.000Z',
      siteUrl: 'sc-domain:softora.nl',
      dateWindows,
      totals: {
        current: { clicks: 6, impressions: 200, ctr: 0.03, position: 11 },
        previous: { clicks: 2, impressions: 100, ctr: 0.02, position: 14 },
        clicksDelta: 4,
        impressionsDelta: 100,
        ctrDelta: 0.01,
        positionDelta: -3,
      },
      queries: {
        top: [{ keys: ['website laten maken'], clicks: 4, impressions: 120, ctr: 0.0333, position: 10 }],
      },
      pages: {
        top: [{ keys: ['https://www.softora.nl/website-laten-maken'], clicks: 5, impressions: 150, ctr: 0.0333, position: 9 }],
      },
      sitemaps: [{ path: 'https://www.softora.nl/sitemap.xml', errors: 0, warnings: 0 }],
      actionQueue: [{ priority: 'hoog', action: 'Verbeter CTR.' }],
    }),
  });
  const res = createResponseRecorder();

  await coordinator.getSearchConsolePerformanceResponse({ query: { days: '28' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.connected, true);
  assert.equal(res.body.totals.current.clicks, 6);
  assert.equal(res.body.rows.queries[0].label, 'website laten maken');
  assert.equal(res.body.rows.pages[0].label, 'https://www.softora.nl/website-laten-maken');
  assert.equal(res.body.rows.dates[1].label, '2026-05-18');
  assert.equal(res.body.rows.countries[0].label, 'nld');
  assert.deepEqual(clientCalls, ['date', 'country', 'device', 'searchAppearance']);
});

test('seo read coordinator reports a clean setup state when Search Console credentials are missing', async () => {
  const coordinator = createSeoReadCoordinator({
    logger: { error: () => {} },
    getSearchConsoleConfigFromEnv: () => ({ siteUrl: 'sc-domain:softora.nl' }),
    getMissingSearchConsoleConfig: () => ['GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'GSC_REFRESH_TOKEN'],
  });
  const res = createResponseRecorder();

  await coordinator.getSearchConsolePerformanceResponse({ query: { days: '90' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.connected, false);
  assert.equal(res.body.status, 'needs_connection');
  assert.match(res.body.message, /GSC_CLIENT_ID/);
  assert.equal(res.body.rows.queries.length, 0);
});

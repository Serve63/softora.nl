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

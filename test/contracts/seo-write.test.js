const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoWriteCoordinator } = require('../../server/services/seo-write');

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

function createSeoWriteFixture(overrides = {}) {
  const persisted = [];
  const activities = [];
  const auditCalls = [];
  const loggerCalls = [];
  const baseConfig = {
    version: 2,
    pages: {},
    images: {},
    automation: {
      preferredModel: 'gpt-5.1',
      blogCadence: 'weekly',
      blogAutomationEnabled: false,
    },
    ...(overrides.baseConfig || {}),
  };

  const seoReadCoordinator = {
    async buildSeoSiteAudit(config) {
      auditCalls.push(config);
      return (
        overrides.auditResult || {
          ok: true,
          overallScore: 81,
          pages: [],
          modelOptions: [{ value: 'gpt-5.1', label: 'GPT-5.1' }],
          automation: config?.automation || baseConfig.automation,
        }
      );
    },
  };

  const coordinator = createSeoWriteCoordinator({
    logger: {
      error: (...args) => loggerCalls.push(args),
    },
    resolveSeoPageFileFromRequest: (file, slug) => {
      const direct = String(file || '').trim();
      if (direct === 'premium-website.html') return direct;
      return String(slug || '').trim() === 'premium-website' ? 'premium-website.html' : '';
    },
    normalizeSeoPageOverridePatch: (value) => ({ ...(value || {}) }),
    normalizeSeoImageOverridePatch: (value) => ({ ...(value || {}) }),
    getSeoConfigCached: async () => baseConfig,
    normalizeSeoConfig: (value) => JSON.parse(JSON.stringify(value || {})),
    seoPageFieldDefs: [
      { key: 'title' },
      { key: 'metaDescription' },
      { key: 'canonical' },
      { key: 'robots' },
      { key: 'h1' },
    ],
    normalizeString: (value) => String(value || '').trim(),
    persistSeoConfig: async (config, meta) => {
      persisted.push({ config, meta });
      return overrides.persistResult === null ? null : config;
    },
    appendDashboardActivity: (payload, reason) => activities.push({ payload, reason }),
    normalizeSeoModelPreset: (value) => String(value || '').trim() || 'gpt-5.1',
    applySeoAuditSuggestionsToConfig:
      overrides.applySeoAuditSuggestionsToConfig ||
      ((config, audit, preferredModel) => ({
        nextConfig: {
          ...config,
          automation: {
            ...(config.automation || {}),
            preferredModel,
          },
        },
        changedPages: [],
        appliedPageFieldCount: 0,
        appliedImageAltCount: 0,
        preferredModel,
        audit,
      })),
    seoReadCoordinator,
    normalizeSeoAutomationSettings: (value) => ({
      preferredModel: 'gpt-5.1',
      blogAutomationEnabled: false,
      blogCadence: 'weekly',
      blogModel: 'gpt-5.1',
      blogAutoImages: true,
      searchConsoleConnected: false,
      analyticsConnected: false,
      ...(value || {}),
    }),
    getSeoModelPresetOptions: () => [{ value: 'gpt-5.1', label: 'GPT-5.1' }],
  });

  return {
    activities,
    auditCalls,
    coordinator,
    loggerCalls,
    persisted,
  };
}

test('seo write coordinator rejects unknown page files', async () => {
  const { coordinator } = createSeoWriteFixture();
  const req = { body: { file: 'unknown.html' } };
  const res = createResponseRecorder();

  await coordinator.saveSeoPageResponse(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Ongeldig of onbekend HTML-bestand.');
});

test('seo write coordinator saves page overrides and emits dashboard activity', async () => {
  const { activities, coordinator, persisted } = createSeoWriteFixture({
    baseConfig: {
      version: 2,
      pages: {
        'premium-website.html': {
          title: 'Oud',
        },
      },
      images: {},
      automation: {
        preferredModel: 'gpt-5.1',
      },
    },
  });
  const req = {
    body: {
      file: 'premium-website.html',
      actor: 'dashboard-user',
      pageOverrides: {
        title: 'Nieuw',
        canonical: 'https://softora.nl/premium-website',
      },
      imageAltOverrides: {
        '/hero.png': 'Hero afbeelding',
      },
    },
  };
  const res = createResponseRecorder();

  await coordinator.saveSeoPageResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.file, 'premium-website.html');
  assert.equal(res.body.saved.pageOverrideCount, 2);
  assert.equal(res.body.saved.imageOverrideCount, 1);
  assert.equal(persisted.length, 1);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].reason, 'dashboard_activity_seo_updated');
});

test('seo write coordinator site optimize returns no-op response when no pages change', async () => {
  const { auditCalls, coordinator, persisted } = createSeoWriteFixture();
  const req = {
    body: {
      preferredModel: 'gpt-5.1',
      actor: 'site-optimize',
    },
  };
  const res = createResponseRecorder();

  await coordinator.siteOptimizeResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.changedPages, []);
  assert.equal(res.body.message, 'Er waren geen extra SEO-aanpassingen nodig.');
  assert.equal(auditCalls.length >= 2, true);
  assert.equal(persisted.length, 0);
});

test('seo write coordinator site optimize persists changed pages and reports counts', async () => {
  const { activities, coordinator, persisted } = createSeoWriteFixture({
    applySeoAuditSuggestionsToConfig: (config, audit, preferredModel) => ({
      nextConfig: {
        ...config,
        pages: {
          ...(config.pages || {}),
          'premium-website.html': {
            title: 'Verbeterd',
          },
        },
        automation: {
          ...(config.automation || {}),
          preferredModel,
        },
      },
      changedPages: [{ file: 'premium-website.html' }],
      appliedPageFieldCount: 1,
      appliedImageAltCount: 0,
      preferredModel,
      audit,
    }),
  });
  const req = {
    body: {
      preferredModel: 'gpt-5.1',
      actor: 'site-optimize',
    },
  };
  const res = createResponseRecorder();

  await coordinator.siteOptimizeResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.changedPages.length, 1);
  assert.equal(res.body.appliedPageFieldCount, 1);
  assert.equal(res.body.message, "1 pagina's automatisch bijgewerkt.");
  assert.equal(persisted.length, 1);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].reason, 'dashboard_activity_seo_site_optimized');
});

test('seo write coordinator saves automation settings and returns model options', async () => {
  const { activities, coordinator, persisted } = createSeoWriteFixture();
  const req = {
    body: {
      actor: 'automation-user',
      preferredModel: 'gpt-5.1',
      blogAutomationEnabled: true,
      blogCadence: 'daily',
    },
  };
  const res = createResponseRecorder();

  await coordinator.saveSeoAutomationResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.automation.blogAutomationEnabled, true);
  assert.equal(res.body.automation.blogCadence, 'daily');
  assert.ok(Array.isArray(res.body.modelOptions));
  assert.equal(persisted.length, 1);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].reason, 'dashboard_activity_seo_automation_updated');
});

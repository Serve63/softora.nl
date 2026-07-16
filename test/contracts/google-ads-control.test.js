const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONVERSION_LEDGER_KEY,
  GOOGLE_ADS_SCOPE,
  MACHINE_STATE_KEY,
  createGoogleAdsControlService,
  sanitizeAttribution,
} = require('../../server/services/google-ads-control');
const { registerGoogleAdsRoutes } = require('../../server/routes/google-ads');
const {
  CAMPAIGN_LAUNCH_PACKS,
  FINAL_URL_SUFFIX,
  SHARED_ASSETS,
  buildGoogleAdsLaunchPack,
  buildGoogleAdsEditorAssetsCsv,
  validateCampaign,
} = require('../../server/services/google-ads-launch-pack');

test('Google Ads control blijft fail-closed en bouwt uitsluitend gepauzeerde Search-concepten', async () => {
  const state = {};
  const writes = [];
  const service = createGoogleAdsControlService({
    env: {},
    now: () => new Date('2026-07-16T21:30:00.000Z'),
    getUiStateValues: async () => state,
    setUiStateValues: async (scope, patch) => {
      assert.equal(scope, GOOGLE_ADS_SCOPE);
      writes.push(patch);
      Object.assign(state, patch);
    },
  });

  const status = await service.getStatus();
  assert.equal(status.mode, 'dry-run');
  assert.equal(status.spendEnabled, false);
  assert.equal(status.externalMutationsEnabled, false);
  assert.equal(status.approvedBudgetCents, 0);
  assert.equal(status.liveCampaigns, 0);
  assert.equal(status.spendCents, 0);

  const blueprint = service.getBlueprint();
  assert.equal(blueprint.campaigns.length, 3);
  assert.equal(blueprint.campaigns.every((campaign) => campaign.status === 'draft-paused'), true);
  assert.equal(blueprint.network, 'Google Search only; Display-partners uit in het concept.');
  assert.ok(blueprint.sharedNegativeKeywords.includes('gratis'));
  assert.equal(service.getLaunchPack().validation.valid, true);

  const result = await service.runDryRun();
  assert.equal(result.spendCents, 0);
  assert.equal(result.mutationsPerformed, 0);
  assert.match(result.selectedAction, /Google Ads-account gekoppeld/);
  assert.deepEqual(writes.at(-1)[MACHINE_STATE_KEY].lastRun, result);
});

test('first-party conversieledger bewaart click ids, dedupliceert en bewaart geen browseridentiteit', async () => {
  const state = {};
  const service = createGoogleAdsControlService({
    env: {},
    now: () => new Date('2026-07-16T21:31:00.000Z'),
    getUiStateValues: async () => state,
    setUiStateValues: async (_scope, patch) => Object.assign(state, patch),
  });
  const payload = {
    id: 'event-1', name: 'public-whatsapp-link', page: '/ai-telefonist', target: 'whatsapp',
    landing: '/ai-telefonist?gclid=click-1', path: '/ai-telefonist', gclid: 'click-1',
    gbraid: 'braid-1', wbraid: 'wbraid-1', utmSource: 'google', at: '2026-07-16T21:30:59Z',
    ip: 'must-not-be-stored', userAgent: 'must-not-be-stored',
  };

  await service.recordConversion(payload);
  await service.recordConversion(payload);
  assert.equal(state[CONVERSION_LEDGER_KEY].length, 1);
  assert.equal(state[CONVERSION_LEDGER_KEY][0].gclid, 'click-1');
  assert.equal('ip' in state[CONVERSION_LEDGER_KEY][0], false);
  assert.equal('userAgent' in state[CONVERSION_LEDGER_KEY][0], false);
  assert.equal((await service.getStatus()).conversionCount, 1);
});

test('conversiesanitizer weigert onvolledige en niet-WhatsApp events', () => {
  assert.equal(sanitizeAttribution({ id: '1', name: 'x', page: '/', target: 'email' }), null);
  assert.equal(sanitizeAttribution({ name: 'x', page: '/', target: 'whatsapp' }), null);
});

test('publieke tagconfig blijft uit zonder volledige toestemming en lekt nooit OAuth-secrets', () => {
  const disabled = createGoogleAdsControlService({
    env: {
      GOOGLE_ADS_CONVERSION_ID: 'AW-123456789',
      GOOGLE_ADS_CONVERSION_LABEL: 'contact-label',
      GOOGLE_ADS_CLIENT_SECRET: 'never-public',
    },
  }).getPublicConfig();
  assert.deepEqual(disabled, {
    enabled: false,
    consentMode: 'basic-v2',
    tagId: '',
    conversionLabel: '',
  });

  const enabled = createGoogleAdsControlService({
    env: {
      GOOGLE_ADS_CONVERSION_ID: 'AW-123456789',
      GOOGLE_ADS_CONVERSION_LABEL: 'contact-label',
      GOOGLE_ADS_CONSENT_MODE_CONFIGURED: 'true',
      GOOGLE_ADS_DEVELOPER_TOKEN: 'never-public',
      GOOGLE_ADS_CLIENT_SECRET: 'never-public',
      GOOGLE_ADS_REFRESH_TOKEN: 'never-public',
    },
  }).getPublicConfig();
  assert.deepEqual(enabled, {
    enabled: true,
    consentMode: 'basic-v2',
    tagId: 'AW-123456789',
    conversionLabel: 'contact-label',
  });
  assert.equal(JSON.stringify(enabled).includes('never-public'), false);

  const malformed = createGoogleAdsControlService({
    env: {
      GOOGLE_ADS_CONVERSION_ID: 'not-an-aw-id',
      GOOGLE_ADS_CONVERSION_LABEL: 'contact-label',
      GOOGLE_ADS_CONSENT_MODE_CONFIGURED: 'true',
    },
  }).getPublicConfig();
  assert.equal(malformed.enabled, false);
  assert.equal(malformed.tagId, '');
});

test('Google Ads routes beschermen dashboard en bieden bewust geen activatie- of budgetendpoint', () => {
  const routes = [];
  const app = {
    get(path, ...handlers) { routes.push(['GET', path, handlers]); },
    post(path, ...handlers) { routes.push(['POST', path, handlers]); },
  };
  const requireAdmin = (_req, _res, next) => next();
  registerGoogleAdsRoutes(app, {
    cronSecret: 'cron-secret',
    requirePremiumAdminApiAccess: requireAdmin,
    service: { getStatus() {}, getBlueprint() {}, getLaunchPack() {}, getEditorAssetsCsv() {}, getPublicConfig() {}, runDryRun() {}, recordConversion() {} },
  });

  const paths = routes.map(([method, path]) => `${method} ${path}`);
  assert.deepEqual(paths, [
    'POST /api/public-conversion',
    'GET /api/google-ads/public-config',
    'GET /api/google-ads/daily-run',
    'GET /api/google-ads/status',
    'GET /api/google-ads/blueprint',
    'GET /api/google-ads/launch-pack',
    'GET /api/google-ads/editor-assets.csv',
    'POST /api/google-ads/dry-run',
  ]);
  assert.equal(routes.find((route) => route[1] === '/api/google-ads/status')[2][0], requireAdmin);
  assert.notEqual(routes.find((route) => route[1] === '/api/google-ads/public-config')[2][0], requireAdmin);
  assert.equal(paths.some((path) => /activate|budget|mutate|campaign/.test(path)), false);
});

test('launch-pack is import-ready, deterministic en blijft binnen Google Ads assetlimieten', () => {
  const pack = buildGoogleAdsLaunchPack();
  assert.equal(pack.validation.valid, true);
  assert.equal(pack.accountDefaults.dailyBudgetCents, 0);
  assert.equal(pack.tracking.finalUrlSuffix, FINAL_URL_SUFFIX);
  assert.equal(pack.campaigns.length, 3);
  assert.equal(pack.landingPages.every((page) => page.ready), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.status === 'draft-paused'), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.advertisingChannelType === 'SEARCH'), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.networks.searchPartners === false), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.networks.display === false), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.headlines.length >= 10), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.headlines.every((value) => value.length <= 30)), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.descriptions.length === 4), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.descriptions.every((value) => value.length <= 90)), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.keywords.every((keyword) => ['EXACT', 'PHRASE'].includes(keyword.matchType))), true);
  assert.equal(SHARED_ASSETS.callouts.every((value) => value.length <= 25), true);
  assert.equal(SHARED_ASSETS.sitelinks.length, 4);
});

test('launch-pack validator blokkeert brede keywords, actieve campagnes en te lange RSA-copy', () => {
  const unsafe = {
    ...CAMPAIGN_LAUNCH_PACKS[0],
    status: 'enabled',
    headlines: ['x'.repeat(31), ...CAMPAIGN_LAUNCH_PACKS[0].headlines.slice(1)],
    keywords: [{ text: 'software', matchType: 'BROAD' }],
  };
  const codes = validateCampaign(unsafe).map((error) => error.code);
  assert.ok(codes.includes('campaign_not_paused'));
  assert.ok(codes.includes('headline_too_long'));
  assert.ok(codes.includes('unsafe_match_type'));
});

test('Google Ads Editor CSV bevat alleen gepauzeerde assets, Engelse headers en geen budgetactie', () => {
  const csv = buildGoogleAdsEditorAssetsCsv();
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /^\uFEFFCampaign,Ad group,Status,Keyword,Match type,Final URL,Headline 1/);
  assert.match(csv, /Headline 15/);
  assert.match(csv, /Description 4/);
  assert.match(csv, /Search \| CRM op maat,Kernintentie,Paused/);
  assert.match(csv, /crm systeem op maat,Exact/);
  assert.match(csv, /utm_source=google/);
  assert.doesNotMatch(csv, /Enabled|Campaign daily budget|Daily budget/);
  assert.equal(csv.trim().split(/\r?\n/).length, 22);
});

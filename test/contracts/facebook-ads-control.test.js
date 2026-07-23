const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FACEBOOK_ADS_SCOPE,
  MACHINE_STATE_KEY,
  createFacebookAdsControlService,
  readConfiguration,
} = require('../../server/services/facebook-ads-control');
const {
  registerFacebookAdsProtectedRoutes,
} = require('../../server/routes/facebook-ads');
const {
  CAMPAIGN_LAUNCH_PACKS,
  URL_PARAMETERS,
  buildFacebookAdsLaunchPack,
  validateCampaign,
} = require('../../server/services/facebook-ads-launch-pack');

test('Facebook Ads control blijft fail-closed en bouwt uitsluitend gepauzeerde Meta-concepten', async () => {
  const state = {};
  const writes = [];
  const service = createFacebookAdsControlService({
    env: {},
    now: () => new Date('2026-07-23T12:00:00.000Z'),
    getUiStateValues: async () => state,
    setUiStateValues: async (scope, patch) => {
      assert.equal(scope, FACEBOOK_ADS_SCOPE);
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
  assert.equal(status.launchPackValid, true);

  const blueprint = service.getBlueprint();
  assert.equal(blueprint.campaigns.length, 3);
  assert.equal(blueprint.campaigns.every((campaign) => campaign.status === 'draft-paused'), true);
  assert.equal(blueprint.campaigns.every((campaign) => campaign.objective === 'OUTCOME_LEADS'), true);

  const result = await service.runDryRun();
  assert.equal(result.spendCents, 0);
  assert.equal(result.mutationsPerformed, 0);
  assert.match(result.selectedAction, /Meta Business Portfolio/);
  assert.deepEqual(writes.at(-1)[MACHINE_STATE_KEY].lastRun, result);
});

test('Meta configuratie geeft alleen booleans terug en lekt nooit access tokens', () => {
  const configured = readConfiguration({
    META_ADS_ACCOUNT_ID: 'act_123',
    META_BUSINESS_ID: '456',
    META_PIXEL_ID: '1234567890',
    META_ACCESS_TOKEN: 'never-public',
    META_ADS_CONSENT_CONFIGURED: 'true',
    META_CAPI_CONFIGURED: '1',
  });
  assert.deepEqual(configured, {
    accountConfigured: true,
    apiConfigured: true,
    pixelConfigured: true,
    consentConfigured: true,
    conversionsApiConfigured: true,
  });
  assert.equal(JSON.stringify(configured).includes('never-public'), false);
});

test('Facebook Ads routes zijn admin-only en bieden geen activatie- of budgetendpoint', () => {
  const routes = [];
  const app = {
    get(path, ...handlers) { routes.push(['GET', path, handlers]); },
    post(path, ...handlers) { routes.push(['POST', path, handlers]); },
  };
  const requireAdmin = (_req, _res, next) => next();
  registerFacebookAdsProtectedRoutes(app, {
    requirePremiumAdminApiAccess: requireAdmin,
    service: {
      getStatus() {},
      getBlueprint() {},
      getLaunchPack() {},
      runDryRun() {},
    },
  });

  const paths = routes.map(([method, routePath]) => `${method} ${routePath}`);
  assert.deepEqual(paths, [
    'GET /api/facebook-ads/status',
    'GET /api/facebook-ads/blueprint',
    'GET /api/facebook-ads/launch-pack',
    'POST /api/facebook-ads/dry-run',
  ]);
  assert.equal(routes.every((route) => route[2][0] === requireAdmin), true);
  assert.equal(paths.some((routePath) => /activate|budget|mutate|campaign/.test(routePath)), false);
});

test('Facebook launch-pack is deterministic, budgetloos en Meta-specifiek', () => {
  const pack = buildFacebookAdsLaunchPack();
  assert.equal(pack.validation.valid, true);
  assert.equal(pack.accountDefaults.dailyBudgetCents, 0);
  assert.equal(pack.tracking.urlParameters, URL_PARAMETERS);
  assert.equal(pack.campaigns.length, 3);
  assert.equal(pack.validation.creativesChecked, 6);
  assert.equal(pack.landingPages.every((page) => page.ready), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.status === 'draft-paused'), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.objective === 'OUTCOME_LEADS'), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.ads.length === 2), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.ads.every((ad) => ad.primaryText.length <= 125)), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.ads.every((ad) => ad.headline.length <= 40)), true);
  assert.equal(pack.campaigns.every((campaign) => campaign.ads.every((ad) => ad.description.length <= 30)), true);
});

test('Facebook validator blokkeert actieve campagnes, verkeerde doelen en te lange copy', () => {
  const unsafe = {
    ...CAMPAIGN_LAUNCH_PACKS[0],
    status: 'enabled',
    objective: 'OUTCOME_SALES',
    ads: [{
      ...CAMPAIGN_LAUNCH_PACKS[0].ads[0],
      primaryText: 'x'.repeat(126),
    }],
  };
  const codes = validateCampaign(unsafe).map((error) => error.code);
  assert.ok(codes.includes('campaign_not_paused'));
  assert.ok(codes.includes('unsafe_objective'));
  assert.ok(codes.includes('creative_count'));
  assert.ok(codes.includes('primary_text_too_long'));
});

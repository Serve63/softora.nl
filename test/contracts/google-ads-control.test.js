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
    service: { getStatus() {}, getBlueprint() {}, runDryRun() {}, recordConversion() {} },
  });

  const paths = routes.map(([method, path]) => `${method} ${path}`);
  assert.deepEqual(paths, [
    'POST /api/public-conversion',
    'GET /api/google-ads/daily-run',
    'GET /api/google-ads/status',
    'GET /api/google-ads/blueprint',
    'POST /api/google-ads/dry-run',
  ]);
  assert.equal(routes.find((route) => route[1] === '/api/google-ads/status')[2][0], requireAdmin);
  assert.equal(paths.some((path) => /activate|budget|mutate|campaign/.test(path)), false);
});

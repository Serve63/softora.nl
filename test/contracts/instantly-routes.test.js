const test = require('node:test');
const assert = require('node:assert/strict');

const { registerInstantlyRoutes } = require('../../server/routes/instantly');

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return payload;
    },
  };
}

test('instantly routes expose adblock-safe admin aliases for database actions', async () => {
  const routes = [];
  let adminChecks = 0;
  let syncInput = null;
  let deliverySyncInput = null;
  let uploadInput = null;
  let replacementInput = null;
  let queueInput = null;
  let designStageInput = null;
  const app = {
    get(path, ...handlers) {
      routes.push(['GET', path, handlers]);
    },
    post(path, ...handlers) {
      routes.push(['POST', path, handlers]);
    },
  };

  registerInstantlyRoutes(app, {
    requirePremiumAdminApiAccess(req, _res, next) {
      adminChecks += 1;
      req.premiumAuth = { email: 'serve@softora.nl' };
      next();
    },
    instantlyOutreachService: {
      async syncInstantlyLeads(input) {
        syncInput = input;
        return { ok: true, skipped: true, reason: 'reconcile_only', synced: 0 };
      },
      async refreshInstantlyDeliveryStatus(input) {
        deliverySyncInput = input;
        return { ok: true, checked: 18, updated: 2 };
      },
      async prepareInstantlyUpload(input) {
        uploadInput = input;
        return { ok: true, prepared: 100 };
      },
      async replaceInstantlyCampaigns(input) {
        replacementInput = input;
        return { ok: true, uploaded: 101, distribution: { serve: 51, martijn: 50 } };
      },
      async getStatus() {
        return { ok: true, enabled: true };
      },
    },
    instantlyQueueRegistrationService: {
      async registerBatch(input) {
        queueInput = input;
        return { ok: true, processed: 1, registered: 1 };
      },
      async stageDesignBatch(input) {
        designStageInput = input;
        return { ok: true, processed: 1, staged: 1 };
      },
    },
  });

  const syncRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-sync');
  const uploadRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-upload');
  const statusRoute = routes.find(([method, path]) => method === 'GET' && path === '/api/outreach/provider-status');
  const queueRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-queue/register');
  const designStageRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-queue/stage-designs');
  assert.ok(syncRoute, 'safe sync alias should be registered');
  assert.ok(uploadRoute, 'safe upload alias should be registered');
  assert.ok(statusRoute, 'safe status alias should be registered');
  assert.ok(queueRoute, 'safe queue registration route should be registered');
  assert.ok(designStageRoute, 'safe queue design staging route should be registered');

  const response = createResponseRecorder();
  const request = {
    body: {
      limit: 10,
      refreshExistingVariables: true,
      refreshExistingLimit: 4,
      refreshExistingOnly: true,
      reconcileOnly: true,
      cleanupOnly: true,
      campaignId: 'campaign-martijn',
      senderProfile: 'martijn',
      senderEmail: 'martijn@websoftora.com',
    },
  };
  syncRoute[2][0](request, response, () => {});
  await syncRoute[2][1](request, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, skipped: true, reason: 'reconcile_only', synced: 0 });
  assert.equal(adminChecks, 1);
  assert.equal(syncInput.limit, undefined);
  assert.equal(syncInput.refreshExistingVariables, true);
  assert.equal(syncInput.refreshExistingLimit, 4);
  assert.equal(syncInput.refreshExistingOnly, true);
  assert.equal(syncInput.reconcileOnly, true);
  assert.equal(syncInput.cleanupOnly, true);
  assert.equal(syncInput.campaignId, 'campaign-martijn');
  assert.equal(syncInput.senderProfile, 'martijn');
  assert.equal(syncInput.senderEmail, 'martijn@websoftora.com');
  assert.equal(syncInput.actor, 'serve@softora.nl');

  const uploadResponse = createResponseRecorder();
  const uploadRequest = {
    body: {
      limit: 100,
      campaignId: 'campaign-1',
      uploadId: 'upload-1',
      queueSourceId: 'database-vondsten-20260914',
      queueFileDigest: 'a'.repeat(64),
      senderProfile: 'martijn',
      senderEmail: 'martijn@websoftora.com',
    },
  };
  uploadRoute[2][0](uploadRequest, uploadResponse, () => {});
  await uploadRoute[2][1](uploadRequest, uploadResponse);

  assert.equal(uploadResponse.statusCode, 200);
  assert.deepEqual(uploadResponse.body, { ok: true, prepared: 100 });
  assert.equal(uploadInput.limit, 100);
  assert.equal(uploadInput.campaignId, 'campaign-1');
  assert.equal(uploadInput.uploadId, 'upload-1');
  assert.equal(uploadInput.queueSourceId, 'database-vondsten-20260914');
  assert.equal(uploadInput.queueFileDigest, 'a'.repeat(64));
  assert.equal(uploadInput.senderProfile, 'martijn');
  assert.equal(uploadInput.senderEmail, 'martijn@websoftora.com');
  assert.equal(uploadInput.actor, 'serve@softora.nl');

  const replacementResponse = createResponseRecorder();
  const replacementRequest = {
    body: {
      mode: 'replace',
      limit: 101,
      uploadId: 'replacement-1',
    },
  };
  uploadRoute[2][0](replacementRequest, replacementResponse, () => {});
  await uploadRoute[2][1](replacementRequest, replacementResponse);

  assert.equal(replacementResponse.statusCode, 200);
  assert.deepEqual(replacementResponse.body, { ok: true, uploaded: 101, distribution: { serve: 51, martijn: 50 } });
  assert.equal(replacementInput.limit, 101);
  assert.equal(replacementInput.uploadId, 'replacement-1');
  assert.equal(replacementInput.actor, 'serve@softora.nl');

  const deliveryResponse = createResponseRecorder();
  const deliveryRequest = { body: { deliveryStatusOnly: true } };
  syncRoute[2][0](deliveryRequest, deliveryResponse, () => {});
  await syncRoute[2][1](deliveryRequest, deliveryResponse);

  assert.equal(deliveryResponse.statusCode, 200);
  assert.deepEqual(deliveryResponse.body, { ok: true, checked: 18, updated: 2 });
  assert.equal(deliverySyncInput.reconcileOnly, true);
  assert.equal(deliverySyncInput.actor, 'serve@softora.nl');

  const queueResponse = createResponseRecorder();
  const queueRequest = {
    body: {
      rows: [{ bedrijf: 'Voorbeeld', email: 'info@voorbeeld.nl' }],
      sourceId: 'database-vondsten-20260914',
      fileDigest: 'a'.repeat(64),
      totalRows: 1,
      batchIndex: 0,
      batchCount: 1,
    },
  };
  queueRoute[2][0](queueRequest, queueResponse, () => {});
  await queueRoute[2][1](queueRequest, queueResponse);
  assert.equal(queueResponse.statusCode, 200);
  assert.deepEqual(queueResponse.body, { ok: true, processed: 1, registered: 1 });
  assert.equal(queueInput.sourceId, 'database-vondsten-20260914');
  assert.equal(queueInput.actor, 'serve@softora.nl');

  const designStageResponse = createResponseRecorder();
  const designStageRequest = {
    body: {
      emails: ['info@voorbeeld.nl'],
      sourceId: 'database-vondsten-20260914',
      fileDigest: 'a'.repeat(64),
      refreshInventory: true,
    },
  };
  designStageRoute[2][0](designStageRequest, designStageResponse, () => {});
  await designStageRoute[2][1](designStageRequest, designStageResponse);
  assert.equal(designStageResponse.statusCode, 200);
  assert.deepEqual(designStageResponse.body, { ok: true, processed: 1, staged: 1 });
  assert.deepEqual(designStageInput.emails, ['info@voorbeeld.nl']);
  assert.equal(designStageInput.refreshInventory, true);
  assert.equal(designStageInput.actor, 'serve@softora.nl');
  assert.equal(adminChecks, 6);
});

test('automatic Instantly cron authenticates GET and delegates additions to canonical POST', async () => {
  const routes = [];
  let uploads = 0;
  let posted = 0;
  let activationFails = false;
  const app = {
    get(path, ...handlers) { routes.push(['GET', path, handlers]); },
    post(path, ...handlers) { routes.push(['POST', path, handlers]); },
  };
  registerInstantlyRoutes(app, {
    cronSecret: 'secret-for-test',
    requirePremiumAdminApiAccess(_req, res) { res.status(403).json({ ok: false }); },
    postAutomaticUpload: async (secret) => {
      posted += 1;
      assert.equal(secret, 'secret-for-test');
      return { status: 200, json: async () => ({ ok: true, uploaded: 1 }) };
    },
    instantlyOutreachService: {
      async autoUploadMailReady(input) {
        uploads += 1;
        assert.equal(input.actor, 'Instantly automatische cron');
        return activationFails ? { ok: false, uploaded: 1, code: 'INSTANTLY_AUTO_ACTIVATION_FAILED' } : { ok: true, uploaded: 1 };
      },
    },
  });
  const cron = routes.find(([method, path]) => method === 'GET' && path === '/api/outreach/provider-upload/auto-run');
  const canonical = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-upload');
  assert.ok(cron);
  assert.ok(canonical);
  const denied = createResponseRecorder();
  await cron[2][0]({ headers: { authorization: 'Bearer wrong' } }, denied);
  assert.equal(denied.statusCode, 401);
  assert.equal(posted, 0);
  const allowed = createResponseRecorder();
  await cron[2][0]({ headers: { authorization: 'Bearer secret-for-test' } }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(posted, 1);
  assert.equal(uploads, 0, 'GET never imports directly');
  const postedRequest = { headers: { authorization: 'Bearer secret-for-test' }, body: { mode: 'auto' } };
  const postResult = createResponseRecorder();
  canonical[2][0](postedRequest, postResult, () => {});
  await canonical[2][1](postedRequest, postResult);
  assert.equal(uploads, 1);
  assert.deepEqual(postResult.body, { ok: true, uploaded: 1 });
  activationFails = true;
  const failedActivation = createResponseRecorder();
  canonical[2][0](postedRequest, failedActivation, () => {});
  await canonical[2][1](postedRequest, failedActivation);
  assert.equal(failedActivation.statusCode, 502);
  assert.equal(failedActivation.body.code, 'INSTANTLY_AUTO_ACTIVATION_FAILED');
});

test('automatic Instantly internal POST supplies the required same-origin header', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { status: 200, json: async () => ({ ok: true, skipped: true }) };
  };
  try {
    const routes = [];
    registerInstantlyRoutes({
      get(path, ...handlers) { routes.push(['GET', path, handlers]); },
      post() {},
    }, { cronSecret: 'test-secret', instantlyOutreachService: {} });
    const cron = routes.find(([method, path]) => method === 'GET' && path === '/api/outreach/provider-upload/auto-run');
    assert.ok(cron);
    const res = createResponseRecorder();
    await cron[2][0]({ headers: { authorization: 'Bearer test-secret' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://www.softora.nl/api/outreach/provider-upload');
    assert.equal(requests[0].options.headers.Origin, 'https://www.softora.nl');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-secret');
    assert.deepEqual(JSON.parse(requests[0].options.body), { mode: 'auto' });
  } finally {
    global.fetch = originalFetch;
  }
});

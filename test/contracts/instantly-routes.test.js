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
  let uploadInput = null;
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
        return { ok: true, synced: 10 };
      },
      async prepareInstantlyUpload(input) {
        uploadInput = input;
        return { ok: true, prepared: 100 };
      },
      async getStatus() {
        return { ok: true, enabled: true };
      },
    },
  });

  const syncRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-sync');
  const uploadRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-upload');
  const statusRoute = routes.find(([method, path]) => method === 'GET' && path === '/api/outreach/provider-status');
  assert.ok(syncRoute, 'safe sync alias should be registered');
  assert.ok(uploadRoute, 'safe upload alias should be registered');
  assert.ok(statusRoute, 'safe status alias should be registered');

  const response = createResponseRecorder();
  const request = {
    body: {
      limit: 10,
      refreshExistingVariables: true,
      refreshExistingLimit: 4,
      refreshExistingOnly: true,
      reconcileOnly: true,
      cleanupOnly: true,
    },
  };
  syncRoute[2][0](request, response, () => {});
  await syncRoute[2][1](request, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, synced: 10 });
  assert.equal(adminChecks, 1);
  assert.equal(syncInput.limit, 10);
  assert.equal(syncInput.refreshExistingVariables, true);
  assert.equal(syncInput.refreshExistingLimit, 4);
  assert.equal(syncInput.refreshExistingOnly, true);
  assert.equal(syncInput.reconcileOnly, true);
  assert.equal(syncInput.cleanupOnly, true);
  assert.equal(syncInput.actor, 'serve@softora.nl');

  const uploadResponse = createResponseRecorder();
  const uploadRequest = {
    body: {
      limit: 100,
      campaignId: 'campaign-1',
      uploadId: 'upload-1',
    },
  };
  uploadRoute[2][0](uploadRequest, uploadResponse, () => {});
  await uploadRoute[2][1](uploadRequest, uploadResponse);

  assert.equal(uploadResponse.statusCode, 200);
  assert.deepEqual(uploadResponse.body, { ok: true, prepared: 100 });
  assert.equal(uploadInput.limit, 100);
  assert.equal(uploadInput.campaignId, 'campaign-1');
  assert.equal(uploadInput.uploadId, 'upload-1');
  assert.equal(uploadInput.actor, 'serve@softora.nl');
});

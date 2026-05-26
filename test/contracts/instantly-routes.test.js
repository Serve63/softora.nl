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
      async getStatus() {
        return { ok: true, enabled: true };
      },
    },
  });

  const syncRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/outreach/provider-sync');
  const statusRoute = routes.find(([method, path]) => method === 'GET' && path === '/api/outreach/provider-status');
  assert.ok(syncRoute, 'safe sync alias should be registered');
  assert.ok(statusRoute, 'safe status alias should be registered');

  const response = createResponseRecorder();
  const request = { body: { limit: 10 } };
  syncRoute[2][0](request, response, () => {});
  await syncRoute[2][1](request, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, synced: 10 });
  assert.equal(adminChecks, 1);
  assert.equal(syncInput.limit, 10);
  assert.equal(syncInput.actor, 'serve@softora.nl');
});

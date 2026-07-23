const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIVE_MOMENTUM_ACCESS_COOKIE_NAME,
  createLiveMomentumAccessGate,
} = require('../../server/security/live-momentum-access');
const { registerLiveMomentumAccessRoutes } = require('../../server/routes/live-momentum-access');

function createResponseRecorder() {
  return {
    cookies: [],
    statusCode: 200,
    payload: null,
    append(name, value) {
      if (name === 'Set-Cookie') this.cookies.push(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('Live Momentum gate accepts only 808080 and binds its cookie to the current admin', () => {
  let currentTime = 1_700_000_000_000;
  const gate = createLiveMomentumAccessGate({
    sessionSecret: 'live-momentum-test-secret',
    now: () => currentTime,
  });
  const authState = {
    authenticated: true,
    isAdmin: true,
    email: 'serve@softora.test',
  };

  const deniedResponse = createResponseRecorder();
  assert.equal(
    gate.grantLiveMomentumAccess({ headers: {} }, deniedResponse, authState, '000000').ok,
    false
  );
  assert.deepEqual(deniedResponse.cookies, []);

  const grantedResponse = createResponseRecorder();
  const grant = gate.grantLiveMomentumAccess(
    { headers: {} },
    grantedResponse,
    authState,
    '808080'
  );
  assert.equal(grant.ok, true);
  assert.equal(grantedResponse.cookies.length, 1);
  assert.match(grantedResponse.cookies[0], new RegExp(`^${LIVE_MOMENTUM_ACCESS_COOKIE_NAME}=`));
  assert.match(grantedResponse.cookies[0], /HttpOnly/);
  assert.match(grantedResponse.cookies[0], /SameSite=Lax/);

  const cookiePair = grantedResponse.cookies[0].split(';')[0];
  const requestWithCookie = { headers: { cookie: cookiePair } };
  assert.equal(gate.hasLiveMomentumAccess(requestWithCookie, authState), true);
  assert.equal(
    gate.hasLiveMomentumAccess(requestWithCookie, {
      ...authState,
      email: 'andere-admin@softora.test',
    }),
    false
  );

  currentTime += grant.expiresInMs + 1;
  assert.equal(gate.hasLiveMomentumAccess(requestWithCookie, authState), false);
});

test('Live Momentum access route is rate-limited, admin-only and never returns the code', () => {
  const registrations = [];
  const app = {
    post(path, ...handlers) {
      registrations.push({ path, handlers });
    },
  };
  const rateLimiter = () => {};
  const adminGuard = () => {};
  const auditEvents = [];

  registerLiveMomentumAccessRoutes(app, {
    premiumLoginRateLimiter: rateLimiter,
    requirePremiumAdminApiAccess: adminGuard,
    grantLiveMomentumAccess: (_req, _res, authState, code) => ({
      ok: code === '808080' && authState.isAdmin,
      status: 403,
      error: 'Toegangscode is onjuist.',
      expiresInMs: 1000,
    }),
    appendSecurityAuditEvent: (event) => auditEvents.push(event),
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].path, '/api/live-momentum/access');
  assert.equal(registrations[0].handlers[0], rateLimiter);
  assert.equal(registrations[0].handlers[1], adminGuard);

  const handler = registrations[0].handlers[2];
  const deniedResponse = createResponseRecorder();
  handler(
    {
      body: { code: '111111' },
      premiumAuth: { authenticated: true, isAdmin: true, email: 'serve@softora.test' },
      get: () => 'test-agent',
    },
    deniedResponse
  );
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.payload.ok, false);
  assert.doesNotMatch(JSON.stringify(deniedResponse.payload), /808080/);
  assert.equal(auditEvents[0].success, false);
});

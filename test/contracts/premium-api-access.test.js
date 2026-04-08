const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumApiAccessGuard } = require('../../server/security/premium-auth');

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
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

test('premium api guard bypasses public api requests', async () => {
  let authLookups = 0;
  const guard = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest: () => true,
    getResolvedPremiumAuthState: async () => {
      authLookups += 1;
      return { configured: true, authenticated: true };
    },
  });

  const req = { method: 'GET', originalUrl: '/api/auth/session' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await guard.requirePremiumApiAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(authLookups, 0);
  assert.equal(res.statusCode, null);
});

test('premium api guard returns 503 when auth is not fully configured', async () => {
  const guard = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest: () => false,
    getResolvedPremiumAuthState: async () => ({
      configured: false,
      authenticated: false,
      expired: false,
      revoked: false,
    }),
  });

  const req = { method: 'GET', originalUrl: '/api/private' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await guard.requirePremiumApiAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /Premium auth is nog niet volledig/i);
});

test('premium api guard blocks authenticated requests from disallowed admin ips', async () => {
  const events = [];
  const cleared = [];
  const guard = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest: () => false,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      email: 'info@softora.nl',
    }),
    isPremiumAdminIpAllowed: () => false,
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestPathname: () => '/api/premium-users',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
    clearPremiumSessionCookie: (req) => cleared.push(req.originalUrl),
  });

  const req = {
    method: 'GET',
    originalUrl: '/api/premium-users',
    get: () => 'agent',
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await guard.requirePremiumApiAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Toegang vanaf dit IP-adres is niet toegestaan.');
  assert.deepEqual(cleared, ['/api/premium-users']);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'security_admin_ip_blocked');
  assert.equal(events[0].payload.type, 'admin_ip_blocked');
});

test('premium api guard attaches auth state for allowed authenticated requests', async () => {
  const authState = {
    configured: true,
    authenticated: true,
    isAdmin: true,
    email: 'info@softora.nl',
  };
  const guard = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest: () => false,
    getResolvedPremiumAuthState: async () => authState,
    isPremiumAdminIpAllowed: () => true,
  });

  const req = { method: 'GET', originalUrl: '/api/auth/profile' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await guard.requirePremiumApiAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.premiumAuth, authState);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.statusCode, null);
});

test('premium api guard clears expired or revoked sessions before returning 401', async () => {
  const cleared = [];
  const guard = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest: () => false,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: false,
      expired: true,
      revoked: false,
    }),
    clearPremiumSessionCookie: (_req, _res) => cleared.push(true),
  });

  const req = { method: 'GET', originalUrl: '/api/auth/profile' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await guard.requirePremiumApiAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Niet ingelogd.');
  assert.equal(cleared.length, 1);
});

test('premium admin api guard enforces login and admin role', () => {
  const guard = createPremiumApiAccessGuard();

  const unauthenticatedRes = createResponseRecorder();
  let unauthenticatedNext = false;
  guard.requirePremiumAdminApiAccess({}, unauthenticatedRes, () => {
    unauthenticatedNext = true;
  });
  assert.equal(unauthenticatedNext, false);
  assert.equal(unauthenticatedRes.statusCode, 401);

  const nonAdminRes = createResponseRecorder();
  let nonAdminNext = false;
  guard.requirePremiumAdminApiAccess(
    { premiumAuth: { authenticated: true, isAdmin: false } },
    nonAdminRes,
    () => {
      nonAdminNext = true;
    }
  );
  assert.equal(nonAdminNext, false);
  assert.equal(nonAdminRes.statusCode, 403);

  const adminRes = createResponseRecorder();
  let adminNext = false;
  guard.requirePremiumAdminApiAccess(
    { premiumAuth: { authenticated: true, isAdmin: true } },
    adminRes,
    () => {
      adminNext = true;
    }
  );
  assert.equal(adminNext, true);
  assert.equal(adminRes.statusCode, null);
});

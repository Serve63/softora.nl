const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeDebugAccessGuard } = require('../../server/security/runtime-debug');

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

test('runtime debug guard blocks disabled routes and emits audit event', () => {
  const events = [];
  const guard = createRuntimeDebugAccessGuard({
    isProduction: true,
    enableRuntimeDebugRoutes: false,
    getPremiumAuthState: () => ({ email: 'info@softora.nl' }),
    isPremiumAdminIpAllowed: () => true,
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestPathname: () => '/api/runtime-debug',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  const res = createResponseRecorder();
  let nextCalled = false;
  guard.requireRuntimeDebugAccess({ get: () => 'agent' }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
  assert.equal(events.length, 1);
});

test('runtime debug guard blocks when premium auth is not configured', async () => {
  const guard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getResolvedPremiumAuthState: async () => ({
      configured: false,
      authenticated: false,
      expired: false,
      revoked: false,
      isAdmin: false,
    }),
  });

  const res = createResponseRecorder();
  let nextCalled = false;
  await guard.requireRuntimeDebugAccess({ get: () => 'agent' }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
});

test('runtime debug guard requires an authenticated admin session', async () => {
  const cleared = [];
  const unauthenticatedGuard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: false,
      expired: true,
      revoked: false,
      isAdmin: false,
    }),
    clearPremiumSessionCookie: () => cleared.push(true),
  });

  const unauthenticatedRes = createResponseRecorder();
  let unauthenticatedNext = false;
  await unauthenticatedGuard.requireRuntimeDebugAccess({ get: () => 'agent' }, unauthenticatedRes, () => {
    unauthenticatedNext = true;
  });

  assert.equal(unauthenticatedNext, false);
  assert.equal(unauthenticatedRes.statusCode, 401);
  assert.equal(cleared.length, 1);

  const events = [];
  const nonAdminGuard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      expired: false,
      revoked: false,
      isAdmin: false,
      email: 'medewerker@softora.nl',
    }),
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    getClientIpFromRequest: () => '203.0.113.12',
    getRequestPathname: () => '/api/runtime-debug',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  const nonAdminRes = createResponseRecorder();
  let nonAdminNext = false;
  await nonAdminGuard.requireRuntimeDebugAccess({ get: () => 'agent' }, nonAdminRes, () => {
    nonAdminNext = true;
  });

  assert.equal(nonAdminNext, false);
  assert.equal(nonAdminRes.statusCode, 403);
  assert.equal(nonAdminRes.body.error, 'Alleen Full Acces-accounts hebben toegang.');
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'security_debug_admin_required');
  assert.equal(events[0].payload.type, 'debug_admin_required');
});

test('runtime debug guard blocks disallowed admin ips and allows valid access', async () => {
  const blockedGuard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      expired: false,
      revoked: false,
      isAdmin: true,
      email: 'info@softora.nl',
    }),
    getPremiumAuthState: () => ({ email: 'info@softora.nl' }),
    isPremiumAdminIpAllowed: () => false,
    appendSecurityAuditEvent: () => {},
    getClientIpFromRequest: () => '203.0.113.11',
    getRequestPathname: () => '/api/runtime-debug',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  const blockedRes = createResponseRecorder();
  let blockedNext = false;
  await blockedGuard.requireRuntimeDebugAccess({ get: () => 'agent' }, blockedRes, () => {
    blockedNext = true;
  });
  assert.equal(blockedNext, false);
  assert.equal(blockedRes.statusCode, 403);

  const allowedGuard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      expired: false,
      revoked: false,
      isAdmin: true,
      email: 'info@softora.nl',
    }),
    getPremiumAuthState: () => ({ email: 'info@softora.nl' }),
    isPremiumAdminIpAllowed: () => true,
    appendSecurityAuditEvent: () => {},
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestPathname: () => '/api/runtime-debug',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  const allowedRes = createResponseRecorder();
  let allowedNext = false;
  await allowedGuard.requireRuntimeDebugAccess({ get: () => 'agent' }, allowedRes, () => {
    allowedNext = true;
  });
  assert.equal(allowedNext, true);
  assert.equal(allowedRes.statusCode, null);
  assert.equal(allowedRes.headers['Cache-Control'], 'no-store, private');
});

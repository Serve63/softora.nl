const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeDebugAccessGuard } = require('../../server/security/runtime-debug');

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

test('runtime debug guard blocks disallowed admin ips and allows valid access', () => {
  const blockedGuard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getPremiumAuthState: () => ({ email: 'info@softora.nl' }),
    isPremiumAdminIpAllowed: () => false,
    appendSecurityAuditEvent: () => {},
    getClientIpFromRequest: () => '203.0.113.11',
    getRequestPathname: () => '/api/runtime-debug',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  const blockedRes = createResponseRecorder();
  let blockedNext = false;
  blockedGuard.requireRuntimeDebugAccess({ get: () => 'agent' }, blockedRes, () => {
    blockedNext = true;
  });
  assert.equal(blockedNext, false);
  assert.equal(blockedRes.statusCode, 403);

  const allowedGuard = createRuntimeDebugAccessGuard({
    isProduction: false,
    enableRuntimeDebugRoutes: true,
    getPremiumAuthState: () => ({ email: 'info@softora.nl' }),
    isPremiumAdminIpAllowed: () => true,
    appendSecurityAuditEvent: () => {},
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestPathname: () => '/api/runtime-debug',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  const allowedRes = createResponseRecorder();
  let allowedNext = false;
  allowedGuard.requireRuntimeDebugAccess({ get: () => 'agent' }, allowedRes, () => {
    allowedNext = true;
  });
  assert.equal(allowedNext, true);
  assert.equal(allowedRes.statusCode, null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../testlib/server-process');

let serverRef = null;

test.before(async () => {
  serverRef = await startTestServer();
});

test.after(async () => {
  if (serverRef) {
    await serverRef.stop();
  }
});

async function getJson(pathname) {
  const response = await fetch(`${serverRef.baseUrl}${pathname}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function getProtectedApiExpectation(pathname) {
  const authState = await getJson('/api/auth/session');
  const result = await getJson(pathname);
  const configured = Boolean(authState.body?.configured);
  if (!configured) {
    assert.equal(result.response.status, 503, pathname);
    assert.equal(result.body.ok, false, pathname);
    return result;
  }
  assert.ok(
    result.response.status === 200 || result.response.status === 401,
    `${pathname} gaf onverwachte status ${result.response.status}`
  );
  return result;
}

test('health endpoints expose stable baseline payloads', async () => {
  for (const pathname of ['/healthz', '/api/healthz', '/api/health/baseline']) {
    const { response, body } = await getJson(pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(body.ok, true, pathname);
    assert.equal(typeof body.service, 'string', pathname);
    assert.equal(typeof body.version, 'string', pathname);
    assert.equal(typeof body.timestamp, 'string', pathname);
    assert.equal(typeof body.supabase, 'object', pathname);
    assert.ok(Array.isArray(body.criticalFlows), pathname);
  }
});

test('dependency health endpoint exposes security-safe dependency state', async () => {
  const { response, body } = await getJson('/api/health/dependencies');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.dependencies, 'object');
  assert.equal(typeof body.dependencies.supabase, 'object');
  assert.equal(typeof body.dependencies.mail, 'object');
  assert.equal(typeof body.dependencies.ai, 'object');
  assert.equal(typeof body.dependencies.sessions, 'object');
});

test('auth session contract is stable for anonymous requests', async () => {
  const { response, body } = await getJson('/api/auth/session');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.configured, 'boolean');
  assert.equal(typeof body.authenticated, 'boolean');
  assert.equal(typeof body.mfaEnabled, 'boolean');
  assert.equal(typeof body.displayName, 'string');
});

test('agenda appointments contract remains readable', async () => {
  const result = await getProtectedApiExpectation('/api/agenda/appointments?limit=3');
  if (result.response.status === 200) {
    assert.equal(result.body.ok, true);
    assert.equal(typeof result.body.count, 'number');
    assert.ok(Array.isArray(result.body.appointments));
  }
});

test('coldcalling endpoints keep their contract boundaries', async () => {
  const updatesResult = await getProtectedApiExpectation('/api/coldcalling/call-updates?limit=3');
  if (updatesResult.response.status === 200) {
    assert.equal(updatesResult.body.ok, true);
    assert.ok(Array.isArray(updatesResult.body.updates));
  }

  const missingCallIdResult = await getJson('/api/coldcalling/call-detail');
  assert.ok([400, 401, 503].includes(missingCallIdResult.response.status));
  assert.equal(missingCallIdResult.body.ok, false);
});

test('runtime backup route is available in non-production verification mode', async () => {
  const authState = await getJson('/api/auth/session');
  const { response, body } = await getJson('/api/runtime-backup');
  if (!authState.body?.configured) {
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    return;
  }
  assert.ok([200, 401].includes(response.status));
  if (response.status === 200) {
    assert.equal(body.ok, true);
    assert.equal(typeof body.snapshot, 'object');
    assert.equal(typeof body.rollback, 'object');
  }
});

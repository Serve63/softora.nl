const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPostgresConfigUrl,
  createSupabaseMaintenanceAccessGuard,
  createSupabaseMaintenanceCoordinator,
  getSupabaseMaintenanceConfigStatus,
  requestSupabaseDatabaseRestart,
  sanitizeSupabaseMaintenanceDetail,
} = require('../../server/services/supabase-maintenance');

function createResponse() {
  return {
    statusCode: 0,
    payload: null,
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

test('supabase maintenance route fails closed while restart flag is disabled', () => {
  const guard = createSupabaseMaintenanceAccessGuard({
    env: {},
    supabaseMaintenanceToken: 'maintenance-token',
  });
  const res = createResponse();
  let nextCalled = false;

  guard(
    { headers: { authorization: 'Bearer maintenance-token' } },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.error, 'SUPABASE_RESTART_DISABLED');
});

test('supabase maintenance route requires the temporary maintenance token', () => {
  const guard = createSupabaseMaintenanceAccessGuard({
    env: { SUPABASE_DATABASE_RESTART_ENABLED: 'true' },
    supabaseMaintenanceToken: 'maintenance-token',
  });
  const res = createResponse();
  let nextCalled = false;

  guard(
    { headers: { authorization: 'Bearer wrong-token' } },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'SUPABASE_MAINTENANCE_UNAUTHORIZED');
});

test('supabase maintenance route allows the exact bearer token only', () => {
  const guard = createSupabaseMaintenanceAccessGuard({
    env: { SUPABASE_DATABASE_RESTART_ENABLED: 'true' },
    supabaseMaintenanceToken: 'maintenance-token',
  });
  const res = createResponse();
  let nextCalled = false;

  guard(
    { headers: { authorization: 'Bearer maintenance-token' } },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
  assert.equal(res.payload, null);
});

test('supabase maintenance builds the official Postgres config restart endpoint', () => {
  assert.equal(
    buildPostgresConfigUrl(
      { supabaseManagementApiBaseUrl: 'https://api.supabase.test/v1/' },
      'project-ref'
    ),
    'https://api.supabase.test/v1/projects/project-ref/config/database/postgres'
  );
});

test('supabase maintenance requests a database restart through Management API', async () => {
  const calls = [];
  const result = await requestSupabaseDatabaseRestart({
    supabaseManagementAccessToken: 'sbp_secret-token',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    supabaseManagementApiBaseUrl: 'https://api.supabase.test/v1',
    fetchJsonWithTimeout: async (url, options, timeoutMs) => {
      calls.push({ url, options, timeoutMs });
      return {
        response: { ok: true, status: 200 },
        data: { ok: true },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.supabase.test/v1/projects/abcdefghijklmnopqrst/config/database/postgres'
  );
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sbp_secret-token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { restart_database: true });
  assert.equal(calls[0].timeoutMs, 30000);
  assert.deepEqual(result, {
    accepted: true,
    projectRef: 'abcd...qrst',
    status: 200,
  });
});

test('supabase maintenance resolves project ref from Supabase URL fallback', async () => {
  const calls = [];
  await requestSupabaseDatabaseRestart({
    supabaseManagementAccessToken: 'supabase-token',
    env: { SUPABASE_URL: 'https://ncaltmmrwuylqjiraktt.supabase.co' },
    fetchJsonWithTimeout: async (url) => {
      calls.push(url);
      return { response: { ok: true, status: 200 }, data: {} };
    },
  });

  assert.equal(
    calls[0],
    'https://api.supabase.com/v1/projects/ncaltmmrwuylqjiraktt/config/database/postgres'
  );
});

test('supabase maintenance sanitizes Management API failures', async () => {
  await assert.rejects(
    () =>
      requestSupabaseDatabaseRestart({
        supabaseManagementAccessToken: 'sbp_secret-token',
        supabaseProjectRef: 'project-ref',
        fetchJsonWithTimeout: async () => ({
          response: { ok: false, status: 403 },
          data: { message: 'Bearer abc.def denied for sbp_secret-token' },
        }),
      }),
    (error) => {
      assert.equal(error.code, 'SUPABASE_DATABASE_RESTART_FAILED');
      assert.equal(error.status, 403);
      assert.equal(sanitizeSupabaseMaintenanceDetail(error.detail), 'Bearer [redacted] denied for sbp_[redacted]');
      return true;
    }
  );
});

test('supabase maintenance coordinator does not leak tokens or full project ref', async () => {
  const coordinator = createSupabaseMaintenanceCoordinator({
    env: { SUPABASE_DATABASE_RESTART_ENABLED: 'true' },
    supabaseManagementAccessToken: 'sbp_secret-token',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { ok: true },
    }),
  });
  const res = createResponse();

  await coordinator.sendSupabaseDatabaseRestartResponse({}, res);

  const body = JSON.stringify(res.payload);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.doesNotMatch(body, /sbp_secret-token/);
  assert.doesNotMatch(body, /abcdefghijklmnopqrst/);
  assert.match(body, /abcd\.\.\.qrst/);
});

test('supabase maintenance config status is redacted', () => {
  const status = getSupabaseMaintenanceConfigStatus({
    env: {
      SUPABASE_DATABASE_RESTART_ENABLED: 'true',
      SUPABASE_MAINTENANCE_TOKEN: 'maintenance-token',
      SUPABASE_MANAGEMENT_ACCESS_TOKEN: 'sbp_secret-token',
      SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
    },
  });

  assert.equal(status.enabled, true);
  assert.equal(status.maintenanceTokenConfigured, true);
  assert.equal(status.managementTokenConfigured, true);
  assert.equal(status.projectRef, 'abcd...qrst');
  assert.doesNotMatch(JSON.stringify(status), /maintenance-token|secret-token|abcdefghijklmnopqrst/);
});

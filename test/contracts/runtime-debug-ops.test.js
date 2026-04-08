const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeDebugOpsCoordinator } = require('../../server/services/runtime-debug-ops');

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

test('runtime debug ops coordinator returns stable supabase probe payloads', async () => {
  const unavailableCoordinator = createRuntimeDebugOpsCoordinator({
    isSupabaseConfigured: () => false,
  });
  const unavailableRes = createResponseRecorder();

  await unavailableCoordinator.sendSupabaseProbeResponse({}, unavailableRes);

  assert.equal(unavailableRes.statusCode, 200);
  assert.equal(unavailableRes.body.ok, false);
  assert.equal(unavailableRes.body.configured, false);

  const successCoordinator = createRuntimeDebugOpsCoordinator({
    isSupabaseConfigured: () => true,
    supabaseUrl: 'https://demo.supabase.co/',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    supabaseServiceRoleKey: 'service-role-key',
    redactSupabaseUrlForDebug: () => 'demo.supabase.co',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '[{\"state_key\":\"runtime_state_main\"}]',
    }),
  });
  const successRes = createResponseRecorder();

  await successCoordinator.sendSupabaseProbeResponse({}, successRes);

  assert.equal(successRes.statusCode, 200);
  assert.equal(successRes.body.ok, true);
  assert.equal(successRes.body.configured, true);
  assert.equal(successRes.body.supabaseHost, 'demo.supabase.co');
  assert.equal(successRes.body.table, 'runtime_state');
  assert.equal(successRes.body.hasServiceRoleKey, true);
  assert.ok(Array.isArray(successRes.body.body));
});

test('runtime debug ops coordinator runs runtime sync and reports before/after state', async () => {
  let resetCalls = 0;
  let hydrateCalls = 0;
  let persistReason = '';

  const coordinator = createRuntimeDebugOpsCoordinator({
    supabaseUrl: 'https://demo.supabase.co',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    redactSupabaseUrlForDebug: () => 'demo.supabase.co',
    getBeforeState: () => ({
      hydrated: false,
      lastHydrateError: 'timeout',
      lastPersistError: null,
      lastCallUpdatePersistError: null,
    }),
    persistRuntimeStateToSupabase: async (reason) => {
      persistReason = reason;
      return true;
    },
    resetHydrationState: () => {
      resetCalls += 1;
    },
    ensureRuntimeStateHydratedFromSupabase: async () => {
      hydrateCalls += 1;
      return true;
    },
    getAfterState: () => ({
      hydrated: true,
      lastHydrateError: null,
      lastPersistError: null,
      lastCallUpdatePersistError: null,
      counts: {
        webhookEvents: 2,
        callUpdates: 3,
        aiCallInsights: 1,
        appointments: 4,
      },
    }),
  });
  const res = createResponseRecorder();

  await coordinator.sendRuntimeSyncNowResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.before.hydrated, false);
  assert.equal(res.body.after.hydrated, true);
  assert.equal(res.body.after.counts.appointments, 4);
  assert.equal(res.body.persistOk, true);
  assert.equal(res.body.hydratedOk, true);
  assert.equal(res.body.supabase.host, 'demo.supabase.co');
  assert.equal(persistReason, 'debug_runtime_sync_now');
  assert.equal(resetCalls, 1);
  assert.equal(hydrateCalls, 1);
});

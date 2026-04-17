const test = require('node:test');
const assert = require('node:assert/strict');

const {
  primeServerAppRuntime,
  startServerAppRuntime,
} = require('../../server/services/server-app-runtime-startup');

test('server app runtime startup primes demo seed and hydration together', async () => {
  const calls = [];

  primeServerAppRuntime({
    seedDemoConfirmationTaskForUiTesting: () => calls.push('seed'),
    ensureRuntimeStateHydratedFromSupabase: async () => calls.push('hydrate'),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['seed', 'hydrate']);
});

test('server app runtime startup logs provider and supabase status safely', () => {
  const logs = [];
  const warns = [];
  const calls = [];

  const app = {
    listen(port, callback) {
      calls.push(['listen', port]);
      callback();
    },
  };

  startServerAppRuntime({
    app,
    port: 4321,
    getColdcallingProvider: () => 'retell',
    getMissingEnvVars: () => ['RETELL_API_KEY'],
    isSupabaseConfigured: () => true,
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'softora_runtime',
    seedDemoConfirmationTaskForUiTesting: () => calls.push('seed'),
    ensureRuntimeStateHydratedFromSupabase: async () => calls.push('hydrate'),
    log: (message) => logs.push(message),
    warn: (message) => warns.push(message),
  });

  assert.equal(calls[0], 'seed');
  assert.equal(calls[1], 'hydrate');
  assert.deepEqual(calls[2], ['listen', 4321]);
  assert.match(logs[0], /localhost:4321/);
  assert.match(logs[1], /runtime_state:softora_runtime/);
  assert.match(warns[0], /RETELL_API_KEY/);
});

test('server app runtime startup reports when supabase persistence is disabled', () => {
  const logs = [];

  startServerAppRuntime({
    app: {
      listen(_port, callback) {
        callback();
      },
    },
    port: 5001,
    getColdcallingProvider: () => 'twilio',
    getMissingEnvVars: () => [],
    isSupabaseConfigured: () => false,
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'softora_runtime',
    seedDemoConfirmationTaskForUiTesting: () => null,
    ensureRuntimeStateHydratedFromSupabase: async () => null,
    log: (message) => logs.push(message),
    warn: () => {
      throw new Error('warn should not be called');
    },
  });

  assert.match(logs[0], /provider: twilio/);
  assert.match(logs[1], /Supabase state persistence uit/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPremiumPinAttemptLimiter,
} = require('../../server/security/premium-pin-attempt-limiter');
const {
  PASSWORD_REGISTER_ENCRYPTED_KEY,
} = require('../../server/schemas/password-register-vault');
const {
  PASSWORD_REGISTER_STATE_KEY,
  readPasswordRegisterVaultBackup,
} = require('../../server/services/password-register-backup');

function createVaultEnvelope(version = 2, overrides = {}) {
  return JSON.stringify({
    version,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: version === 1 ? 210000 : 600000,
    salt: Buffer.alloc(16, 1).toString('base64'),
    iv: Buffer.alloc(12, 2).toString('base64'),
    ciphertext: Buffer.alloc(32, 3).toString('base64'),
    ...overrides,
  });
}

test('password register PIN limiter blocks repeated failures per identity and IP', () => {
  let currentMs = 1_000_000;
  const limiter = createPremiumPinAttemptLimiter({
    now: () => currentMs,
    maxFailures: 2,
    windowMs: 60_000,
  });
  const request = {
    premiumAuth: { userId: 'usr_primary' },
    ip: '192.0.2.10',
  };

  assert.equal(limiter.check(request).ok, true);
  assert.equal(limiter.recordFailure(request).ok, true);
  const blocked = limiter.recordFailure(request);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(limiter.check({ ...request, ip: '192.0.2.11' }).ok, true);

  currentMs += 60_001;
  assert.equal(limiter.check(request).ok, true);
  limiter.recordFailure(request);
  limiter.reset(request);
  assert.equal(limiter.check(request).ok, true);
});

test('password register PIN failure bucket cannot be reset by a successful generic PIN', () => {
  const limiter = createPremiumPinAttemptLimiter({ maxFailures: 5 });
  const baseRequest = {
    premiumAuth: { userId: 'usr_owner' },
    ip: '127.0.0.1',
  };
  const vaultRequest = {
    ...baseRequest,
    body: { actionConfirmScope: 'password-register' },
  };
  const genericRequest = {
    ...baseRequest,
    body: {},
  };

  for (let index = 0; index < 4; index += 1) {
    assert.equal(limiter.recordFailure(vaultRequest).ok, true);
  }
  limiter.reset(genericRequest);
  assert.equal(limiter.recordFailure(vaultRequest).ok, false);
  assert.equal(limiter.check(vaultRequest).ok, false);
});

test('password register backup reads one protected row and returns ciphertext only', async () => {
  const serviceKey = 'test-only-service-role-value';
  const current = createVaultEnvelope(2);
  let requestUrl = '';
  let requestOptions = null;
  const backup = await readPasswordRegisterVaultBackup({
    supabaseUrl: 'https://fixture-project.supabase.co',
    serviceRoleKey: serviceKey,
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => [{
          state_key: PASSWORD_REGISTER_STATE_KEY,
          payload: {
            values: {
              [PASSWORD_REGISTER_ENCRYPTED_KEY]: current,
              entries_json: '',
              updated_at: '2026-08-04T12:00:00.000Z',
              updated_by: 'usr_primary',
            },
          },
          updated_at: '2026-08-04T12:00:01.000Z',
        }],
      };
    },
  });

  assert.match(requestUrl, /state_key=eq\.ui_state%3Apremium_password_register/);
  assert.equal(requestOptions.method, 'GET');
  assert.equal(requestOptions.redirect, 'error');
  assert.equal(requestOptions.headers.Authorization, `Bearer ${serviceKey}`);
  assert.deepEqual(backup.values, { [PASSWORD_REGISTER_ENCRYPTED_KEY]: current });
  assert.equal(backup.envelopeVersion, 2);
  assert.doesNotMatch(JSON.stringify(backup), new RegExp(serviceKey));
  assert.doesNotMatch(JSON.stringify(backup), /updated_by|entries_json/);
});

test('password register backup rejects non-Supabase origins before fetch', async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => readPasswordRegisterVaultBackup({
      supabaseUrl: 'http://169.254.169.254/latest/meta-data',
      serviceRoleKey: 'test-only-service-role-value',
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: false, status: 500 };
      },
    }),
    /niet-vertrouwd Supabase projectadres/
  );
  assert.equal(fetchCalled, false);
});

test('password register backup marks missing local Supabase configuration without guessing credentials', async () => {
  const backup = await readPasswordRegisterVaultBackup({
    supabaseUrl: '',
    serviceRoleKey: '',
    fetchImpl: null,
  });

  assert.deepEqual(backup, {
    included: false,
    scope: 'premium_password_register',
    reason: 'supabase-not-configured',
  });
});

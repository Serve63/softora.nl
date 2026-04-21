const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createPremiumUsersStore } = require('../../lib/premium-users-store');

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function normalizePremiumSessionEmail(value) {
  return normalizeString(value).toLowerCase();
}

function createFixture(overrides = {}) {
  const client = overrides.client || {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: null,
                    error: new Error('read failed'),
                  };
                },
              };
            },
          };
        },
        async upsert() {
          return {
            error: new Error('write failed'),
          };
        },
      };
    },
  };

  return createPremiumUsersStore({
    config: {
      premiumLoginEmails: ['servec321@gmail.com'],
      premiumLoginPasswordHash: `sha256:${crypto.createHash('sha256').update('secret123').digest('hex')}`,
      premiumSessionSecret: 'secret',
      premiumAuthUsersRowKey: 'premium_auth_users',
      premiumAuthUsersVersion: 1,
      supabaseStateTable: 'softora_runtime_state',
      ...overrides.config,
    },
    deps: {
      normalizeString,
      truncateText,
      timingSafeEqualStrings: (left, right) => left === right,
      normalizePremiumSessionEmail,
      isSupabaseConfigured: () =>
        overrides.isSupabaseConfigured === undefined ? true : Boolean(overrides.isSupabaseConfigured),
      getSupabaseClient: () => client,
      fetchSupabaseRowByKeyViaRest: async () =>
        overrides.fetchResult || {
          ok: false,
          error: 'upstream timeout',
        },
      upsertSupabaseRowViaRest: async () =>
        overrides.upsertResult || {
          ok: false,
          error: 'upstream timeout',
        },
    },
  });
}

test('premium users store falls back to bootstrap users when Supabase hydration is unavailable', async () => {
  const store = createFixture();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const hydrated = await store.ensureUsersHydrated();

    assert.equal(hydrated.source, 'bootstrap_env');
    assert.equal(hydrated.users.length, 1);
    assert.equal(hydrated.users[0].email, 'servec321@gmail.com');
    assert.equal(store.getCachedUsers()[0].email, 'servec321@gmail.com');
  } finally {
    console.error = originalConsoleError;
  }
});

test('premium users store can bootstrap users even when Supabase is not configured', async () => {
  const store = createFixture({
    isSupabaseConfigured: false,
  });

  const hydrated = await store.ensureUsersHydrated();

  assert.equal(hydrated.source, 'bootstrap_env');
  assert.equal(hydrated.users.length, 1);
  assert.equal(hydrated.users[0].email, 'servec321@gmail.com');
});

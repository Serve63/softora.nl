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

test('premium users store does not overwrite users with bootstrap data when Supabase hydration fails', async () => {
  const store = createFixture();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const hydrated = await store.ensureUsersHydrated();

    assert.equal(hydrated.source, 'unavailable');
    assert.equal(hydrated.users.length, 0);
    assert.equal(store.getCachedUsers().length, 0);
  } finally {
    console.error = originalConsoleError;
  }
});

test('premium users store times out hanging Supabase hydration instead of hanging login', async () => {
  const store = createFixture({
    config: {
      premiumUsersReadTimeoutMs: 25,
    },
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return new Promise(() => {});
                  },
                };
              },
            };
          },
          async upsert() {
            return { error: new Error('write should not happen') };
          },
        };
      },
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const startedAt = Date.now();
    const hydrated = await store.ensureUsersHydrated();

    assert.equal(hydrated.source, 'unavailable');
    assert.equal(hydrated.users.length, 0);
    assert.ok(Date.now() - startedAt < 1000);
  } finally {
    console.error = originalConsoleError;
  }
});

test('premium users store honors shorter login timeout while another hydrate is pending', async () => {
  const store = createFixture({
    config: {
      premiumUsersReadTimeoutMs: 200,
    },
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return new Promise(() => {});
                  },
                };
              },
            };
          },
          async upsert() {
            return { error: new Error('write should not happen') };
          },
        };
      },
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const pendingHydrate = store.ensureUsersHydrated();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const startedAt = Date.now();
    const hydrated = await store.ensureUsersHydrated({ force: true, readTimeoutMs: 25 });

    assert.equal(hydrated.source, 'unavailable');
    assert.equal(hydrated.users.length, 0);
    assert.ok(Date.now() - startedAt < 1000);
    await pendingHydrate;
  } finally {
    console.error = originalConsoleError;
  }
});

test('premium users store bootstraps only after Supabase confirms the users row is missing', async () => {
  let upsertedRow = null;
  const store = createFixture({
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
          async upsert(row) {
            upsertedRow = row;
            return { error: null };
          },
        };
      },
    },
  });

  const hydrated = await store.ensureUsersHydrated();

  assert.equal(hydrated.source, 'supabase');
  assert.equal(hydrated.users.length, 1);
  assert.equal(hydrated.users[0].email, 'servec321@gmail.com');
  assert.equal(upsertedRow.state_key, 'premium_auth_users');
  assert.equal(upsertedRow.meta.source, 'bootstrap_env');
});

test('premium users store treats an existing empty users row as authoritative', async () => {
  let upsertCalls = 0;
  const store = createFixture({
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        payload: { version: 1, users: [] },
                        updated_at: '2026-05-21T00:00:00.000Z',
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          async upsert() {
            upsertCalls += 1;
            return { error: null };
          },
        };
      },
    },
  });

  const hydrated = await store.ensureUsersHydrated();

  assert.equal(hydrated.source, 'unavailable');
  assert.equal(hydrated.users.length, 0);
  assert.equal(upsertCalls, 0);
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

test('premium users store exposes bootstrap users for password recovery', () => {
  const store = createFixture();

  const user = store.findBootstrapUserByEmail('SERVEC321@gmail.com');

  assert.equal(user.email, 'servec321@gmail.com');
  assert.equal(store.verifyPasswordHash('secret123', user.passwordHash), true);
});

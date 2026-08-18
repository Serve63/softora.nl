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
      getSupabaseClient: (options = {}) => {
        if (typeof overrides.onClientOptions === 'function') overrides.onClientOptions(options);
        return client;
      },
      fetchSupabaseRowByKeyViaRest: async (_rowKey, _columns, options = {}) => {
        if (typeof overrides.onRestOptions === 'function') overrides.onRestOptions(options);
        return overrides.fetchResult || {
          ok: false,
          error: 'upstream timeout',
        };
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
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    const hydrated = await store.ensureUsersHydrated();

    assert.equal(hydrated.source, 'unavailable');
    assert.equal(hydrated.users.length, 0);
    assert.equal(store.getCachedUsers().length, 0);
    assert.equal(errorLogs.length, 0);
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
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    const startedAt = Date.now();
    const hydrated = await store.ensureUsersHydrated();

    assert.equal(hydrated.source, 'unavailable');
    assert.equal(hydrated.users.length, 0);
    assert.ok(Date.now() - startedAt < 1000);
    assert.equal(errorLogs.length, 0);
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
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    const pendingHydrate = store.ensureUsersHydrated();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const startedAt = Date.now();
    const hydrated = await store.ensureUsersHydrated({ force: true, readTimeoutMs: 25 });

    assert.equal(hydrated.source, 'unavailable');
    assert.equal(hydrated.users.length, 0);
    assert.ok(Date.now() - startedAt < 1000);
    assert.equal(errorLogs.length, 0);
    await pendingHydrate;
  } finally {
    console.error = originalConsoleError;
  }
});

test('fresh premium-user hydration never shares a failing non-fresh in-flight read or cached result', async () => {
  let readCalls = 0;
  let releaseNonFreshRead;
  const cachedRow = {
    payload: {
      users: [{
        id: 'usr_cached',
        email: 'cached@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'sha256:test-only-hash',
      }],
    },
    updated_at: '2026-08-04T10:00:00.000Z',
  };
  const store = createFixture({
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    readCalls += 1;
                    if (readCalls === 1) return Promise.resolve({ data: cachedRow, error: null });
                    if (readCalls === 2) {
                      return new Promise((resolve) => {
                        releaseNonFreshRead = () => resolve({ data: null, error: new Error('nonfresh failed') });
                      });
                    }
                    return Promise.resolve({ data: null, error: new Error('fresh failed') });
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
    const initial = await store.ensureUsersHydrated();
    assert.equal(initial.source, 'supabase');
    assert.equal(store.getCachedUsers().length, 1);

    const pendingNonFresh = store.ensureUsersHydrated({ force: true });
    await new Promise((resolve) => setImmediate(resolve));
    const fresh = await store.ensureUsersHydrated({ force: true, requireFresh: true });

    assert.equal(readCalls, 3);
    assert.equal(fresh.source, 'unavailable');
    assert.deepEqual(fresh.users, []);
    releaseNonFreshRead();
    await pendingNonFresh;
  } finally {
    console.error = originalConsoleError;
  }
});

test('fresh premium-user hydration bypasses unrelated cooldowns with its bounded security-read policy', async () => {
  const clientOptions = [];
  const restOptions = [];
  const row = {
    payload: {
      users: [{
        id: 'usr_owner',
        email: 'owner@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'sha256:test-only-hash',
      }],
    },
    updated_at: '2026-08-18T13:20:00.000Z',
    revision: 4,
  };
  const store = createFixture({
    config: { premiumUsersReadTimeoutMs: 4200 },
    onClientOptions: (options) => clientOptions.push(options),
    onRestOptions: (options) => restOptions.push(options),
    fetchResult: { ok: true, body: [row], error: null },
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const hydrated = await store.ensureUsersHydrated({ force: true, requireFresh: true });

    assert.equal(hydrated.source, 'supabase');
    assert.equal(hydrated.users.length, 1);
    assert.deepEqual(clientOptions, [{
      timeoutMs: 4200,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    }]);
    assert.deepEqual(restOptions, clientOptions);
  } finally {
    console.error = originalConsoleError;
  }
});

test('premium users store uses bootstrap users only when fallback is explicitly allowed', async () => {
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
                      error: new Error('read failed'),
                    };
                  },
                };
              },
            };
          },
          async upsert() {
            throw new Error('write should not happen');
          },
        };
      },
    },
    fetchResult: {
      ok: false,
      error: 'upstream timeout',
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const hydrated = await store.ensureUsersHydrated({
      force: true,
      allowBootstrapFallback: true,
    });

    assert.equal(hydrated.source, 'bootstrap_env');
    assert.equal(hydrated.users.length, 1);
    assert.equal(hydrated.users[0].email, 'servec321@gmail.com');
    assert.equal(store.getCachedUsers().length, 1);
  } finally {
    console.error = originalConsoleError;
  }
});

test('premium users store bootstraps only after Supabase confirms the users row is missing', async () => {
  let rpcArgs = null;
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
          async upsert() {
            throw new Error('direct upsert should not happen');
          },
        };
      },
      async rpc(name, args) {
        assert.equal(name, 'softora_replace_premium_auth_users');
        rpcArgs = args;
        return {
          data: {
            ok: true,
            payload: args.p_payload,
            revision: 0,
            updatedAt: '2026-08-13T10:40:00.000Z',
          },
          error: null,
        };
      },
    },
  });

  const hydrated = await store.ensureUsersHydrated();

  assert.equal(hydrated.source, 'supabase');
  assert.equal(hydrated.users.length, 1);
  assert.equal(hydrated.users[0].email, 'servec321@gmail.com');
  assert.equal(rpcArgs.p_expected_revision, -1);
  assert.equal(rpcArgs.p_allow_insert, true);
  assert.equal(rpcArgs.p_meta.source, 'bootstrap_env');
});

test('premium users store persists MFA transitions exclusively through the atomic RPC', async () => {
  const rpcCalls = [];
  const originalUser = {
    id: 'usr_admin',
    email: 'admin@softora.nl',
    role: 'admin',
    status: 'active',
    passwordHash: 'sha256:test-only-hash',
    authVersion: 4,
    mfa: {
      enabled: true,
      encryptedSecret: 'v1.iv.tag.ciphertext',
      recoveryCodeHashes: ['hash-one', 'hash-two'],
      lastTotpCounter: 100,
    },
  };
  const nextUser = {
    ...originalUser,
    mfa: { ...originalUser.mfa, lastTotpCounter: 101 },
  };
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
                        payload: { version: 1, users: [originalUser] },
                        updated_at: '2026-08-13T10:40:00.000Z',
                        revision: 7,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return {
          data: {
            ok: true,
            user: nextUser,
            payload: { version: 1, users: [nextUser] },
            revision: 8,
            updatedAt: '2026-08-13T10:41:00.000Z',
          },
          error: null,
        };
      },
    },
  });
  await store.ensureUsersHydrated();

  const result = await store.mutateMfaState(originalUser, {
    action: 'totp',
    mfa: nextUser.mfa,
  });

  assert.equal(result.source, 'supabase');
  assert.equal(result.user.mfa.lastTotpCounter, 101);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'softora_mutate_premium_mfa_state');
  assert.equal(rpcCalls[0].args.p_expected_auth_version, 4);
  assert.equal(rpcCalls[0].args.p_expected_last_totp_counter, 100);
  assert.equal(rpcCalls[0].args.p_action, 'totp');
});

test('premium users store treats a lost MFA compare-and-swap race as a hard conflict', async () => {
  const user = {
    id: 'usr_admin',
    email: 'admin@softora.nl',
    role: 'admin',
    status: 'active',
    passwordHash: 'sha256:test-only-hash',
    authVersion: 4,
    mfa: {
      enabled: true,
      encryptedSecret: 'v1.iv.tag.ciphertext',
      recoveryCodeHashes: ['hash-one'],
      lastTotpCounter: 100,
    },
  };
  let winnerChosen = false;
  const createConcurrentStore = () => createFixture({
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
                        payload: { version: 1, users: [user] },
                        updated_at: '2026-08-13T10:40:00.000Z',
                        revision: 7,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
      async rpc() {
        if (winnerChosen) return { data: { ok: false, reason: 'stale_state' }, error: null };
        winnerChosen = true;
        return {
          data: {
            ok: true,
            user: { ...user, mfa: { ...user.mfa, lastTotpCounter: 101 } },
            payload: { version: 1, users: [{ ...user, mfa: { ...user.mfa, lastTotpCounter: 101 } }] },
            revision: 8,
            updatedAt: '2026-08-13T10:41:00.000Z',
          },
          error: null,
        };
      },
    },
  });
  const first = createConcurrentStore();
  const second = createConcurrentStore();
  await Promise.all([first.ensureUsersHydrated(), second.ensureUsersHydrated()]);
  const nextMfa = { ...user.mfa, lastTotpCounter: 101 };

  const [firstResult, secondResult] = await Promise.all([
    first.mutateMfaState(user, { action: 'totp', mfa: nextMfa }),
    second.mutateMfaState(user, { action: 'totp', mfa: nextMfa }),
  ]);

  assert.deepEqual([firstResult.source, secondResult.source].sort(), ['conflict', 'supabase']);
  assert.equal(secondResult.user, null);
});

test('premium users store requires the exact read revision for non-MFA writes', async () => {
  const rpcCalls = [];
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
                        payload: {
                          version: 1,
                          users: [{
                            id: 'usr_admin',
                            email: 'admin@softora.nl',
                            role: 'admin',
                            status: 'active',
                            passwordHash: 'sha256:test-only-hash',
                          }],
                        },
                        updated_at: '2026-08-13T10:40:00.000Z',
                        revision: 12,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return { data: { ok: false, reason: 'state_conflict', revision: 13 }, error: null };
      },
    },
  });
  const hydrated = await store.ensureUsersHydrated();
  assert.equal(hydrated.revision, 12);

  const missingRevision = await store.persistUsersCollection(hydrated.users, {});
  const staleRevision = await store.persistUsersCollection(hydrated.users, {
    expectedRevision: hydrated.revision,
  });

  assert.equal(missingRevision.source, 'conflict');
  assert.equal(missingRevision.reason, 'revision_unknown');
  assert.equal(staleRevision.source, 'conflict');
  assert.equal(staleRevision.revision, 13);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].args.p_expected_revision, 12);
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

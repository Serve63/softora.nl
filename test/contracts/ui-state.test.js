const test = require('node:test');
const assert = require('node:assert/strict');

const { createUiStateStore } = require('../../server/services/ui-state');

const COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';

function createFixture(overrides = {}) {
  const inMemoryUiStateByScope = new Map();
  const loggerErrors = [];
  const loggerInfos = [];
  const restReads = [];
  const restWrites = [];

  const store = createUiStateStore({
    uiStateScopePrefix: 'ui_state:',
    inMemoryUiStateByScope,
    isSupabaseConfigured: () =>
      overrides.isSupabaseConfigured === undefined ? true : Boolean(overrides.isSupabaseConfigured),
    getSupabaseClient: () => overrides.client || null,
    supabaseStateTable: 'app_state',
    uiStateReadTimeoutMs: overrides.uiStateReadTimeoutMs,
    uiStateReadTimeoutMsByScope: overrides.uiStateReadTimeoutMsByScope,
    uiStateReadFailureCooldownMs: overrides.uiStateReadFailureCooldownMs,
    uiStateAllowMemoryFallback: overrides.uiStateAllowMemoryFallback,
    uiStateMemoryFallbackScopes: overrides.uiStateMemoryFallbackScopes,
    fetchSupabaseRowByKeyViaRest: async (rowKey, columns) => {
      restReads.push({ rowKey, columns });
      if (overrides.fetchResult && typeof overrides.fetchResult.then === 'function') {
        return overrides.fetchResult;
      }
      return overrides.fetchResult || { ok: true, body: null };
    },
    upsertSupabaseRowViaRest: async (row) => {
      restWrites.push(row);
      return overrides.upsertResult || { ok: true, body: row };
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    logger: {
      error: (...args) => loggerErrors.push(args),
      info: (...args) => loggerInfos.push(args),
    },
  });

  return {
    inMemoryUiStateByScope,
    loggerErrors,
    loggerInfos,
    restReads,
    restWrites,
    store,
  };
}

test('ui-state store normalizes scopes and sanitizes values', () => {
  const { store } = createFixture({ isSupabaseConfigured: false });

  assert.equal(store.normalizeUiStateScope(' Orders_Tab '), 'orders_tab');
  assert.equal(store.normalizeUiStateScope('../bad'), '');
  assert.deepEqual(store.sanitizeUiStateValues({ ok: 'yes', empty: null, skip: undefined }), {
    ok: 'yes',
    empty: '',
  });
});

test('ui-state store keeps large coldmail send guard values intact while sanitizing', () => {
  const { store } = createFixture({ isSupabaseConfigured: false });
  const largeGuard = JSON.stringify({
    entries: [],
    recipientEntries: Array.from({ length: 1200 }, (_, index) => ({
      at: '2026-05-31T13:10:00.000Z',
      recipientEmail: `lead-${index}@example.test`,
      recipientKey: `email:lead-${index}@example.test`,
      recipientCompany: `Company ${index}`,
      permanent: true,
      provider: 'instantly',
      source: 'instantly-import',
      reason: 'Permanent Instantly guard that must not be truncated.',
    })),
  });

  assert.ok(largeGuard.length > 200000);
  const sanitized = store.sanitizeUiStateValues({
    [COLDMAIL_SEND_GUARD_KEY]: largeGuard,
    default_limit: 'x'.repeat(250000),
  });

  assert.equal(sanitized[COLDMAIL_SEND_GUARD_KEY].length, largeGuard.length);
  assert.equal(sanitized.default_limit.length, 200000);
});

test('ui-state store reads values through REST fallback when client is unavailable', async () => {
  const { inMemoryUiStateByScope, restReads, store } = createFixture({
    fetchResult: {
      ok: true,
      body: {
        payload: {
          values: {
            panel: 'overview',
            nullable: null,
          },
        },
        updated_at: '2026-04-07T12:00:00.000Z',
      },
    },
  });

  const state = await store.getUiStateValues('dashboard');

  assert.deepEqual(restReads[0], {
    rowKey: 'ui_state:dashboard',
    columns: 'payload,updated_at',
  });
  assert.deepEqual(state, {
    values: {
      panel: 'overview',
      nullable: '',
    },
    updatedAt: '2026-04-07T12:00:00.000Z',
    source: 'supabase',
  });
  assert.deepEqual(inMemoryUiStateByScope.get('dashboard'), {
    panel: 'overview',
    nullable: '',
  });
});

test('ui-state store writes values through REST fallback when client upsert fails', async () => {
  const failingClient = {
    from() {
      return {
        async upsert() {
          return { error: new Error('boom') };
        },
      };
    },
  };
  const { inMemoryUiStateByScope, restWrites, store } = createFixture({
    client: failingClient,
  });

  const state = await store.setUiStateValues(
    'dashboard',
    { panel: 'overview', nullable: null },
    { source: 'frontend', actor: 'serve' }
  );

  assert.equal(restWrites.length, 1);
  assert.equal(restWrites[0].state_key, 'ui_state:dashboard');
  assert.deepEqual(restWrites[0].payload.values, {
    panel: 'overview',
    nullable: '',
  });
  assert.equal(restWrites[0].meta.actor, 'serve');
  assert.equal(state.source, 'supabase');
  assert.deepEqual(inMemoryUiStateByScope.get('dashboard'), {
    panel: 'overview',
    nullable: '',
  });
});

test('ui-state store merges live coldmail send guards before saving stale state', async () => {
  const existingInstantlyGuard = {
    at: '2026-05-31T13:10:00.000Z',
    recipientKey: 'email:old-instantly@example.test',
    recipientEmail: 'old-instantly@example.test',
    recipientCompany: 'Old Instantly Company',
    permanent: true,
    provider: 'instantly',
    source: 'instantly-import',
  };
  const newSendGuard = {
    at: '2026-06-01T11:08:36.049Z',
    senderEmail: 'servec321@gmail.com',
    recipientKey: 'email:new-softora@example.test',
    recipientEmail: 'new-softora@example.test',
    recipientCompany: 'New Softora Company',
  };
  const upserts = [];
  const client = {
    from(table) {
      assert.equal(table, 'app_state');
      return {
        select(columns) {
          assert.equal(columns, 'payload');
          return {
            eq(column, value) {
              assert.equal(column, 'state_key');
              assert.equal(value, 'ui_state:premium_coldmail_send_guard');
              return {
                async maybeSingle() {
                  return {
                    data: {
                      payload: {
                        values: {
                          [COLDMAIL_SEND_GUARD_KEY]: JSON.stringify({
                            entries: [],
                            recipientEntries: [existingInstantlyGuard],
                          }),
                        },
                      },
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        async upsert(row) {
          upserts.push(row);
          return { error: null };
        },
      };
    },
  };
  const { store } = createFixture({ client });

  await store.setUiStateValues(
    'premium_coldmail_send_guard',
    {
      [COLDMAIL_SEND_GUARD_KEY]: JSON.stringify({
        entries: [newSendGuard],
        recipientEntries: [newSendGuard],
      }),
    },
    { source: 'coldmail-send-guard' }
  );

  assert.equal(upserts.length, 1);
  const saved = JSON.parse(upserts[0].payload.values[COLDMAIL_SEND_GUARD_KEY]);
  assert.equal(
    saved.recipientEntries.some(
      (entry) =>
        entry.recipientEmail === 'old-instantly@example.test' &&
        entry.permanent === true &&
        entry.provider === 'instantly'
    ),
    true
  );
  assert.equal(
    saved.recipientEntries.some((entry) => entry.recipientEmail === 'new-softora@example.test'),
    true
  );
});

test('ui-state store reads values through REST fallback when client read crashes', async () => {
  const crashingClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  throw new Error('client read explode');
                },
              };
            },
          };
        },
      };
    },
  };
  const { store } = createFixture({
    client: crashingClient,
    fetchResult: {
      ok: true,
      body: {
        payload: {
          values: {
            panel: 'fallback',
          },
        },
        updated_at: '2026-04-22T08:00:00.000Z',
      },
    },
  });

  const state = await store.getUiStateValues('dashboard');

  assert.deepEqual(state, {
    values: { panel: 'fallback' },
    updatedAt: '2026-04-22T08:00:00.000Z',
    source: 'supabase',
  });
});

test('ui-state store logs read timeouts as soft fallback instead of hard errors', async () => {
  const timeoutClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  const error = new Error('Supabase client timeout na 12s');
                  error.name = 'AbortError';
                  throw error;
                },
              };
            },
          };
        },
      };
    },
  };
  const { loggerErrors, loggerInfos, store } = createFixture({
    client: timeoutClient,
    fetchResult: {
      ok: false,
      error: 'Supabase REST timeout na 12s',
    },
  });

  const state = await store.getUiStateValues('dashboard');

  assert.equal(state, null);
  assert.equal(
    loggerInfos.some((args) => args[0] === '[UI State][Supabase][GetSoftError]'),
    true
  );
  assert.equal(
    loggerErrors.some((args) => args[0] === '[UI State][Supabase][GetError]'),
    false
  );
});

test('ui-state store writes values through REST fallback when client upsert crashes', async () => {
  const crashingClient = {
    from() {
      return {
        async upsert() {
          throw new Error('client write explode');
        },
      };
    },
  };
  const { restWrites, store } = createFixture({
    client: crashingClient,
  });

  const state = await store.setUiStateValues('dashboard', { panel: 'overview' }, { source: 'frontend' });

  assert.equal(restWrites.length, 1);
  assert.equal(restWrites[0].state_key, 'ui_state:dashboard');
  assert.equal(state.source, 'supabase');
});

test('ui-state store does not silently serve in-memory values when remote reads time out', async () => {
  const { inMemoryUiStateByScope, loggerErrors, loggerInfos, store } = createFixture({
    uiStateReadTimeoutMs: 5,
    fetchResult: new Promise(() => {}),
  });
  inMemoryUiStateByScope.set('dashboard', {
    panel: 'cached',
  });

  const state = await store.getUiStateValues('dashboard');

  assert.equal(state, null);
  assert.equal(
    loggerInfos.some((args) => args[0] === '[UI State][Supabase][GetTimeout]'),
    true
  );
  assert.equal(
    loggerErrors.some((args) => args[0] === '[UI State][Supabase][GetTimeout]'),
    false
  );
});

test('ui-state store only serves in-memory fallback for explicitly allowed scopes', async () => {
  const { inMemoryUiStateByScope, store } = createFixture({
    uiStateReadTimeoutMs: 5,
    uiStateMemoryFallbackScopes: ['dashboard'],
    fetchResult: new Promise(() => {}),
  });
  inMemoryUiStateByScope.set('dashboard', {
    panel: 'cached',
  });

  const state = await store.getUiStateValues('dashboard');

  assert.deepEqual(state, {
    values: { panel: 'cached' },
    updatedAt: null,
    source: 'memory',
  });
});

test('ui-state store opent na Supabase-timeout een scoped read-circuit zodat dezelfde scope niet blijft hameren', async () => {
  const { loggerInfos, restReads, store } = createFixture({
    uiStateReadTimeoutMs: 5,
    uiStateReadFailureCooldownMs: 1000,
    fetchResult: new Promise(() => {}),
  });

  const first = await store.getUiStateValues('dashboard');
  const second = await store.getUiStateValues('orders');
  const third = await store.getUiStateValues('dashboard');

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(third, null);
  assert.equal(restReads.length, 2);
  assert.deepEqual(
    restReads.map((entry) => entry.rowKey),
    ['ui_state:dashboard', 'ui_state:orders']
  );
  assert.equal(
    loggerInfos.some(
      (args) =>
        args[0] === '[UI State][Supabase][read-circuit-open]' &&
        args[1] === 'dashboard'
    ),
    true
  );
  assert.equal(
    loggerInfos.some(
      (args) =>
        args[0] === '[UI State][Supabase][read-circuit-skip]' &&
        args[1] === 'dashboard'
    ),
    true
  );
});

test('ui-state store laat een seo read-circuit premium database scopes niet blokkeren', async () => {
  let resolvePremiumRead;
  const { loggerInfos, restReads, store } = createFixture({
    uiStateReadTimeoutMs: 5,
    uiStateReadFailureCooldownMs: 1000,
    uiStateReadTimeoutMsByScope: {
      premium_customers_database: 50,
    },
    fetchResult: new Promise((resolve) => {
      resolvePremiumRead = resolve;
    }),
  });

  const seoState = await store.getUiStateValues('seo');
  resolvePremiumRead({
    ok: true,
    body: {
      payload: {
        values: {
          softora_customers_premium_v1: JSON.stringify([{ company: 'Softora' }]),
        },
      },
      updated_at: '2026-06-05T05:20:00.000Z',
    },
  });
  const premiumState = await store.getUiStateValues('premium_customers_database');

  assert.equal(seoState, null);
  assert.deepEqual(premiumState, {
    values: {
      softora_customers_premium_v1: JSON.stringify([{ company: 'Softora' }]),
    },
    updatedAt: '2026-06-05T05:20:00.000Z',
    source: 'supabase',
  });
  assert.deepEqual(
    restReads.map((entry) => entry.rowKey),
    ['ui_state:seo', 'ui_state:premium_customers_database']
  );
  assert.equal(
    loggerInfos.some(
      (args) =>
        args[0] === '[UI State][Supabase][read-circuit-open]' &&
        args[1] === 'seo'
    ),
    true
  );
  assert.equal(
    loggerInfos.some(
      (args) =>
        args[0] === '[UI State][Supabase][read-circuit-skip]' &&
        args[1] === 'premium_customers_database'
    ),
    false
  );
});

test('ui-state store supports a longer read timeout for heavy photo scopes', async () => {
  const { store } = createFixture({
    uiStateReadTimeoutMs: 1,
    uiStateReadTimeoutMsByScope: {
      premium_database_photos: 30,
    },
    fetchResult: new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: true,
          body: {
            payload: {
              values: {
                photos: 'saved',
              },
            },
            updated_at: '2026-04-28T12:00:00.000Z',
          },
        });
      }, 8);
    }),
  });

  const state = await store.getUiStateValues('premium_database_photos');

  assert.deepEqual(state, {
    values: { photos: 'saved' },
    updatedAt: '2026-04-28T12:00:00.000Z',
    source: 'supabase',
  });
});

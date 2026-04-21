const test = require('node:test');
const assert = require('node:assert/strict');

const { createUiStateStore } = require('../../server/services/ui-state');

function createFixture(overrides = {}) {
  const inMemoryUiStateByScope = new Map();
  const loggerCalls = [];
  const restReads = [];
  const restWrites = [];

  const store = createUiStateStore({
    uiStateScopePrefix: 'ui_state:',
    inMemoryUiStateByScope,
    isSupabaseConfigured: () =>
      overrides.isSupabaseConfigured === undefined ? true : Boolean(overrides.isSupabaseConfigured),
    getSupabaseClient: () => overrides.client || null,
    supabaseStateTable: 'app_state',
    fetchSupabaseRowByKeyViaRest: async (rowKey, columns) => {
      restReads.push({ rowKey, columns });
      return overrides.fetchResult || { ok: true, body: null };
    },
    upsertSupabaseRowViaRest: async (row) => {
      restWrites.push(row);
      return overrides.upsertResult || { ok: true, body: row };
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    logger: {
      error: (...args) => loggerCalls.push(args),
    },
  });

  return {
    inMemoryUiStateByScope,
    loggerCalls,
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

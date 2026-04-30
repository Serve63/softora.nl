const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KEYS,
  SCOPES,
  createSoftoraDataOpsUiStateBridge,
} = require('../../server/services/data-ops-ui-state-bridge');
const { buildChunkedStatePatch } = require('../../server/services/data-ops-serialization');

function createStore(overrides = {}) {
  const calls = [];
  return {
    calls,
    listCustomers: overrides.listCustomers || (async () => []),
    replaceCustomers: overrides.replaceCustomers || (async (customers, meta) => {
      calls.push({ type: 'customers', customers, meta });
      return { ok: true };
    }),
    listActiveOrders: overrides.listActiveOrders || (async () => []),
    replaceActiveOrders: overrides.replaceActiveOrders || (async (orders, meta) => {
      calls.push({ type: 'orders', orders, meta });
      return { ok: true };
    }),
    listOrderRuntime: overrides.listOrderRuntime || (async () => ({})),
    replaceOrderRuntime: overrides.replaceOrderRuntime || (async (runtime, meta) => {
      calls.push({ type: 'runtime', runtime, meta });
      return { ok: true };
    }),
    listDesignPhotosWithDataUrls: overrides.listDesignPhotosWithDataUrls || (async () => []),
    replaceDesignPhotos: overrides.replaceDesignPhotos || (async (entries, meta) => {
      calls.push({ type: 'photos', entries, meta });
      return { ok: true };
    }),
  };
}

test('data ops ui-state bridge reads customers in the legacy chunked shape', async () => {
  const store = createStore({
    listCustomers: async () => [{ id: 'cust-1', bedrijf: 'Softora' }],
  });
  const bridge = createSoftoraDataOpsUiStateBridge({ store });

  const state = await bridge.getUiStateValues(SCOPES.customers, {
    legacyGetUiStateValues: async () => ({ values: { legacy: 'yes' }, source: 'legacy' }),
  });

  assert.equal(state.source, 'supabase:data_ops');
  assert.match(state.values[KEYS.customers], /Softora/);
});

test('data ops ui-state bridge falls back when structured customer rows are empty', async () => {
  const bridge = createSoftoraDataOpsUiStateBridge({ store: createStore() });
  const state = await bridge.getUiStateValues(SCOPES.customers, {
    legacyGetUiStateValues: async () => ({ values: { legacy: 'yes' }, source: 'legacy' }),
  });

  assert.deepEqual(state, { values: { legacy: 'yes' }, source: 'legacy' });
});

test('data ops ui-state bridge dual-writes customer and active order values', async () => {
  const store = createStore();
  const bridge = createSoftoraDataOpsUiStateBridge({ store });

  await bridge.setUiStateValues(
    SCOPES.customers,
    buildChunkedStatePatch(KEYS.customers, JSON.stringify([{ id: 'cust-1', bedrijf: 'Softora' }])),
    { source: 'premium-klanten' }
  );
  await bridge.setUiStateValues(
    SCOPES.activeOrders,
    {
      ...buildChunkedStatePatch(KEYS.activeOrders, JSON.stringify([{ id: 7, title: 'Website' }])),
      [KEYS.orderRuntime]: JSON.stringify({ 7: { statusKey: 'running', progressPct: 40 } }),
    },
    { source: 'premium-actieve-opdrachten' }
  );

  assert.equal(store.calls[0].type, 'customers');
  assert.equal(store.calls[0].customers[0].bedrijf, 'Softora');
  assert.equal(store.calls[1].type, 'orders');
  assert.equal(store.calls[1].orders[0].title, 'Website');
  assert.equal(store.calls[2].type, 'runtime');
  assert.equal(store.calls[2].runtime['7'].statusKey, 'running');
});

test('data ops ui-state bridge stores photo chunks as structured photo entries', async () => {
  const store = createStore();
  const bridge = createSoftoraDataOpsUiStateBridge({ store });
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const photoKey = 'softora_database_photo_data_v1_cust_1';

  const state = await bridge.setUiStateValues(
    SCOPES.photos,
    {
      [KEYS.photos]: JSON.stringify({
        'cust-1': {
          id: 'cust-1',
          photoKey,
          chunkCount: 1,
          websitePhotoName: 'demo.png',
        },
      }),
      [`${photoKey}_0`]: dataUrl,
    },
    { source: 'premium-database-photos' }
  );

  assert.equal(state.source, 'supabase:data_ops');
  assert.equal(store.calls[0].type, 'photos');
  assert.equal(store.calls[0].entries[0].customerId, 'cust-1');
  assert.equal(store.calls[0].entries[0].dataUrl, dataUrl);
});

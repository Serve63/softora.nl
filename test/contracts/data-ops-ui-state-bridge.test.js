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
      calls.push({ type: 'photos-replace', entries, meta });
      return { ok: true };
    }),
    upsertDesignPhotos: overrides.upsertDesignPhotos || (async (entries, meta) => {
      calls.push({ type: 'photos-upsert', entries, meta });
      return { ok: true };
    }),
    deleteDesignPhotos: overrides.deleteDesignPhotos || (async (customerIds, meta) => {
      calls.push({ type: 'photos-delete', customerIds, meta });
      return { ok: true };
    }),
    ...(overrides.listDesignPhotosWithSignedUrls
      ? { listDesignPhotosWithSignedUrls: overrides.listDesignPhotosWithSignedUrls }
      : {}),
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

test('data ops ui-state bridge overlays legacy mailed status onto structured customers', async () => {
  const bridge = createSoftoraDataOpsUiStateBridge({
    store: createStore({
      listCustomers: async () => [
        {
          id: 'jaghthuijs',
          bedrijf: 'Jaghthuijs',
          naam: 'Jaghthuijs',
          telefoon: '076 56 56 956',
          status: 'benaderbaar',
          databaseStatus: 'benaderbaar',
        },
        {
          id: 'klant-1',
          bedrijf: 'Klant BV',
          naam: 'Klant BV',
          telefoon: '0612345678',
          status: 'klant',
          databaseStatus: 'klant',
        },
      ],
    }),
  });
  const legacyRows = [
    {
      id: 'jaghthuijs',
      bedrijf: 'Jaghthuijs',
      naam: 'Jaghthuijs',
      telefoon: '076 56 56 956',
      status: 'gemaild',
      databaseStatus: 'gemaild',
      lastColdmailSentAt: '2026-05-19T17:02:00.000Z',
      coldmailSentMessageId: 'message-1',
      hist: [{ type: 'gemaild', label: 'Mail verstuurd', date: '2026-05-19' }],
    },
    {
      id: 'klant-1',
      bedrijf: 'Klant BV',
      naam: 'Klant BV',
      telefoon: '0612345678',
      status: 'gemaild',
      databaseStatus: 'gemaild',
      lastColdmailSentAt: '2026-05-19T17:02:00.000Z',
    },
  ];
  const state = await bridge.getUiStateValues(SCOPES.customers, {
    legacyGetUiStateValues: async () => ({
      values: buildChunkedStatePatch(KEYS.customers, JSON.stringify(legacyRows)),
      source: 'legacy',
    }),
  });
  const rows = JSON.parse(state.values[KEYS.customers]);

  assert.equal(rows[0].status, 'gemaild');
  assert.equal(rows[0].databaseStatus, 'gemaild');
  assert.equal(rows[0].lastColdmailSentAt, '2026-05-19T17:02:00.000Z');
  assert.equal(rows[0].hist[0].type, 'gemaild');
  assert.equal(rows[1].status, 'klant');
  assert.equal(rows[1].databaseStatus, 'klant');
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
  const mockupDataUrl = 'data:image/jpeg;base64,bW9ja3Vw';
  const photoKey = 'softora_database_photo_data_v1_cust_1';
  const mockupPhotoKey = 'softora_database_photo_data_v1_cust_1_mockup';

  const state = await bridge.setUiStateValues(
    SCOPES.photos,
    {
      [KEYS.photos]: JSON.stringify({
        'cust-1': {
          id: 'cust-1',
          photoKey,
          chunkCount: 1,
          websitePhotoName: 'demo.png',
          mockupPhotoKey,
          mockupChunkCount: 1,
          websiteMockupName: 'demo mockup.jpg',
        },
      }),
      [`${photoKey}_0`]: dataUrl,
      [`${mockupPhotoKey}_0`]: mockupDataUrl,
    },
    { source: 'premium-database-photos' }
  );

  assert.equal(state.source, 'supabase:data_ops');
  assert.equal(store.calls[0].type, 'photos-upsert');
  assert.equal(store.calls[0].entries[0].customerId, 'cust-1');
  assert.equal(store.calls[0].entries[0].dataUrl, dataUrl);
  assert.equal(store.calls[0].entries[0].websiteMockup, mockupDataUrl);
  assert.equal(store.calls[0].entries[0].websiteMockupName, 'demo mockup.jpg');
});

test('data ops ui-state bridge reads photo rows as signed URLs without embedding image data', async () => {
  const signedUrl = 'https://example.supabase.co/storage/v1/object/sign/softora-design-photos/demo.png?token=test';
  const mockupSignedUrl = 'https://example.supabase.co/storage/v1/object/sign/softora-design-photos/demo-mockup.jpg?token=test';
  const bridge = createSoftoraDataOpsUiStateBridge({
    store: createStore({
      listDesignPhotosWithSignedUrls: async () => [
        {
          customerId: 'cust-1',
          identityKey: 'softora||0612345678',
          websitePhotoUrl: signedUrl,
          websiteMockupUrl: mockupSignedUrl,
          storageBucket: 'softora-design-photos',
          storagePath: 'customers/cust-1/demo.png',
          fileName: 'demo.png',
          websiteMockupName: 'demo mockup.jpg',
          updatedAt: '2026-05-05T12:00:00.000Z',
        },
      ],
    }),
  });

  const state = await bridge.getUiStateValues(SCOPES.photos, {
    legacyGetUiStateValues: async () => ({ values: { legacy: 'stale-photo-state' }, source: 'legacy' }),
  });
  const photoMap = JSON.parse(state.values[KEYS.photos]);

  assert.equal(state.source, 'supabase:data_ops');
  assert.equal(photoMap['cust-1'].websitePhotoUrl, signedUrl);
  assert.equal(photoMap['cust-1'].websiteMockupUrl, mockupSignedUrl);
  assert.equal(photoMap['cust-1'].websiteMockupName, 'demo mockup.jpg');
  assert.equal(photoMap['cust-1'].chunkCount, 0);
  assert.equal(state.values.softora_database_photo_data_v1_cust_1_0, undefined);
});

test('data ops ui-state bridge upserts partial photo saves instead of replacing all photos', async () => {
  const store = createStore({
    replaceDesignPhotos: async () => {
      throw new Error('replaceDesignPhotos should not be used for partial photo saves');
    },
  });
  const bridge = createSoftoraDataOpsUiStateBridge({ store });
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const photoKey = 'softora_database_photo_data_v1_cust_2';

  await bridge.setUiStateValues(
    SCOPES.photos,
    {
      [KEYS.photos]: JSON.stringify({
        'cust-2': {
          id: 'cust-2',
          photoKey,
          chunkCount: 1,
          websitePhotoName: 'demo.png',
        },
      }),
      [`${photoKey}_0`]: dataUrl,
      [KEYS.photoRemovals]: JSON.stringify([]),
    },
    { source: 'premium-database-photos' }
  );

  assert.deepEqual(store.calls.map((call) => call.type), ['photos-upsert']);
  assert.equal(store.calls[0].entries[0].customerId, 'cust-2');
});

test('data ops ui-state bridge does not delete a photo that is saved again in the same state', async () => {
  const store = createStore({
    replaceDesignPhotos: async () => {
      throw new Error('replaceDesignPhotos should not be used for regenerated photos');
    },
  });
  const bridge = createSoftoraDataOpsUiStateBridge({ store });
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const photoKey = 'softora_database_photo_data_v1_cust_1';

  await bridge.setUiStateValues(
    SCOPES.photos,
    {
      [KEYS.photos]: JSON.stringify({
        'cust-1': {
          id: 'cust-1',
          photoKey,
          chunkCount: 1,
          websitePhotoName: 'regenerated.png',
        },
      }),
      [`${photoKey}_0`]: dataUrl,
      [KEYS.photoRemovals]: JSON.stringify(['cust-1']),
    },
    { source: 'premium-database-webdesign-jobs' }
  );

  assert.deepEqual(store.calls.map((call) => call.type), ['photos-upsert']);
  assert.equal(store.calls[0].entries[0].customerId, 'cust-1');
});

test('data ops ui-state bridge deletes only explicitly removed photo ids', async () => {
  const store = createStore({
    replaceDesignPhotos: async () => {
      throw new Error('replaceDesignPhotos should not be used for photo removals');
    },
  });
  const bridge = createSoftoraDataOpsUiStateBridge({ store });

  await bridge.setUiStateValues(
    SCOPES.photos,
    {
      [KEYS.photos]: JSON.stringify({}),
      [KEYS.photoRemovals]: JSON.stringify(['cust-1']),
    },
    { source: 'premium-database-photos' }
  );

  assert.deepEqual(store.calls.map((call) => call.type), ['photos-delete']);
  assert.deepEqual(store.calls[0].customerIds, ['cust-1']);
});

test('data ops ui-state bridge does not fall back to stale legacy photos when structured rows exist', async () => {
  const emptyStructuredRows = [];
  Object.defineProperty(emptyStructuredRows, 'hadStructuredRows', {
    enumerable: false,
    value: true,
  });
  const bridge = createSoftoraDataOpsUiStateBridge({
    store: createStore({
      listDesignPhotosWithDataUrls: async () => emptyStructuredRows,
    }),
  });

  const state = await bridge.getUiStateValues(SCOPES.photos, {
    legacyGetUiStateValues: async () => ({ values: { legacy: 'stale-photo-state' }, source: 'legacy' }),
  });

  assert.equal(state.source, 'supabase:data_ops');
  assert.equal(state.values[KEYS.photos], '{}');
  assert.equal(state.values.legacy, undefined);
});

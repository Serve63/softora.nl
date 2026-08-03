const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createKvkDatabaseSnapshotService,
} = require('../../server/services/kvk-database-snapshot');

function createJsonResponse() {
  return {
    statusCode: null,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createSnapshot() {
  return {
    generatedAt: '2026-06-18T10:00:00+02:00',
    source: 'test',
    state: {
      companies_found: 100,
      with_website: 4,
      without_website: 2,
      unusable: 3,
    },
    locations: [],
    companyTotals: {
      all: 100,
      usable: 6,
      with_website: 4,
      without_website: 2,
      unusable: 3,
    },
    companies: {
      all: [],
      usable: [],
      withWebsite: [],
      withoutWebsite: [],
      unusable: [],
    },
  };
}

test('kvk database snapshot service stores token-protected snapshots with a summary', async () => {
  const snapshot = createSnapshot();
  let savedRow = null;
  let savedOptions = null;
  const service = createKvkDatabaseSnapshotService({
    supabaseStateKey: 'softora',
    kvkDatabaseSyncToken: 'secret-token',
    fetchSupabaseRowByKeyViaRest: async () => ({ ok: true, body: null }),
    upsertSupabaseRowViaRest: async (row, options) => {
      savedRow = row;
      savedOptions = options;
      return { ok: true };
    },
    now: () => new Date('2026-06-18T08:00:00.000Z'),
  });
  const response = createJsonResponse();

  await service.sendPostSnapshotResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: { snapshot },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.summary.companiesFound, 100);
  assert.equal(response.payload.summary.successfulFound, 6);
  assert.equal(response.payload.summary.usable, 6);
  assert.equal(response.payload.summary.withWebsite, 4);
  assert.equal(response.payload.summary.withoutWebsite, 2);
  assert.equal(response.payload.summary.unusable, 3);
  assert.equal(savedRow.state_key, 'softora:kvk_database_snapshot_v1');
  assert.deepEqual(savedRow.payload.snapshot, {
    ...snapshot,
    state: { ...snapshot.state, successful_found: 6 },
  });
  assert.deepEqual(savedRow.payload.successfulFoundTracker, { total: 6, currentUsable: 6 });
  assert.equal(savedOptions.timeoutMs, 30000);
  assert.equal(savedOptions.ignoreFailureCooldown, true);
  assert.equal(savedOptions.suppressFailureCooldown, true);
});

test('kvk database snapshot service rejects sync posts without a valid token', async () => {
  const service = createKvkDatabaseSnapshotService({
    kvkDatabaseSyncToken: 'secret-token',
  });
  const response = createJsonResponse();

  await service.sendPostSnapshotResponse(
    {
      headers: { authorization: 'Bearer wrong-token' },
      body: { snapshot: createSnapshot() },
    },
    response
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.ok, false);
});

test('kvk database snapshot service reads stored snapshots from Supabase REST rows', async () => {
  const snapshot = createSnapshot();
  let readOptions = null;
  const service = createKvkDatabaseSnapshotService({
    fetchSupabaseRowByKeyViaRest: async (_rowKey, _columns, options) => {
      readOptions = options;
      return {
        ok: true,
        body: {
          payload: {
            snapshot,
            updatedAt: '2026-06-18T08:00:00.000Z',
          },
          updated_at: '2026-06-18T08:00:00.000Z',
        },
      };
    },
  });
  const response = createJsonResponse();

  await service.sendGetSnapshotResponse({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.updatedAt, '2026-06-18T08:00:00.000Z');
  assert.equal(response.payload.summary.successfulFound, 6);
  assert.deepEqual(response.payload.snapshot, {
    ...snapshot,
    state: { ...snapshot.state, successful_found: 6 },
  });
  assert.equal(readOptions.timeoutMs, 15000);
  assert.equal(readOptions.ignoreFailureCooldown, true);
  assert.equal(readOptions.suppressFailureCooldown, true);
});

test('kvk database snapshot service allows custom storage timeouts for live sync', async () => {
  const snapshot = createSnapshot();
  let savedOptions = null;
  const service = createKvkDatabaseSnapshotService({
    kvkDatabaseSyncToken: 'secret-token',
    snapshotWriteTimeoutMs: 45000,
    fetchSupabaseRowByKeyViaRest: async () => ({ ok: true, body: null }),
    upsertSupabaseRowViaRest: async (_row, options) => {
      savedOptions = options;
      return { ok: true };
    },
  });
  const response = createJsonResponse();

  await service.sendPostSnapshotResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: { snapshot },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(savedOptions.timeoutMs, 45000);
  assert.equal(savedOptions.ignoreFailureCooldown, true);
  assert.equal(savedOptions.suppressFailureCooldown, true);
});

test('kvk database snapshot service keeps successful found across a usable reset and counts later growth', async () => {
  let storedRow = {
    payload: {
      snapshot: createSnapshot(),
      summary: { successfulFound: 6, usable: 6 },
    },
  };
  const service = createKvkDatabaseSnapshotService({
    kvkDatabaseSyncToken: 'secret-token',
    fetchSupabaseRowByKeyViaRest: async () => ({ ok: true, body: storedRow }),
    upsertSupabaseRowViaRest: async (row) => {
      storedRow = row;
      return { ok: true };
    },
  });

  const resetSnapshot = createSnapshot();
  resetSnapshot.state.with_website = 0;
  resetSnapshot.state.without_website = 0;
  resetSnapshot.companyTotals.usable = 0;
  resetSnapshot.companyTotals.with_website = 0;
  resetSnapshot.companyTotals.without_website = 0;
  const resetResponse = createJsonResponse();
  await service.sendPostSnapshotResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: { snapshot: resetSnapshot },
    },
    resetResponse
  );

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(resetResponse.payload.summary.successfulFound, 6);
  assert.equal(resetResponse.payload.summary.usable, 0);
  assert.deepEqual(storedRow.payload.successfulFoundTracker, { total: 6, currentUsable: 0 });

  const laterSnapshot = createSnapshot();
  laterSnapshot.state.with_website = 1;
  laterSnapshot.state.without_website = 1;
  laterSnapshot.companyTotals.usable = 2;
  laterSnapshot.companyTotals.with_website = 1;
  laterSnapshot.companyTotals.without_website = 1;
  const laterResponse = createJsonResponse();
  await service.sendPostSnapshotResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: { snapshot: laterSnapshot },
    },
    laterResponse
  );

  assert.equal(laterResponse.statusCode, 200);
  assert.equal(laterResponse.payload.summary.successfulFound, 8);
  assert.equal(laterResponse.payload.summary.usable, 2);
  assert.deepEqual(storedRow.payload.successfulFoundTracker, { total: 8, currentUsable: 2 });
});

test('kvk database snapshot service never overwrites its cumulative counter when the prior read fails', async () => {
  let writes = 0;
  const service = createKvkDatabaseSnapshotService({
    kvkDatabaseSyncToken: 'secret-token',
    fetchSupabaseRowByKeyViaRest: async () => ({ ok: false, error: 'tijdelijke leesfout' }),
    upsertSupabaseRowViaRest: async () => {
      writes += 1;
      return { ok: true };
    },
  });
  const response = createJsonResponse();

  await service.sendPostSnapshotResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: { snapshot: createSnapshot() },
    },
    response
  );

  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.ok, false);
  assert.equal(writes, 0);
});

test('kvk database snapshot service exposes compact usable totals per location', async () => {
  const snapshot = createSnapshot();
  snapshot.locations = [
    {
      woonplaatscode: 'WP0001',
      land: 'Nederland',
      provincie: 'Noord-Brabant',
      gemeente: 'Vught',
      woonplaats: 'Vught',
      inwoners: 33010,
      bruikbare_bedrijven: 321,
    },
  ];
  const service = createKvkDatabaseSnapshotService({
    fetchSupabaseRowByKeyViaRest: async () => ({
      ok: true,
      body: { payload: { snapshot } },
    }),
  });
  const response = createJsonResponse();

  await service.sendGetLocationStatsResponse({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.locations, [
    {
      woonplaatscode: 'WP0001',
      land: 'Nederland',
      provincie: 'Noord-Brabant',
      gemeente: 'Vught',
      woonplaats: 'Vught',
      bruikbareBedrijven: 321,
    },
  ]);
  assert.equal('inwoners' in response.payload.locations[0], false);
});

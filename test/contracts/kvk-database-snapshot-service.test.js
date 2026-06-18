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
  const service = createKvkDatabaseSnapshotService({
    supabaseStateKey: 'softora',
    kvkDatabaseSyncToken: 'secret-token',
    upsertSupabaseRowViaRest: async (row) => {
      savedRow = row;
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
  assert.equal(response.payload.summary.usable, 6);
  assert.equal(response.payload.summary.withWebsite, 4);
  assert.equal(response.payload.summary.withoutWebsite, 2);
  assert.equal(response.payload.summary.unusable, 3);
  assert.equal(savedRow.state_key, 'softora:kvk_database_snapshot_v1');
  assert.deepEqual(savedRow.payload.snapshot, snapshot);
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
  const service = createKvkDatabaseSnapshotService({
    fetchSupabaseRowByKeyViaRest: async () => ({
      ok: true,
      body: {
        payload: {
          snapshot,
          updatedAt: '2026-06-18T08:00:00.000Z',
        },
        updated_at: '2026-06-18T08:00:00.000Z',
      },
    }),
  });
  const response = createJsonResponse();

  await service.sendGetSnapshotResponse({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.updatedAt, '2026-06-18T08:00:00.000Z');
  assert.deepEqual(response.payload.snapshot, snapshot);
});

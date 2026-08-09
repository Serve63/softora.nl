const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SYNC_BATCH_SIZE,
  createKvkCompanyDirectoryService,
} = require('../../server/services/kvk-company-directory');

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

test('online KVK directory returns exact total and a stable keyset cursor', async () => {
  let readOptions = null;
  const service = createKvkCompanyDirectoryService({
    fetchDirectoryRows: async (options) => {
      readOptions = options;
      return {
        ok: true,
        rows: [
          { source_company_id: 201, bedrijfsnaam: 'Een B.V.', kvk_nummer: '12345678' },
          { source_company_id: 202, bedrijfsnaam: 'Twee B.V.', kvk_nummer: '87654321' },
          { source_company_id: 203, bedrijfsnaam: 'Drie B.V.', kvk_nummer: '11223344' },
        ],
      };
    },
    fetchDirectoryMeta: async () => ({
      ok: true,
      row: { total: 2_924_398, completed: true, updated_at: '2026-08-09T10:00:00.000Z' },
    }),
  });
  const response = createJsonResponse();

  await service.sendGetDirectoryResponse(
    { query: { q: '', after: '200', limit: '2' } },
    response
  );

  assert.deepEqual(readOptions, { query: '', cursor: 200, limit: 2 });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.total, 2_924_398);
  assert.equal(response.payload.rows.length, 2);
  assert.equal(response.payload.next_cursor, 202);
  assert.equal(response.payload.has_more, true);
  assert.equal(response.payload.total_is_exact, true);
});

test('online KVK directory stays unavailable until the full mirror is complete', async () => {
  const service = createKvkCompanyDirectoryService({
    fetchDirectoryRows: async () => ({ ok: true, rows: [] }),
    fetchDirectoryMeta: async () => ({ ok: true, row: { total: 100, completed: false } }),
  });
  const response = createJsonResponse();

  await service.sendGetDirectoryResponse({ query: {} }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.ok, false);
});

test('online KVK directory sync is token protected and normalizes its compact rows', async () => {
  let writtenRows = null;
  const service = createKvkCompanyDirectoryService({
    kvkDatabaseSyncToken: 'secret-token',
    now: () => new Date('2026-08-09T10:00:00.000Z'),
    upsertDirectoryRows: async (rows) => {
      writtenRows = rows;
      return { ok: true };
    },
  });
  const rejectedResponse = createJsonResponse();
  await service.sendPostDirectorySyncResponse(
    { headers: { authorization: 'Bearer wrong' }, body: {} },
    rejectedResponse
  );
  assert.equal(rejectedResponse.statusCode, 401);

  const response = createJsonResponse();
  await service.sendPostDirectorySyncResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: {
        generation: 'full-20260809',
        mode: 'full',
        rows: [
          {
            source_company_id: 42,
            kvk_nummer: ' 12345678 ',
            bedrijfsnaam: ' Café & Zoon B.V. ',
            email: ' INFO@CAFE.NL ',
            woonplaats: 'Haaren',
          },
        ],
      },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.accepted, 1);
  assert.equal(writtenRows[0].kvk_nummer, '12345678');
  assert.equal(writtenRows[0].bedrijfsnaam, 'Café & Zoon B.V.');
  assert.match(writtenRows[0].search_text, /cafe & zoon b\.v\./);
  assert.equal(writtenRows[0].sync_generation, 'full-20260809');
});

test('a completed full sync cleans stale rows before publishing exact metadata', async () => {
  const calls = [];
  const service = createKvkCompanyDirectoryService({
    kvkDatabaseSyncToken: 'secret-token',
    deleteStaleRows: async (generation) => {
      calls.push(['cleanup', generation]);
      return { ok: true };
    },
    upsertDirectoryMeta: async (meta) => {
      calls.push(['meta', meta]);
      return { ok: true };
    },
  });
  const response = createJsonResponse();

  await service.sendPostDirectorySyncResponse(
    {
      headers: { 'x-kvk-sync-token': 'secret-token' },
      body: {
        generation: 'full-20260809',
        mode: 'full',
        complete: true,
        total: 2_924_398,
        sourceUpdatedAt: '2026-08-09T09:55:00.000Z',
        rows: [],
      },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0], ['cleanup', 'full-20260809']);
  assert.deepEqual(calls[1], [
    'meta',
    {
      total: 2_924_398,
      completed: true,
      generation: 'full-20260809',
      sourceUpdatedAt: '2026-08-09T09:55:00.000Z',
    },
  ]);
});

test('online KVK directory refuses oversized sync batches', async () => {
  const service = createKvkCompanyDirectoryService({ kvkDatabaseSyncToken: 'secret-token' });
  const response = createJsonResponse();

  await service.sendPostDirectorySyncResponse(
    {
      headers: { authorization: 'Bearer secret-token' },
      body: {
        generation: 'full-20260809',
        rows: Array.from({ length: MAX_SYNC_BATCH_SIZE + 1 }, () => ({})),
      },
    },
    response
  );

  assert.equal(response.statusCode, 413);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DIRECTORY_CATEGORIES,
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

  assert.deepEqual(readOptions, { query: '', cursor: 200, limit: 2, category: 'all' });
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

test('online KVK directory does not turn a one-character search into an unfiltered list', async () => {
  let reads = 0;
  const service = createKvkCompanyDirectoryService({
    fetchDirectoryRows: async () => {
      reads += 1;
      return { ok: true, rows: [] };
    },
  });
  const response = createJsonResponse();

  await service.sendGetDirectoryResponse({ query: { q: 'a' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.total, 0);
  assert.equal(response.payload.has_more, false);
  assert.equal(reads, 0);
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
            unusable_review_grade: 8,
            premium_database_transferred: 1,
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
  assert.equal(writtenRows[0].unusable_review_grade, 3);
  assert.equal(writtenRows[0].premium_database_transferred, true);
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
        categoryTotals: { behandeld: 32_440, controle: 24_360 },
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
      categoryTotals: { behandeld: 32_440, controle: 24_360 },
    },
  ]);
});

test('online KVK directory applies one exact server-side category to rows and totals', async () => {
  let readOptions = null;
  const service = createKvkCompanyDirectoryService({
    fetchDirectoryRows: async (options) => {
      readOptions = options;
      return {
        ok: true,
        rows: [{ source_company_id: 301, bedrijfsnaam: 'Controle B.V.', kvk_nummer: '12345678' }],
      };
    },
    fetchDirectoryMeta: async () => ({
      ok: true,
      row: {
        total: 2_924_398,
        category_totals: { controle: 24_360, definitief: 960 },
        completed: true,
      },
    }),
  });
  const response = createJsonResponse();

  await service.sendGetDirectoryResponse(
    { query: { categorie: 'controle', after: '0', limit: '100' } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.category, DIRECTORY_CATEGORIES.controle);
  assert.equal(response.payload.total, 24_360);
  assert.deepEqual(readOptions, {
    query: '',
    cursor: 0,
    limit: 100,
    category: DIRECTORY_CATEGORIES.controle,
  });
});

test('online KVK directory never shows a false zero while category metadata is being built', async () => {
  const service = createKvkCompanyDirectoryService({
    fetchDirectoryRows: async () => ({ ok: true, rows: [] }),
    fetchDirectoryMeta: async () => ({
      ok: true,
      row: { total: 2_924_398, category_totals: {}, completed: true },
    }),
  });
  const response = createJsonResponse();

  await service.sendGetDirectoryResponse(
    { query: { categorie: 'bruikbaar' } },
    response
  );

  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.ok, false);
  assert.match(response.payload.error, /categorie wordt nog opgebouwd/i);
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

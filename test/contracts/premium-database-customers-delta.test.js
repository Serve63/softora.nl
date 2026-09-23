const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPremiumDatabaseCustomersDeltaResponder,
  CURSOR_OVERLAP_MS,
  DELTA_LIMIT,
} = require('../../server/services/premium-database-customers-delta');
const { createDataOpsCustomerLookups } = require('../../server/services/data-ops-customer-lookups');
const { registerPremiumDatabaseImportRoutes } = require('../../server/routes/premium-database-import');

const NOW = Date.parse('2026-09-23T21:00:00.000Z');
const CURSOR = '2026-09-23T20:00:00.000Z';

function createMockResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function createStore({ changes = [], metas = [{ total: 3, snapshotVersion: `3:${CURSOR}` }] } = {}) {
  const calls = { meta: 0, changed: [] };
  return {
    calls,
    async listCustomersPage(options) {
      assert.equal(options.metaOnly, true);
      const meta = metas[Math.min(calls.meta, metas.length - 1)];
      calls.meta += 1;
      return { customers: [], ...meta };
    },
    async listCustomersChangedSince(options) {
      calls.changed.push(options);
      return typeof changes === 'function' ? changes(options) : changes;
    },
  };
}

function createResponder(store) {
  return createPremiumDatabaseCustomersDeltaResponder({
    dataOpsStore: store, nowMs: () => NOW, logger: { info() {}, warn() {} },
  });
}

test('customer delta returns changed and deleted rows with the verified count and version', async () => {
  const store = createStore({ changes: [
    { id: 'new', deleted: false, customer: { id: 'new', bedrijf: 'Nieuw' } },
    { id: 'gone', deleted: true, customer: null },
    { id: 'edit', deleted: false, customer: { id: 'edit', bedrijf: 'Gewijzigd' } },
  ] });
  const response = createMockResponse();

  await createResponder(store)({ query: { since: CURSOR } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.deepEqual(response.body, {
    ok: true, source: 'canonical-customers-delta', completeDelta: true, total: 3,
    snapshotVersion: `3:${CURSOR}`,
    upserts: [{ id: 'new', bedrijf: 'Nieuw' }, { id: 'edit', bedrijf: 'Gewijzigd' }],
    deletedIds: ['gone'],
  });
  assert.equal(store.calls.meta, 2, 'the count and version are verified before and after reading changes');
  assert.equal(store.calls.changed[0].since, new Date(Date.parse(CURSOR) - CURSOR_OVERLAP_MS).toISOString());
  assert.equal(store.calls.changed[0].limit, DELTA_LIMIT + 1);
});

test('customer delta asks for a full archive when too many rows changed or the cursor is old', async () => {
  const tooMany = createStore({ changes: Array.from({ length: DELTA_LIMIT + 1 }, (_row, index) => ({
    id: `row-${index}`, deleted: false, customer: { id: `row-${index}` },
  })) });
  const manyResponse = createMockResponse();
  await createResponder(tooMany)({ query: { since: CURSOR } }, manyResponse);
  assert.deepEqual(manyResponse.body, { ok: true, resync: true, reason: 'too-many-changes' });

  const expired = createStore();
  const expiredResponse = createMockResponse();
  await createResponder(expired)({ query: { since: '2026-07-01T00:00:00.000Z' } }, expiredResponse);
  assert.deepEqual(expiredResponse.body, { ok: true, resync: true, reason: 'cursor-expired' });
  assert.equal(expired.calls.changed.length, 0);
});

test('customer delta rejects missing, malformed and future cursors', async () => {
  for (const since of ['', 'gisteren', '2026-09-24T00:00:00.000Z', 'x'.repeat(80)]) {
    const store = createStore();
    const response = createMockResponse();
    await createResponder(store)({ query: { since } }, response);
    assert.equal(response.statusCode, 400, since);
    assert.equal(store.calls.changed.length, 0);
  }
});

test('customer delta retries once when the database changes during the read and then fails closed', async () => {
  const settled = createStore({ changes: [], metas: [
    { total: 3, snapshotVersion: `3:${CURSOR}` },
    { total: 4, snapshotVersion: '4:2026-09-23T20:59:00.000Z' },
    { total: 4, snapshotVersion: '4:2026-09-23T20:59:00.000Z' },
  ] });
  const settledResponse = createMockResponse();
  await createResponder(settled)({ query: { since: CURSOR } }, settledResponse);
  assert.equal(settledResponse.statusCode, 200);
  assert.equal(settledResponse.body.total, 4);
  assert.equal(settled.calls.changed.length, 2);

  let version = 0;
  const moving = createStore({ changes: [] });
  moving.listCustomersPage = async () => { version += 1; return { total: 3, snapshotVersion: `3:v${version}` }; };
  const movingResponse = createMockResponse();
  await createResponder(moving)({ query: { since: CURSOR } }, movingResponse);
  assert.equal(movingResponse.statusCode, 503);
  assert.equal(movingResponse.body.ok, false);
});

test('customer delta fails closed on duplicate, empty or incomplete rows', async () => {
  const cases = [
    [{ id: 'dup', deleted: false, customer: { id: 'dup' } }, { id: 'dup', deleted: true, customer: null }],
    [{ id: '', deleted: true, customer: null }],
    [{ id: 'mismatch', deleted: false, customer: { id: 'other' } }],
  ];
  for (const changes of cases) {
    const response = createMockResponse();
    await createResponder(createStore({ changes }))({ query: { since: CURSOR } }, response);
    assert.equal(response.statusCode, 503);
  }
  const unreadable = createMockResponse();
  await createResponder(createStore({ changes: null }))({ query: { since: CURSOR } }, unreadable);
  assert.equal(unreadable.statusCode, 503);
});

test('customer delta route requires the premium access guard', () => {
  const routes = new Map();
  let deltaReads = 0;
  registerPremiumDatabaseImportRoutes({ post() {}, get(path, ...handlers) { routes.set(path, handlers); } }, {
    coordinator: {},
    customersPageCoordinator: { sendCustomersDeltaResponse() { deltaReads += 1; } },
    requirePremiumApiAccess(_req, res, next) {
      if (!res.allowed) return res.status(401).json({ ok: false });
      return next();
    },
  });
  const [guard, handler] = routes.get('/api/premium-database/customers/archive/delta');
  const denied = createMockResponse();
  guard({}, denied, () => handler({}, denied));
  assert.equal(denied.statusCode, 401);
  assert.equal(deltaReads, 0);
  const allowed = createMockResponse();
  allowed.allowed = true;
  guard({}, allowed, () => handler({}, allowed));
  assert.equal(deltaReads, 1);
});

test('customer change lookup reads soft-deleted rows by updated_at in archive order', async () => {
  const calls = [];
  const query = new Proxy({}, {
    get(_target, method) {
      return (...args) => { calls.push([method, ...args]); return query; };
    },
  });
  const lookups = createDataOpsCustomerLookups({
    tableName: 'softora_customers',
    cachedRead: async (_key, loader) => loader(),
    run: async (label, operation) => {
      assert.equal(label, 'list-customers-changed-since');
      operation({ from: (table) => { calls.push(['from', table]); return query; } });
      return { ok: true, data: [
        { customer_id: 'live', payload: { bedrijf: 'Live BV' }, updated_at: '2026-09-23T20:10:00Z', deleted_at: null },
        { customer_id: 'gone', payload: { bedrijf: 'Weg BV' }, updated_at: '2026-09-23T20:05:00Z', deleted_at: '2026-09-23T20:05:00Z' },
      ] };
    },
  });

  const rows = await lookups.listCustomersChangedSince({ since: '2026-09-23T19:50:00.000Z', limit: 5001 });

  assert.deepEqual(calls, [
    ['from', 'softora_customers'],
    ['select', 'customer_id,payload,updated_at,deleted_at'],
    ['gte', 'updated_at', '2026-09-23T19:50:00.000Z'],
    ['order', 'updated_at', { ascending: false }],
    ['order', 'customer_id', { ascending: true }],
    ['limit', 5001],
  ]);
  assert.equal(rows[0].id, 'live');
  assert.equal(rows[0].deleted, false);
  assert.equal(rows[0].customer.bedrijf, 'Live BV');
  assert.deepEqual(rows[1], { id: 'gone', deleted: true, updatedAt: '2026-09-23T20:05:00Z', customer: null });
  assert.equal(await lookups.listCustomersChangedSince({ since: 'nooit', limit: 10 }), null);
  assert.equal(await lookups.listCustomersChangedSince({ since: '2026-09-23T19:50:00.000Z', limit: 9000 }), null);
});

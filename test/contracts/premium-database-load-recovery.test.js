const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');
const { createPremiumDatabaseCustomersArchiveResponder } = require('../../server/services/premium-database-customers-archive');
const customersClient = require('../../assets/premium-database-customers-loader');

function response() {
  return { headers: {}, statusCode: 0, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; } };
}

function snapshotHarness() {
  const timers = new Map();
  let next = 0;
  const window = { console: { warn() {} }, setTimeout(fn) { timers.set(++next, fn); return next; },
    clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../assets/premium-database-mail-ready-snapshot'), 'utf8'), { window });
  const state = { klanten: [{ id: 'one' }], remoteCustomersLoaded: true, photoRestorePending: false,
    dataLoading: true, canonicalInventoryReady: false };
  let requests = 0, renders = 0, fail = true;
  const payload = { ok: true, snapshotVersion: 'stable-v1', generatedAt: '2026-10-09T17:00:00Z',
    customers: [], total: 0, availableCustomers: [{ id: 'one', availableSnapshot: true }], availableTotal: 1,
    instantlyReadyCustomers: [], instantlyReadyTotal: 0, foundCustomerIds: [], foundTotal: 0 };
  const options = { state, renderPage() { renders++; }, applyCustomerList(rows) { state.klanten = rows; },
    async fetchJsonWithTimeout() { requests++; if (fail) throw new Error('offline'); return { ok: true, json: async () => payload }; } };
  return { client: window.SoftoraDatabaseMailReadySnapshot, timers, state, options,
    recover() { fail = false; }, counts() { return { requests, renders }; } };
}

test('snapshot retry publishes recovered rows and clears the loading/failure state', async () => {
  const h = snapshotHarness();
  assert.equal(await h.client.loadAndPublish(h.options), false);
  assert.equal(h.state.dataUnavailable, true);
  assert.equal(h.state.dataLoading, false);
  h.state.photoRestoreFailed = true;
  h.recover();
  const [id, retry] = h.timers.entries().next().value;
  h.timers.delete(id);
  retry();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.canonicalInventoryReady, true);
  assert.equal(h.state.dataUnavailable, false);
  assert.equal(h.state.photoRestoreFailed, false);
  assert.equal(h.state.mailReadySnapshotPending, false);
  assert.equal(h.state.mailReadySnapshotRetryAttempt, 0);
  assert.equal(h.counts().renders, 2);
});

test('overlapping bulk refreshes share one load and one publication', async () => {
  const h = snapshotHarness();
  h.recover();
  const results = await Promise.all(Array.from({ length: 30 }, () => h.client.loadAndPublish(h.options)));
  assert.ok(results.every(Boolean));
  assert.deepEqual(h.counts(), { requests: 1, renders: 1 });
});

test('customer recovery after the snapshot settles rechecks readiness even when rows are unchanged', async () => {
  const h = snapshotHarness();
  h.recover();
  await h.client.loadAndPublish(h.options);
  h.state.canonicalInventoryReady = false;
  h.state.dataUnavailable = true;
  h.state.photoRestoreFailed = true;
  let renders = 0;
  const page = fs.readFileSync(require.resolve('../../premium-database.html'), 'utf8');
  const applySource = page.match(/function applyCustomerList\([^\n]+/)[0];
  const apply = vm.runInNewContext('(' + applySource + ')', {
    state: h.state, window: { SoftoraDatabaseMailReadySnapshot: h.client }, databaseRenderRuntime: {},
    customerListsDiffer: () => false, renderPage() { renders++; },
  });
  apply(h.state.klanten, false, true, false);
  assert.equal(h.state.canonicalInventoryReady, true);
  assert.equal(h.state.dataUnavailable, false);
  assert.equal(h.state.photoRestoreFailed, false);
  assert.equal(renders, 1);
});

test('exhausted snapshot retries settle instead of leaving a permanent pending flag', async () => {
  const h = snapshotHarness();
  await h.client.loadAndPublish(h.options);
  for (let attempt = 0; attempt < 4; attempt++) {
    const [id, retry] = h.timers.entries().next().value;
    h.timers.delete(id); retry();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.mailReadySnapshotPending, false);
  assert.equal(h.state.dataLoading, false);
  assert.equal(h.state.dataUnavailable, true);
  assert.equal(h.counts().renders, 5);
});

test('JSON deadline includes a body stalled after successful response headers', async () => {
  let timerId = 0, signal;
  const timers = new Map();
  const window = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    async fetch(_url, options) { signal = options.signal; return { ok: true, status: 200, json: () => new Promise(() => {}) }; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../assets/premium-database-resilience'), 'utf8'), { window, AbortController });
  const pending = window.SoftoraDatabaseResilience.fetchJsonWithTimeout('/read-only', {}, 1000);
  const rejection = assert.rejects(pending, /reageert niet op tijd/);
  await new Promise(resolve => setImmediate(resolve));
  for (const callback of [...timers.values()]) callback();
  await rejection;
  assert.equal(signal.aborted, true);
});

test('oversized customer archive transfers losslessly below the response cap without rereading live pages', async () => {
  const rows = [{ id: 'large', note: randomBytes(3600000).toString('base64') }];
  let reads = 0, now = 1000;
  const store = { async listCustomersPage({ metaOnly }) {
    reads++;
    return { customers: metaOnly ? [] : rows, total: 1, snapshotVersion: '1:2026-10-09T17:00:00Z' };
  } };
  const handler = createPremiumDatabaseCustomersArchiveResponder({ dataOpsStore: store, nowMs: () => now, logger: {} });
  let descriptor;
  const requests = [];
  const fetchJsonWithTimeout = async (url, options) => {
    requests.push(url);
    const parsed = new URL(url, 'https://softora.test');
    const res = response();
    await handler({ query: Object.fromEntries(parsed.searchParams), get: name => options.headers?.[name] }, res);
    if (res.body.archiveParts) { descriptor = res.body.archiveParts; assert.equal(res.statusCode, 200); }
    assert.ok(Buffer.byteLength(JSON.stringify(res.body)) < 3500000, 'every response remains below the cap');
    return { ok: res.statusCode === 200, status: res.statusCode, json: async () => res.body };
  };
  const result = await customersClient.load({ fetchJsonWithTimeout });
  assert.deepEqual(result.customers, rows);
  assert.equal(reads, 2, 'only initial rows and final verification; parts never rebuild the archive');
  assert.equal(requests.length, 1 + descriptor.count);
  assert.ok(requests.every(url => url.startsWith('/api/premium-database/customers/archive')));

  for (const query of [{ part: '-1', version: descriptor.version }, { part: '0', version: 'wrong' }]) {
    const res = response(); await handler({ query }, res);
    assert.ok([400, 409].includes(res.statusCode));
    assert.equal(res.body.archivePart, undefined);
  }
  now += 120001;
  const expired = response();
  await handler({ query: { part: '0', version: descriptor.version } }, expired);
  assert.equal(expired.statusCode, 409);
});

test('a corrupt or mixed archive part cannot be accepted as customer data', async () => {
  const { gzipSync } = require('node:zlib');
  const { describeArchive, sendArchivePart } = require('../../server/services/premium-database-archive-parts');
  const buffer = gzipSync(JSON.stringify({ ok: true, completeDataset: true, total: 1, snapshotVersion: 'v1', customers: [{ id: 'one' }] }));
  const archive = { buffer, parts: describeArchive(buffer, Date.now()) };
  let paged = false;
  await assert.rejects(customersClient.load({ async fetchJsonWithTimeout(url) {
    const parsed = new URL(url, 'https://softora.test');
    if (!parsed.pathname.endsWith('/archive')) { paged = true; throw new Error('verified fallback only'); }
    if (!parsed.search) return { status: 413, ok: false, json: async () => ({ archiveParts: archive.parts }) };
    const res = response(); await sendArchivePart({ query: Object.fromEntries(parsed.searchParams) }, res, archive, Date.now());
    res.body.archivePart.data = Buffer.alloc(buffer.length).toString('base64');
    return { status: 200, ok: true, json: async () => res.body };
  } }), /verified fallback only/);
  assert.equal(paged, true);
});

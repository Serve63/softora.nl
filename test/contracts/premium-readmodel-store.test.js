const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createReadModelStore } = require('../../assets/premium-readmodel-store');

const repoRoot = path.join(__dirname, '../..');
const CURSOR = '2026-09-23T20:00:00.000Z';
const LATER = '2026-09-23T20:30:00.000Z';

// Minimal asynchronous IndexedDB stand-in: enough for open/get/put/delete and
// deleteDatabase with the same callback ordering the browser uses.
function createFakeIndexedDb() {
  const databases = new Map();
  const later = (fn) => setImmediate(fn);
  function request(executor) {
    const req = {};
    later(() => {
      try { req.result = executor(); req.onsuccess?.(); } catch (error) { req.error = error; req.onerror?.(); }
    });
    return req;
  }
  return {
    databases,
    open(name) {
      const req = {};
      later(() => {
        const isNew = !databases.has(name);
        if (isNew) databases.set(name, new Map());
        const records = databases.get(name);
        const stores = new Set(isNew ? [] : ['models']);
        const db = {
          objectStoreNames: { contains: (store) => stores.has(store) },
          createObjectStore: (store) => { stores.add(store); },
          close() {},
          transaction() {
            const tx = {};
            let pending = 0;
            const settle = () => { if (pending === 0) later(() => tx.oncomplete?.()); };
            tx.objectStore = () => ({
              get: (key) => { pending += 1; const r = request(() => records.get(key)); const s = r; later(() => { pending -= 1; settle(); }); return s; },
              put: (value) => { pending += 1; const r = request(() => { records.set(value.model, structuredClone(value)); return value.model; }); later(() => { pending -= 1; settle(); }); return r; },
              delete: (key) => { pending += 1; const r = request(() => records.delete(key)); later(() => { pending -= 1; settle(); }); return r; },
            });
            return tx;
          },
        };
        req.result = db;
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name) {
      return request(() => { databases.delete(name); return undefined; });
    },
  };
}

test('read model store only returns a copy to the user who stored it and wipes it for anyone else', async () => {
  const indexedDB = createFakeIndexedDb();
  const store = createReadModelStore({ indexedDB });

  assert.equal(await store.write('customers:v1', 'Serve@Softora.nl', { total: 1, rows: ['a'] }), true);
  assert.deepEqual(await store.read('customers:v1', 'serve@softora.nl'), { total: 1, rows: ['a'] });

  assert.equal(await store.read('customers:v1', 'ander@softora.nl'), null);
  assert.equal(indexedDB.databases.has('softora-readmodels'), false, 'a foreign identity deletes every stored copy');
  assert.equal(await store.read('customers:v1', 'serve@softora.nl'), null);
});

test('read model store never blocks without IndexedDB or identity', async () => {
  const store = createReadModelStore({});
  assert.equal(await store.read('customers:v1', 'serve@softora.nl'), null);
  assert.equal(await store.write('customers:v1', 'serve@softora.nl', { total: 0 }), false);
  assert.equal(await store.clearAll(), false);

  const withDb = createReadModelStore({ indexedDB: createFakeIndexedDb() });
  assert.equal(await withDb.write('customers:v1', '', { total: 0 }), false);
  assert.equal(await withDb.read('customers:v1', ''), null);

  const hanging = createReadModelStore({ indexedDB: { open: () => ({}) } }, { openTimeoutMs: 20 });
  const startedAt = Date.now();
  assert.equal(await hanging.read('customers:v1', 'serve@softora.nl'), null);
  assert.ok(Date.now() - startedAt < 500, 'a blocked database falls back to the network quickly');
});

test('login page wipes every local read model before anyone can sign in again', () => {
  const login = fs.readFileSync(path.join(repoRoot, 'premium-personeel-login.html'), 'utf8');
  const tag = '<script src="assets/premium-readmodel-store.js?v=20260924b" data-softora-readmodel-reset></script>';
  assert.ok(login.includes(tag));
  assert.ok(login.indexOf(tag) < login.indexOf("fetchWithTimeout('/api/auth/login'"));
  const store = fs.readFileSync(path.join(repoRoot, 'assets/premium-readmodel-store.js'), 'utf8');
  assert.match(store, /hasAttribute\("data-softora-readmodel-reset"\)\) store\.clearAll\(\)/);
});

function loadCustomersLoader() {
  const scriptPath = path.join(repoRoot, 'assets/premium-database-customers-loader.js');
  delete require.cache[require.resolve(scriptPath)];
  return require(scriptPath);
}

function createMemoryStore(initial) {
  const writes = [];
  let value = initial;
  return {
    writes,
    async read(model, identity) {
      assert.equal(model, 'premium-database-customers:v1');
      assert.equal(identity, 'serve@softora.nl');
      return value;
    },
    async write(model, identity, next) { writes.push({ model, identity, value: next }); value = next; return true; },
  };
}

const session = { authenticated: true, email: 'Serve@Softora.nl' };

test('customer loader opens from the verified local copy plus one small delta request', async (t) => {
  globalThis.requestIdleCallback = (callback) => callback();
  t.after(() => { delete globalThis.requestIdleCallback; });
  const client = loadCustomersLoader();
  const syncedAt = Date.now();
  const store = createMemoryStore({ total: 3, snapshotVersion: `3:${CURSOR}`, fullSyncedAt: syncedAt, customers: [
    { id: 'c', bedrijf: 'C' }, { id: 'b', bedrijf: 'B' }, { id: 'a', bedrijf: 'A' },
  ] });
  const requests = [];
  const loaded = await client.load({
    validatorSession: session, readModelStore: store,
    fetchJsonWithTimeout: async (url, options) => {
      requests.push([url, options.cache]);
      return { ok: true, status: 200, json: async () => ({ ok: true, completeDelta: true, total: 3,
        snapshotVersion: `3:${LATER}`, upserts: [{ id: 'd', bedrijf: 'D' }, { id: 'a', bedrijf: 'A2' }], deletedIds: ['b'] }) };
    },
  });

  assert.deepEqual(requests, [[`/api/premium-database/customers/archive/delta?since=${encodeURIComponent(CURSOR)}`, 'no-store']]);
  assert.equal(loaded.source, 'delta');
  assert.deepEqual(loaded.customers.map((customer) => customer.id), ['d', 'a', 'c'], 'changed rows come first, like updated_at order');
  assert.equal(loaded.customers[1].bedrijf, 'A2');
  assert.equal(loaded.snapshotVersion, `3:${LATER}`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].value.snapshotVersion, `3:${LATER}`);
  assert.equal(store.writes[0].value.fullSyncedAt, syncedAt, 'a delta does not count as a full verification');
});

test('customer loader replaces a copy that does not match the server count with the full archive', async (t) => {
  globalThis.requestIdleCallback = (callback) => callback();
  t.after(() => { delete globalThis.requestIdleCallback; });
  const client = loadCustomersLoader();
  const store = createMemoryStore({ total: 1, snapshotVersion: `1:${CURSOR}`, fullSyncedAt: Date.now(), customers: [{ id: 'a' }] });
  const requests = [];
  const archive = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  const loaded = await client.load({
    validatorSession: session, validatorCache: { read() {}, write() {} }, readModelStore: store,
    fetchJsonWithTimeout: async (url) => {
      requests.push(url.split('?')[0]);
      if (url.includes('/delta')) return { ok: true, json: async () => ({ ok: true, completeDelta: true, total: 3,
        snapshotVersion: `3:${LATER}`, upserts: [], deletedIds: [] }) };
      return { ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ ok: true, completeDataset: true,
        total: 3, snapshotVersion: `3:${LATER}`, customers: archive }) };
    },
  });

  assert.deepEqual(requests, ['/api/premium-database/customers/archive/delta', '/api/premium-database/customers/archive']);
  assert.deepEqual(loaded.customers.map((customer) => customer.id), ['x', 'y', 'z']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.writes.at(-1).value.customers.map((customer) => customer.id), ['x', 'y', 'z']);
});

test('customer loader follows a server resync request and stores the first verified archive', async (t) => {
  globalThis.requestIdleCallback = (callback) => callback();
  t.after(() => { delete globalThis.requestIdleCallback; });
  const client = loadCustomersLoader();
  const archiveResponse = { ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ ok: true,
    completeDataset: true, total: 1, snapshotVersion: `1:${LATER}`, customers: [{ id: 'fresh' }] }) };

  const resyncStore = createMemoryStore({ total: 1, snapshotVersion: `1:${CURSOR}`, fullSyncedAt: Date.now(), customers: [{ id: 'old' }] });
  const resyncRequests = [];
  const resynced = await client.load({ validatorSession: session, validatorCache: { read() {}, write() {} },
    readModelStore: resyncStore, fetchJsonWithTimeout: async (url) => {
      resyncRequests.push(url.split('?')[0]);
      return url.includes('/delta') ? { ok: true, json: async () => ({ ok: true, resync: true }) } : archiveResponse;
    } });
  assert.deepEqual(resynced.customers.map((customer) => customer.id), ['fresh']);
  assert.equal(resyncRequests.length, 2);

  const emptyStore = createMemoryStore(null);
  const before = Date.now();
  await client.load({ validatorSession: session, validatorCache: { read() {}, write() {} },
    readModelStore: emptyStore, fetchJsonWithTimeout: async () => archiveResponse });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emptyStore.writes.length, 1);
  assert.ok(emptyStore.writes[0].value.fullSyncedAt >= before);
});

test('customer loader re-verifies a day-old copy against the full archive after the screen is ready', async (t) => {
  const idle = [];
  globalThis.requestIdleCallback = (callback) => idle.push(callback);
  t.after(() => { delete globalThis.requestIdleCallback; });
  const client = loadCustomersLoader();
  const store = createMemoryStore({ total: 1, snapshotVersion: `1:${CURSOR}`,
    fullSyncedAt: Date.now() - 25 * 60 * 60 * 1000, customers: [{ id: 'a', bedrijf: 'Oud' }] });
  const requests = [];
  const loaded = await client.load({ validatorSession: session, validatorCache: { read() {}, write() {} },
    readModelStore: store, fetchJsonWithTimeout: async (url) => {
      requests.push(url.split('?')[0]);
      if (url.includes('/delta')) return { ok: true, json: async () => ({ ok: true, completeDelta: true, total: 1,
        snapshotVersion: `1:${CURSOR}`, upserts: [], deletedIds: [] }) };
      return { ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ ok: true, completeDataset: true,
        total: 1, snapshotVersion: `1:${CURSOR}`, customers: [{ id: 'a', bedrijf: 'Nieuw' }] }) };
    } });

  assert.equal(loaded.customers[0].bedrijf, 'Oud');
  assert.deepEqual(requests, ['/api/premium-database/customers/archive/delta'], 'verification waits until idle');
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    while (idle.length) await idle.shift()();
    await new Promise((resolve) => setImmediate(resolve));
    while (idle.length) await idle.shift()();
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(requests, ['/api/premium-database/customers/archive/delta', '/api/premium-database/customers/archive']);
  assert.match(warnings.join('\n'), /lokale kopie week af/);
  assert.equal(store.writes.at(-1).value.customers[0].bedrijf, 'Nieuw');
  assert.ok(Date.now() - store.writes.at(-1).value.fullSyncedAt < 1000);
});

test('customer loader keeps the network-only path when no signed-in identity is known', async () => {
  const client = loadCustomersLoader();
  const store = createMemoryStore({ total: 1, snapshotVersion: `1:${CURSOR}`, fullSyncedAt: Date.now(), customers: [{ id: 'a' }] });
  const requests = [];
  await client.load({ validatorSession: { authenticated: false }, readModelStore: store,
    fetchJsonWithTimeout: async (url) => {
      requests.push(url);
      return { ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ ok: true, completeDataset: true,
        total: 1, snapshotVersion: `1:${CURSOR}`, customers: [{ id: 'a' }] }) };
    } });
  assert.deepEqual(requests, ['/api/premium-database/customers/archive']);
  assert.equal(store.writes.length, 0);
});

test('Mailsysteem loads the read model store before the customer loader', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-database.html'), 'utf8');
  const storeTag = page.indexOf('<script src="assets/premium-readmodel-store.js?v=20260924b"></script>');
  const loaderTag = page.indexOf('assets/premium-database-customers-loader.js?v=20260924-readmodel-version');
  assert.ok(storeTag > 0);
  assert.ok(storeTag < loaderTag);
});

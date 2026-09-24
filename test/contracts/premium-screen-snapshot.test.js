const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createReadModelStore } = require('../../assets/premium-readmodel-store');
const { create } = require('../../assets/premium-screen-snapshot');

const repoRoot = path.join(__dirname, '../..');

function createStorage() {
  const map = new Map();
  return { map, get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
}

function createElement(initial = {}) {
  const attributes = new Map();
  return { innerHTML: '', textContent: '', hidden: false, className: '', disabled: false, inert: false, ...initial,
    setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); }, querySelectorAll() { return []; } };
}

function createDocument(elements) {
  const documentElement = createElement();
  return { documentElement, getElementById: (id) => elements[id] || null };
}

function setup({ identity = 'serve@softora.nl' } = {}) {
  globalThis.SoftoraPageBootstrapSession = { get: () => (identity ? { authenticated: true, email: identity } : null) };
  globalThis.requestIdleCallback = (callback) => callback();
  const storage = createStorage();
  const store = createReadModelStore({ localStorage: storage });
  const elements = { rows: createElement({ innerHTML: '<tr><td>Laden</td></tr>' }), count: createElement({ textContent: '--' }),
    more: createElement({ hidden: true }) };
  const doc = createDocument(elements);
  let clock = 1000;
  const snapshot = create({ key: 'test-page', document: doc, store, now: () => clock,
    elements: [{ id: 'rows', html: true }, { id: 'count', text: true }, { id: 'more', hidden: true }], inertIds: ['rows', 'more'] });
  return { storage, store, elements, doc, snapshot, advance: (ms) => { clock += ms; } };
}

test.afterEach(() => {
  delete globalThis.SoftoraPageBootstrapSession;
  delete globalThis.requestIdleCallback;
});

test('a captured screen reopens instantly for the same user and view, display-only until released', () => {
  const first = setup();
  first.elements.rows.innerHTML = '<tr><td>Bouwbedrijf</td></tr>';
  first.elements.count.textContent = '13.750 resultaten';
  first.elements.more.hidden = false;
  first.snapshot.capture('view-a');

  const reopened = { elements: { rows: createElement({ innerHTML: '<tr><td>Laden</td></tr>' }), count: createElement({ textContent: '--' }),
    more: createElement({ hidden: true }) } };
  reopened.doc = createDocument(reopened.elements);
  const second = create({ key: 'test-page', document: reopened.doc, store: first.store, now: () => 2000,
    elements: [{ id: 'rows', html: true }, { id: 'count', text: true }, { id: 'more', hidden: true }], inertIds: ['rows', 'more'] });

  assert.equal(second.restore('view-b'), false, 'another filter, search or sort never shows this snapshot');
  assert.equal(reopened.elements.rows.innerHTML, '<tr><td>Laden</td></tr>');
  assert.equal(second.restore('view-a'), true);
  assert.equal(reopened.elements.rows.innerHTML, '<tr><td>Bouwbedrijf</td></tr>');
  assert.equal(reopened.elements.count.textContent, '13.750 resultaten');
  assert.equal(reopened.elements.more.hidden, false);
  assert.equal(reopened.elements.rows.inert, true, 'snapshot rows cannot be clicked');
  assert.equal(reopened.doc.documentElement.getAttribute('data-softora-screen-snapshot'), 'showing');
  assert.equal(second.isShowing(), true);

  second.capture('view-a');
  second.release();
  assert.equal(reopened.elements.rows.inert, false);
  assert.equal(reopened.elements.more.inert, false);
  assert.equal(reopened.doc.documentElement.getAttribute('data-softora-screen-snapshot'), null);
  assert.equal(second.isShowing(), false);
});

test('snapshots are never shown to another user, when too old, or partially', () => {
  const owner = setup();
  owner.elements.rows.innerHTML = '<tr><td>Privé</td></tr>';
  owner.snapshot.capture('view');

  globalThis.SoftoraPageBootstrapSession = { get: () => ({ authenticated: true, email: 'ander@softora.nl' }) };
  const other = create({ key: 'test-page', document: createDocument({ rows: createElement(), count: createElement(), more: createElement() }),
    store: owner.store, elements: [{ id: 'rows', html: true }, { id: 'count', text: true }, { id: 'more', hidden: true }] });
  assert.equal(other.restore('view'), false);
  assert.equal(owner.storage.map.size, 0, 'a foreign identity wipes every synchronous copy');

  const aged = setup();
  aged.elements.rows.innerHTML = '<tr><td>Oud</td></tr>';
  aged.snapshot.capture('view');
  aged.advance(8 * 24 * 60 * 60 * 1000);
  assert.equal(aged.snapshot.restore('view'), false);

  const partial = setup();
  partial.snapshot.capture('view');
  const missing = create({ key: 'test-page', document: createDocument({ rows: createElement() }), store: partial.store,
    elements: [{ id: 'rows', html: true }, { id: 'count', text: true }, { id: 'more', hidden: true }] });
  assert.equal(missing.restore('view'), false, 'all parts or nothing');

  const anonymous = setup({ identity: '' });
  anonymous.snapshot.capture('view');
  assert.equal(anonymous.storage.map.size, 0);
});

test('logout wipes screen snapshots together with the other read models', async () => {
  const first = setup();
  first.snapshot.capture('view');
  assert.equal(first.storage.map.size, 1);
  await first.store.clearAll();
  assert.equal(first.storage.map.size, 0);
});

test('Mailsysteem shows its snapshot instead of the loading row and replaces it on the first real render', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-database.html'), 'utf8');
  assert.match(page, /applyDatabaseUrlIntent\(\); window\.SoftoraDatabaseScreenSnapshot\?\.restore\(state\);\n\s+renderPage\(\);/);
  assert.match(page, /if \(canonicalInventoryStatus !== "ready"\) \{ if \(canonicalInventoryStatus !== "unavailable" && window\.SoftoraDatabaseScreenSnapshot\?\.isShowing\(\)\) return;/);
  assert.match(page, /function setDatabaseTableBodyHtml\(html\) \{ window\.SoftoraDatabaseScreenSnapshot\?\.release\(\);/);
  assert.match(page, /setDatabaseTableBodyHtml\(tableBodyHtml\); if \(state\.remoteCustomersLoaded && !state\.dataLoading && !state\.photoRestorePending && !state\.photoRestoreFailed\) window\.SoftoraDatabaseScreenSnapshot\?\.capture\(state\);/);
  const snapshotScript = page.indexOf('assets/premium-database-screen-snapshot.js?v=20260924a');
  assert.ok(page.indexOf('assets/premium-screen-snapshot.js?v=20260924a') < snapshotScript);
  assert.ok(snapshotScript < page.indexOf('const state = {'), 'the snapshot is available before the first render');

  const adapter = require('../../assets/premium-database-screen-snapshot');
  assert.notEqual(adapter.viewOf({ activeStatus: 'beschikbaar', query: '' }), adapter.viewOf({ activeStatus: 'mailklaar', query: '' }));
  assert.notEqual(adapter.viewOf({ activeStatus: 'beschikbaar', query: '' }), adapter.viewOf({ activeStatus: 'beschikbaar', query: 'haaren' }));
});

test('Klanten shows its snapshot instead of the loading overlay and releases it on the first real render', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-klanten.html'), 'utf8');
  assert.match(page, /if \(!initialBootstrapCustomers\.length\) window\.SoftoraCustomersScreenSnapshot\?\.restore\(state\); renderPage\(\);/);
  assert.match(page, /if \(isLoading && window\.SoftoraCustomersScreenSnapshot\?\.isShowing\(\)\) return; window\.SoftoraCustomersScreenSnapshot\?\.release\(\); if \(!isLoading && state\.loadState === "ready"\) window\.SoftoraCustomersScreenSnapshot\?\.capture\(state\);/);
  assert.match(page, /isSnapshotShowing: function \(\) \{ return Boolean\(window\.SoftoraCustomersScreenSnapshot\?\.isShowing\(\)\); \}/);
  const adapterScript = page.indexOf('assets/premium-customers-screen-snapshot.js?v=20260924a');
  assert.ok(page.indexOf('assets/premium-readmodel-store.js?v=20260924c') < adapterScript);
  assert.ok(page.indexOf('assets/premium-screen-snapshot.js?v=20260924a') < adapterScript);
  assert.ok(page.indexOf('<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->') < adapterScript, 'the signed-in identity is known before restore');
  assert.ok(adapterScript < page.indexOf('const state = {'));
});

test('Mailsysteem shows its subtitle and complete mail totals from the first paint', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-database.html'), 'utf8');
  assert.match(page, /<div class="page-sub" id="top-sub">De AI koppelt alle data slim aan elkaar\.<\/div>/);
  const metrics = fs.readFileSync(path.join(repoRoot, 'assets/premium-database-system-mail-count.js'), 'utf8');
  assert.match(metrics, /function applyBootstrapState\(\) \{\n\s+if \(bootstrapStateApplied\) return;\n\s+bootstrapStateApplied = true;\n\s+applyRememberedInstantlyCounts\(\);/);
  assert.match(metrics, /if \(completeCount && instantlyCountsFromMemory\) \{/, 'the first complete count replaces the remembered one');
  assert.match(metrics, /if \(completeCount\) \{\n\s+const store = lastKnownStore\(\);\n\s+if \(store\) store\.rememberLastKnown\(INSTANTLY_COUNTS_KEY/);
  assert.match(metrics, /remembered\.dayKey === getAmsterdamDateKey\(new Date\(\)\)/, "today's Instantly count only applies on the same Amsterdam day");
});

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

test('database retains each standard view through tab changes, search, expanded rows and immediate navigation', () => {
  const fixture = setup();
  // No idle callback ever runs: navigating immediately must still retain the table.
  globalThis.requestIdleCallback = () => {};
  const { createAdapter } = require('../../assets/premium-database-screen-snapshot');
  const elements = {};
  const factory = (config) => {
    config.elements.forEach(({ id }) => { elements[id] ||= createElement(); });
    return create({ ...config, document: createDocument(elements), store: fixture.store });
  };
  const adapter = createAdapter({ create: factory, sentReady: () => true });
  const state = { activeStatus: 'beschikbaar', query: '', sortKey: 'distance', sortAsc: true,
    visibleLimit: 25, canonicalInventoryReady: true, remoteCustomersLoaded: true };
  // Initialize the DOM fixtures; missing copies must not show anything.
  assert.equal(adapter.restore(state), false);
  elements.tbody.innerHTML = '<tr><td>Beschikbaar bedrijf</td></tr>';
  adapter.capture(state);
  state.activeStatus = 'instantly';
  elements.tbody.innerHTML = '<tr><td>Verstuurd bedrijf</td></tr>';
  adapter.capture(state);
  state.activeStatus = 'beschikbaar';
  state.query = 'zoekterm';
  elements.tbody.innerHTML = '<tr><td>Zoekresultaat</td></tr>';
  adapter.capture(state);
  state.query = ''; state.visibleLimit = 50;
  elements.tbody.innerHTML = '<tr><td>Meer rijen</td></tr>';
  adapter.capture(state);
  state.visibleLimit = 25; state.photoRestorePending = true;
  assert.equal(adapter.hold(state), true);
  assert.match(elements.tbody.innerHTML, /Beschikbaar bedrijf/);
  assert.equal(elements.tbody.inert, true);
  adapter.capture(state); // A restored/unfinished table must never become verified data.
  state.activeStatus = 'instantly';
  assert.equal(adapter.hold(state), true);
  assert.match(elements.tbody.innerHTML, /Verstuurd bedrijf/);
  state.activeStatus = 'beschikbaar';
  assert.equal(adapter.hold(state), true);
  assert.match(elements.tbody.innerHTML, /Beschikbaar bedrijf/);
  state.photoRestorePending = false;
  assert.equal(adapter.hold(state), false);
  adapter.release();
  assert.equal(elements.tbody.inert, false);
  state.dataUnavailable = true;
  assert.equal(adapter.hold(state), false, 'a failed verification must surface its error');
});

test('partial inventory and photo preparation cannot publish intermediate rows or count them as complete', () => {
  const { isPreparing } = require('../../assets/premium-database-screen-snapshot');
  assert.equal(isPreparing({ canonicalInventoryReady: true, remoteCustomersLoaded: false }), true);
  assert.equal(isPreparing({ remoteCustomersLoaded: true, photoRestorePending: true }), true);
  assert.equal(isPreparing({ remoteCustomersLoaded: true, photoRestorePending: false, dataLoading: false }), false);
  assert.equal(isPreparing({ remoteCustomersLoaded: false, dataUnavailable: true }), false, 'errors remain visible');
  const page = fs.readFileSync(path.join(repoRoot, 'premium-database.html'), 'utf8');
  assert.match(page, /dataLoading: preparing \|\| state\.photoRestoreFailed, normalizeString, isColdmailTestCompany, outreachController, databaseContactStatus/);
  assert.match(page, /if \(!preparing\) publishMailReadyCounts\(\); if \(!preparing && window\.SoftoraDatabaseSentRegister\.render/);
});

test('static upload controls bind without insertion or sending any request', () => {
  const listeners = {};
  const elements = Object.fromEntries(['instantlyQueueImportButton', 'instantlyQueueImportFile', 'instantlyQueueImportStatus']
    .map((id) => [id, { addEventListener(type, listener) { listeners[id + ':' + type] = listener; } }]));
  let filePickerOpened = false;
  elements.instantlyQueueImportFile.click = () => { filePickerOpened = true; };
  const document = { readyState: 'complete', querySelector: () => ({}), getElementById: (id) => elements[id],
    createElement() { throw new Error('static controls must not be replaced'); } };
  const { bind } = require('../../assets/premium-database-instantly-queue-import');
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  try {
    globalThis.document = document;
    globalThis.location = { href: 'https://www.softora.nl/premium-database' };
    bind();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
  assert.equal(typeof listeners['instantlyQueueImportFile:change'], 'function');
  listeners['instantlyQueueImportButton:click']();
  assert.equal(filePickerOpened, true);
});

test('Mailsysteem shows its snapshot instead of the loading row and replaces it on the first real render', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-database.html'), 'utf8');
  assert.match(page, /applyDatabaseUrlIntent\(\); window\.SoftoraDatabaseScreenSnapshot\?\.restore\(state\);\n\s+renderPage\(\);/);
  assert.match(page, /if \(canonicalInventoryStatus !== "ready"\) \{ if \(canonicalInventoryStatus !== "unavailable" && window\.SoftoraDatabaseScreenSnapshot\?\.isShowing\(\)\) return;/);
  assert.match(page, /function setDatabaseTableBodyHtml\(html\) \{ window\.SoftoraDatabaseScreenSnapshot\?\.release\(\);/);
  assert.match(page, /function renderPage\(\) \{ renderTable\(\); window\.SoftoraDatabaseScreenSnapshot\?\.capture\(state\);/);
  const snapshotScript = page.indexOf('assets/premium-database-screen-snapshot.js?v=20260927a');
  assert.ok(page.indexOf('assets/premium-screen-snapshot.js?v=20260927a') < snapshotScript);
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
  assert.ok(page.indexOf('assets/premium-screen-snapshot.js?v=20260924b') < adapterScript);
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

test('capture skips screens that are too large or changed before the idle write', () => {
  const page = setup();
  const oversized = create({ key: 'large-page', document: page.doc, store: page.store, maxChars: 40,
    elements: [{ id: 'rows', html: true }] });
  page.elements.rows.innerHTML = '<tr><td>' + 'x'.repeat(100) + '</td></tr>';
  oversized.capture('view');
  assert.equal(page.storage.map.size, 0, 'an oversized screen is not stored');

  page.snapshot.capture('view', { isValid: () => false });
  assert.equal(page.storage.map.size, 0, 'a screen that no longer matches its view is not stored');
  page.snapshot.capture('view', { isValid: () => true });
  assert.equal(page.storage.map.size, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createController, CANONICAL_CATEGORIES } = require('../../assets/kvk-database-metrics');
const lunaErrors = require('../../assets/kvk-database-luna-errors');
const kvkSnapshot = require('../../assets/kvk-database-screen-snapshot');

const repoRoot = path.join(__dirname, '..', '..');
const remembered = { treated: 120, successfulFound: 110, declaredUnusable: 3, controlRoom: 7, usable: 13551, withWebsite: 13037, withoutWebsite: 514 };

function textElement(text = '0') {
  return { textContent: text, innerHTML: '', querySelector: () => null };
}

function memoryStore(value) {
  const writes = [];
  return {
    writes,
    readLastKnown(name, maxAgeMs) {
      assert.equal(name, 'kvk-database:canonical-counts');
      assert.ok(maxAgeMs > 0);
      return value;
    },
    rememberLastKnown(name, counts) { writes.push([name, counts]); return true; },
  };
}

test('reopened Bedrijvendatabase shows the remembered verified counts, not a snapshot estimate', () => {
  const elements = { 'companies-usable': textElement(), 'companies-with-website': textElement(), 'companies-without-website': textElement(),
    'companies-usable-last60': { querySelector: () => null, classList: { toggle() {} } } };
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => ({ state: { usable: 14022, with_website: 13496, without_website: 526 } }),
    store: memoryStore(remembered),
  });
  controller.renderMetrics();
  assert.equal(elements['companies-usable'].textContent, '13.551');
  assert.equal(elements['companies-with-website'].textContent, '13.037');
  assert.equal(elements['companies-without-website'].textContent, '514');
  assert.equal(controller.hasLiveCanonicalCounts(), false, 'remembered counts are never treated as live');
});

test('remembered counts render before any snapshot without overwriting activity', () => {
  let deltaWrites = 0;
  const delta = { querySelector: () => ({ set textContent(_value) { deltaWrites += 1; } }) };
  const elements = { 'companies-usable': textElement(), 'companies-usable-last60': delta };
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => ({}),
    store: memoryStore(remembered),
  });
  controller.renderMetrics();
  assert.equal(elements['companies-usable'].textContent, '13.551');
  assert.equal(deltaWrites, 0);
});

test('incomplete or missing remembered counts fall back to the normal load', () => {
  const partial = { ...remembered };
  delete partial.controlRoom;
  for (const value of [null, partial, { ...remembered, usable: -1 }]) {
    const elements = { 'companies-usable': textElement() };
    const controller = createController({
      document: { getElementById: (id) => elements[id] || null },
      getSnapshot: () => ({}),
      store: memoryStore(value),
    });
    controller.renderMetrics();
    assert.equal(elements['companies-usable'].textContent, '0');
    assert.equal(controller.getCanonicalCounts(), null);
  }
});

test('live directory counts replace remembered ones and are remembered for the next open', async () => {
  const store = memoryStore(remembered);
  const live = Object.fromEntries(Object.values(CANONICAL_CATEGORIES).map((category, index) => [category, 1000 + index]));
  const elements = { 'companies-usable': textElement() };
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => ({}),
    store,
    fetchImpl: async (url) => {
      const category = new URL(url, 'https://example.test').searchParams.get('categorie');
      return { ok: true, json: async () => ({ ok: true, total_is_exact: true, total: live[category] }) };
    },
  });
  assert.equal(await controller.refreshCanonicalCounts(), true);
  assert.equal(controller.hasLiveCanonicalCounts(), true);
  assert.equal(elements['companies-usable'].textContent, '1.004');
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0][1].usable, 1004);
});

test('a failed live refresh keeps the remembered counts on screen and stores nothing', async () => {
  const store = memoryStore(remembered);
  const elements = { 'companies-usable': textElement() };
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => ({}),
    store,
    fetchImpl: async () => ({ ok: false }),
  });
  controller.renderMetrics();
  assert.equal(await controller.refreshCanonicalCounts(), false);
  assert.equal(elements['companies-usable'].textContent, '13.551');
  assert.equal(controller.hasLiveCanonicalCounts(), false);
  assert.equal(store.writes.length, 0);
});

test('"Recent onderzocht" never flashes an empty state before the first snapshot', () => {
  const head = { innerHTML: '<tr><th>Wanneer</th></tr>' };
  const body = { innerHTML: '<tr><td>Bakker BV</td></tr>' };
  let snapshot = {};
  const controller = lunaErrors.createController({
    document: { getElementById: (id) => (id.endsWith('head') ? head : body) },
    getSnapshot: () => snapshot,
  });
  controller.render();
  assert.equal(body.innerHTML, '<tr><td>Bakker BV</td></tr>');
  snapshot = { state: {}, latestTreated: [] };
  controller.render();
  assert.match(body.innerHTML, /Nog geen nieuwe onderzoeksresultaten/);
});

function fakeDocument({ total = '0', items = 0, head = '', role = 'searcher' } = {}) {
  const list = {
    children: Array.from({ length: items }, (_, index) => ({ outerHTML: `<li class="location-item">${index}</li>` })),
    innerHTML: '', inert: false, attributes: {},
    querySelector: (selector) => (selector.startsWith('.location-item') && items ? {} : null),
    querySelectorAll: () => [],
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
  const elements = {
    'companies-total': { textContent: total },
    'location-list': list,
    'latest-luna-errors-table-head': { innerHTML: head },
    'latest-role-select': { value: role },
  };
  return { list, hidden: false, documentElement: {}, getElementById: (id) => elements[id] || null };
}

test('planning snapshot keeps only the visible top of the location list', () => {
  const doc = fakeDocument({ items: 2500 });
  const preview = kvkSnapshot.planningPreview(doc.list);
  assert.equal((preview.innerHTML.match(/<li/g) || []).length, kvkSnapshot.PLANNING_PREVIEW_ITEMS);
  preview.innerHTML = '<li>restored</li>';
  assert.equal(doc.list.innerHTML, '<li>restored</li>');
  preview.inert = true;
  assert.equal(doc.list.inert, true);
});

test('screen counts as complete only with live counts, planning rows and the recent table', () => {
  const live = { hasLiveCanonicalCounts: () => true };
  assert.equal(kvkSnapshot.isComplete(fakeDocument({ total: '2.924.398', items: 3, head: '<tr></tr>' }), live), true);
  assert.equal(kvkSnapshot.isComplete(fakeDocument({ total: '2.924.398', items: 3, head: '<tr></tr>' }), { hasLiveCanonicalCounts: () => false }), false);
  assert.equal(kvkSnapshot.isComplete(fakeDocument({ total: '0', items: 3, head: '<tr></tr>' }), live), false);
  assert.equal(kvkSnapshot.isComplete(fakeDocument({ total: '2.924.398', items: 0, head: '<tr></tr>' }), live), false);
  assert.equal(kvkSnapshot.isComplete(fakeDocument({ total: '2.924.398', items: 3, head: '' }), live), false);
});

test('snapshot restores at once, stays inert until complete, then releases and captures', () => {
  const calls = [];
  let liveCounts = false;
  const doc = fakeDocument({ total: '2.924.398', items: 3, head: '<tr></tr>' });
  const intervals = [];
  const controller = kvkSnapshot.start({
    document: doc,
    metrics: () => ({ hasLiveCanonicalCounts: () => liveCounts }),
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    create(options) {
      assert.equal(options.key, 'kvk-database:v1');
      assert.deepEqual(options.inertIds, ['location-list', 'latest-luna-errors-table-frame']);
      assert.equal((options.document.getElementById('location-list').innerHTML.match(/<li/g) || []).length, 3);
      return {
        restore: (view) => { calls.push(['restore', view]); return true; },
        release: () => calls.push(['release']),
        capture: (view, captureOptions) => calls.push(['capture', view, captureOptions.isValid()]),
      };
    },
  });
  assert.deepEqual(calls, [['restore', '["searcher"]']]);
  controller.check();
  assert.equal(controller.isComplete(), false, 'remembered or partial content stays inert');
  assert.equal(calls.length, 1);
  liveCounts = true;
  controller.check();
  assert.equal(controller.isComplete(), true);
  assert.deepEqual(calls.slice(1), [['release'], ['capture', '["searcher"]', true]]);
});

test('Bedrijvendatabase loads the session bootstrap and snapshot before its renderers', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');
  const marker = page.indexOf('<!-- SOFTORA_PAGE_STATE_BOOTSTRAP -->');
  const module = page.indexOf('/assets/premium-screen-snapshot.js?v=20260927a');
  const adapter = page.indexOf('/assets/kvk-database-screen-snapshot.js?v=20261006a');
  const firstRenderer = page.indexOf('<script id="kvkSnapshot"');
  assert.ok(marker > 0 && marker < module && module < adapter && adapter < firstRenderer);
  assert.ok(page.indexOf('id="location-list"') < adapter, 'the adapter runs after the parts it restores exist');
});

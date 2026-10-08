const test = require('node:test');
const assert = require('node:assert/strict');
const { createKvkCompanyDirectoryService } = require('../../server/services/kvk-company-directory');
const { registerKvkDatabaseRoutes } = require('../../server/routes/kvk-database');
const { readKvkInventoryRows, MAX_INVENTORY_ROWS } = require('../../server/repositories/kvk-inventory-rows');
const { createController, readRememberedCounts } = require('../../assets/kvk-database-metrics');
const recent = require('../../assets/kvk-database-luna-errors');
const screen = require('../../assets/kvk-database-screen-snapshot');
const { create } = require('../../assets/premium-screen-snapshot');
const { createReadModelStore } = require('../../assets/premium-readmodel-store');

const counts = { treated: 120, successfulFound: 100, declaredUnusable: 10, controlRoom: 10,
  withWebsite: 90, withoutWebsite: 10, usable: 100 };
const reply = () => ({ statusCode: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('summary reads the safe stock once and only counts the four research categories', async () => {
  let stockReads = 0;
  const categories = [];
  const totals = { behandeld: 120, 'bruikbaar-verklaard': 100, 'onbruikbaar-verklaard': 10, controlekamer: 10 };
  const service = createKvkCompanyDirectoryService({
    readTransferInventory: async () => { stockReads++; return { count: 90, withoutWebsiteRows: Array(10).fill({}) }; },
    fetchDirectoryMeta: async () => ({ ok: true, row: { completed: true } }),
    fetchDirectoryCount: async ({ category }) => { categories.push(category); return { ok: true, count: totals[category] }; },
  });
  const res = reply();
  await service.sendGetCountsResponse({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, counts, total_is_exact: true, source: 'supabase' });
  assert.equal(stockReads, 1);
  assert.deepEqual(categories.sort(), Object.keys(totals).sort());
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('summary refuses incomplete metadata, broken guards and inexact counts', async () => {
  const valid = {
    readTransferInventory: async () => ({ count: 90, withoutWebsiteRows: [] }),
    fetchDirectoryMeta: async () => ({ ok: true, row: { completed: true } }),
    fetchDirectoryCount: async () => ({ ok: true, count: 120 }),
  };
  for (const changes of [
    { fetchDirectoryMeta: async () => ({ ok: true, row: { completed: false } }) },
    { fetchDirectoryMeta: async () => ({ ok: false }) },
    { readTransferInventory: async () => { throw new Error('guard unavailable'); } },
    { readTransferInventory: async () => ({ count: -1, withoutWebsiteRows: [] }) },
    { fetchDirectoryCount: async () => ({ ok: true, count: null }) },
    { fetchDirectoryCount: async () => ({ ok: true, count: 1.5 }) },
    { fetchDirectoryCount: async () => ({ ok: false, count: 120 }) },
  ]) {
    const res = reply();
    await createKvkCompanyDirectoryService({ ...valid, ...changes }).sendGetCountsResponse({}, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.counts, undefined);
  }
});

test('summary route uses the existing admin guard before its coordinator', async () => {
  const routes = new Map();
  const admin = () => {};
  let reads = 0;
  registerKvkDatabaseRoutes({ get: (url, ...handlers) => routes.set(url, handlers), post() {} }, {
    requirePremiumAdminApiAccess: admin,
    directoryCoordinator: { sendGetCountsResponse() { reads++; } },
  });
  const handlers = routes.get('/api/kvk-database/company-directory/counts');
  assert.equal(handlers[0], admin);
  await handlers[1]({}, reply());
  assert.equal(reads, 1);
});

test('inventory RPC keeps rows beyond REST page caps and rejects incomplete or unordered reads', async () => {
  const rows = Array.from({ length: 32_810 }, (_, i) => ({ source_company_id: i + 1 }));
  let reads = 0;
  assert.equal(await readKvkInventoryRows({ rpc: async name => {
    assert.equal(name, 'softora_kvk_unused_inventory_rows'); reads++; return { data: rows };
  } }), rows);
  assert.equal(reads, 1);
  for (const data of [null, {}, [{ source_company_id: 0 }], [{ source_company_id: 1.5 }],
    [{ source_company_id: 2 }, { source_company_id: 1 }],
    [{ source_company_id: 1 }, { source_company_id: 1 }], Array(MAX_INVENTORY_ROWS + 1).fill({})]) {
    await assert.rejects(() => readKvkInventoryRows({ rpc: async () => ({ data }) }));
  }
  await assert.rejects(() => readKvkInventoryRows({ rpc: async () => ({ data: rows, error: {} }) }));
});

function element(initial = {}) {
  const attributes = new Map();
  return { textContent: '', innerHTML: '', hidden: false, disabled: false, inert: false, value: '', ...initial,
    setAttribute(k, v) { attributes.set(k, v); }, getAttribute(k) { return attributes.get(k) ?? null; },
    removeAttribute(k) { attributes.delete(k); }, querySelectorAll() { return []; },
    querySelector(selector) { return selector === '.location-item' && this.innerHTML.includes('location-item') ? {} : null; },
  };
}

function metricsFixture(remembered = counts) {
  const nodes = Object.fromEntries(['companies-usable', 'companies-with-website', 'companies-without-website',
    'companies-treated', 'companies-successful-found', 'companies-declared-unusable', 'companies-control-room',
    'kvk-upload-open', 'kvk-api-workers-open', 'companies-usable-open', 'companies-with-website-open',
    'companies-without-website-open', 'kvk-metrics-status'].map(id => [id, element()]));
  let resolve;
  const gate = new Promise(done => { resolve = done; });
  const rememberedWrites = [];
  const controller = createController({ document: { getElementById: id => nodes[id] }, getSnapshot: () => null,
    store: { readLastKnown: () => remembered, rememberLastKnown: (_key, value) => rememberedWrites.push(value) },
    fetchImpl: () => gate });
  return { controller, nodes, rememberedWrites, resolve };
}

test('remembered counts appear before the network and remain read-only on failure', async () => {
  const app = metricsFixture();
  app.controller.renderMetrics();
  assert.equal(app.nodes['companies-with-website'].textContent, '90');
  assert.equal(app.nodes['kvk-upload-open'].disabled, true);
  assert.equal(app.controller.hasLiveCanonicalCounts(), false);
  const pending = app.controller.refreshCanonicalCounts();
  app.resolve({ ok: false });
  assert.equal(await pending, false);
  assert.equal(app.nodes['companies-with-website'].textContent, '90');
  assert.equal(app.nodes['kvk-upload-open'].disabled, true);
  assert.equal(app.nodes['kvk-metrics-status'].hidden, false);
  assert.equal(app.rememberedWrites.length, 0);
});

test('live counts replace the remembered values without enabling another controller disabled button', async () => {
  const app = metricsFixture();
  app.nodes['kvk-api-workers-open'].disabled = true;
  app.controller.renderMetrics();
  const pending = app.controller.refreshCanonicalCounts();
  app.resolve({ ok: true, json: async () => ({ ok: true, total_is_exact: true,
    counts: { ...counts, withWebsite: 89, usable: 99 } }) });
  assert.equal(await pending, true);
  assert.equal(app.controller.hasLiveCanonicalCounts(), true);
  assert.equal(app.nodes['companies-with-website'].textContent, '89');
  assert.equal(app.nodes['kvk-upload-open'].disabled, false);
  assert.equal(app.nodes['kvk-api-workers-open'].disabled, true);
  app.nodes['kvk-upload-open'].disabled = true;
  app.controller.renderMetrics();
  assert.equal(app.nodes['kvk-upload-open'].disabled, true, 'metrics must not enable an in-flight upload');
});

test('invalid remembered data and older responses cannot replace a verified transfer update', async () => {
  for (const data of [{}, { ...counts, usable: 1 }, { ...counts, withWebsite: '90' }, { ...counts, treated: -1 }]) {
    assert.equal(readRememberedCounts({ readLastKnown: () => data }), null);
  }
  const app = metricsFixture();
  const pending = app.controller.refreshCanonicalCounts();
  app.controller.applyTransferInventory({ count: 87, withoutWebsiteCount: 10 });
  app.resolve({ ok: true, json: async () => ({ ok: true, total_is_exact: true, counts }) });
  await pending;
  assert.equal(app.controller.getCanonicalCounts().withWebsite, 87);
  assert.equal(app.controller.getCanonicalCounts().usable, 97);
  const empty = metricsFixture(null);
  empty.nodes['companies-with-website'].textContent = '87';
  empty.controller.renderMetrics();
  assert.equal(empty.nodes['companies-with-website'].textContent, '87', 'empty bootstrap keeps a restored screen');
});

test('screen restoration waits for actual renders, preserves recent rows on failure and isolates users', () => {
  let identity = 'user-one';
  globalThis.SoftoraPageBootstrapSession = { get: () => ({ authenticated: true, userId: identity }) };
  globalThis.requestIdleCallback = fn => fn();
  try {
    const storage = new Map();
    const store = createReadModelStore({ localStorage: { getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k),
      get length() { return storage.size; }, key: i => [...storage.keys()][i] ?? null } });
    function setup() {
      const nodes = Object.fromEntries([...screen.ELEMENTS, ...screen.INERT_IDS.map(id => ({ id }))]
        .map(spec => [spec.id, element()]));
      nodes['location-list'].innerHTML = '<li class="location-item">Live planning</li>';
      Object.defineProperty(nodes['location-list'], 'children', {
        get() { return this.innerHTML.match(/<li[^>]*>.*?<\/li>/g)?.map(outerHTML => ({ outerHTML })) || []; },
      });
      nodes['companies-total'].textContent = '2.924.398';
      nodes['latest-luna-errors-table-head'].innerHTML = '<tr><th>Bedrijf</th></tr>';
      nodes['latest-luna-errors-table-body'].innerHTML = '<tr><td>Confirmed company</td></tr>';
      const doc = { documentElement: element(), getElementById: id => nodes[id], hidden: false };
      const live = { counts: false, dashboard: false, recent: false };
      const controller = screen.start({ document: doc, create: options => create({ ...options, store, now: () => 1000 }),
        metrics: () => ({ hasLiveCanonicalCounts: () => live.counts }), dashboard: () => ({ hasLiveSnapshot: () => live.dashboard }),
        recent: () => ({ hasLiveSnapshot: () => live.recent }), setInterval() {} });
      return { nodes, doc, controller, setLive: (part) => { if (part) live[part] = true; else Object.keys(live).forEach(key => { live[key] = true; }); } };
    }
    const first = setup();
    first.controller.check();
    assert.equal(storage.size, 0, 'a full-looking DOM alone cannot be captured');
    first.setLive(); first.controller.check();
    const next = setup();
    assert.equal(next.controller.snapshot.isShowing(), true);
    assert.equal(next.nodes['kvk-upload-open'].inert, true);
    const table = recent.createController({ document: next.doc, getSnapshot: () => ({}) });
    table.render();
    assert.equal(table.hasLiveSnapshot(), false);
    assert.match(next.nodes['latest-luna-errors-table-body'].innerHTML, /Confirmed company/);
    next.controller.check();
    assert.equal(next.nodes['kvk-upload-open'].inert, true);
    next.setLive('counts'); next.setLive('dashboard'); next.controller.check();
    assert.equal(next.nodes['kvk-upload-open'].inert, true, 'the recent table must also have rendered live');
    next.setLive('recent'); next.controller.check();
    assert.equal(next.nodes['kvk-upload-open'].inert, false);
    assert.equal(next.controller.isComplete(), true);
    identity = 'user-two';
    assert.equal(setup().controller.snapshot.isShowing(), false);
  } finally {
    delete globalThis.SoftoraPageBootstrapSession;
    delete globalThis.requestIdleCallback;
  }
});

test('planning preview stores only the visible first forty rows', () => {
  const list = element({ children: Array.from({ length: 2502 }, (_, i) => ({ outerHTML: `<li>${i}</li>` })) });
  const html = screen.planningPreview(list).innerHTML;
  assert.equal((html.match(/<li>/g) || []).length, 40);
  assert.match(html, /<li>39<\/li>/);
  assert.doesNotMatch(html, /<li>40<\/li>/);
});


test('a planning read failure remains visible after counts succeed and clears on recovery', async () => {
  let failed = true;
  const status = element();
  const controller = createController({ document: { getElementById: id => id === 'kvk-metrics-status' ? status : null },
    window: { SoftoraKvkDashboard: { hasSnapshotFailure: () => failed } },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, total_is_exact: true, counts }) }) });
  await controller.refreshCanonicalCounts();
  assert.equal(status.hidden, false);
  failed = false; controller.renderMetrics();
  assert.equal(status.hidden, true);
});

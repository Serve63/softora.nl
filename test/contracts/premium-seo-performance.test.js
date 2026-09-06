const test = require('node:test');
const assert = require('node:assert/strict');
const scriptPath = require.resolve('../../assets/premium-seo-performance.js');
function element(dataset = {}) {
  const attrs = {}, classes = new Set(), listeners = {};
  return { dataset, attrs, listeners, value: '', textContent: '', innerHTML: '', hidden: false,
    classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), toggle: (key, on) => on ? classes.add(key) : classes.delete(key) },
    setAttribute: (key, value) => { attrs[key] = value; },
    addEventListener: (key, fn) => { listeners[key] = fn; },
    fire(key) { listeners[key]?.(); },
  };
}
function fixture(t) {
  const elements = new Map(), requests = [];
  const groups = {
    '[data-seo-days]': [7, 28, 90].map((days) => element({ seoDays: String(days) })),
    '[data-seo-table-tab]': ['queries', 'pages', 'countries', 'devices', 'searchAppearance', 'dates'].map((tab) => element({ seoTableTab: tab })),
    '[data-seo-chart-metric]': ['clicks', 'impressions'].map((metric) => element({ seoChartMetric: metric })),
  };
  const get = (selector) => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const root = { ...element(), querySelector: get, querySelectorAll: (selector) => groups[selector] || [] };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    delete require.cache[scriptPath];
  });
  globalThis.document = { querySelector: () => root };
  t.mock.method(globalThis, 'fetch', (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })));
  delete require.cache[scriptPath];
  require('../../assets/premium-seo-performance.js');
  const respond = async (request, payload, ok = true) => {
    request.resolve({ ok, json: async () => payload });
    await new Promise(setImmediate);
  };
  return { get, root, groups, requests, respond, performance: () => requests.filter((r) => r.url.includes('performance')) };
}
function payload(overrides = {}) {
  return { ok: true, connected: true, status: 'ready', generatedAt: '2026-09-06T00:00:00Z',
    dateWindows: { current: { startDate: '2026-08-09', endDate: '2026-09-05' } },
    totals: { current: { clicks: 0, impressions: 0, ctr: 0, position: 0 } }, rows: {}, actionQueue: [], ...overrides };
}

test('loading and failed requests never masquerade as measured zero traffic', async (t) => {
  const f = fixture(t);
  assert.equal(f.get('[data-seo-metric="clicks"]').textContent, '—');
  assert.equal(f.root.attrs['aria-busy'], 'true');
  await f.respond(f.performance()[0], payload());
  assert.equal(f.get('[data-seo-metric="clicks"]').textContent, '0');
  assert.equal(f.get('[data-seo-delta="ctr"]').textContent, '0,0 pp vs vorige periode');
  f.groups['[data-seo-days]'][0].fire('click');
  assert.equal(f.get('[data-seo-metric="clicks"]').textContent, '—');
  await f.respond(f.performance()[1], { error: 'Unavailable' }, false);
  assert.equal(f.get('[data-seo-metric="clicks"]').textContent, '—');
  assert.equal(f.get('[data-seo-performance-status]').dataset.tone, 'warning');
  assert.match(f.get('[data-seo-empty-title]').textContent, /kon niet laden/);
  assert.doesNotMatch(f.get('[data-seo-actions]').innerHTML, /Geen directe rode vlaggen/);
});

test('the latest selected period wins when requests finish in reverse order', async (t) => {
  const f = fixture(t);
  assert.match(f.performance()[0].url, /days=28$/);
  f.groups['[data-seo-days]'][2].fire('click');
  f.groups['[data-seo-days]'][0].fire('click');
  const requests = f.performance();
  await f.respond(requests[2], payload({ totals: { current: { clicks: 7 } } }));
  await f.respond(requests[1], payload({ totals: { current: { clicks: 90 } } }));
  await f.respond(requests[0], payload({ totals: { current: { clicks: 28 } } }));
  assert.equal(f.get('[data-seo-metric="clicks"]').textContent, '7');
  assert.equal(f.groups['[data-seo-days]'][0].attrs['aria-pressed'], 'true');
  assert.equal(f.groups['[data-seo-days]'][2].attrs['aria-pressed'], 'false');
  assert.equal(f.root.attrs['aria-busy'], 'false');
});

test('the chart covers the complete period and its axis follows the selected metric', async (t) => {
  const f = fixture(t);
  const dates = Array.from({ length: 90 }, (_, index) => ({ label: new Date(Date.UTC(2026, 5, 8 + index)).toISOString().slice(0, 10), clicks: 4, impressions: 400 }));
  await f.respond(f.performance()[0], payload({ rows: { dates } }));
  const points = f.get('[data-seo-chart]').innerHTML.match(/points="([^"]+)"/)[1];
  assert.equal(points.split(' ').length, 90);
  assert.match(f.get('[data-seo-date-label]').textContent, /08-06-2026/);
  assert.doesNotMatch(f.get('[data-seo-y-axis]').innerHTML, /400/);
  f.groups['[data-seo-chart-metric]'][1].fire('click');
  assert.match(f.get('[data-seo-y-axis]').innerHTML, /400/);
  assert.equal((f.get('[data-seo-chart]').innerHTML.match(/<polyline/g) || []).length, 1);
  assert.match(f.get('[data-seo-chart]').innerHTML, /line--impressions/);
  assert.equal(f.get('[data-seo-chart-caption]').textContent, 'Vertoningen per dag');
});

test('table pagination, search and sorting retain every returned row without unsafe markup', async (t) => {
  const f = fixture(t);
  const queries = Array.from({ length: 25 }, (_, index) => ({ label: `term ${String(index).padStart(2, '0')}`, clicks: index, impressions: 25 - index, position: index === 0 ? 0 : index }));
  queries[24].label = 'A < B & C';
  await f.respond(f.performance()[0], payload({ rows: { queries } }));
  assert.equal(f.get('[data-seo-table-count]').textContent, '1–8 van 25 resultaten');
  assert.equal((f.get('[data-seo-table-body]').innerHTML.match(/<tr>/g) || []).length, 8);
  assert.match(f.get('[data-seo-table-body]').innerHTML, /A &lt; B &amp; C/);
  f.get('[data-seo-table-next]').fire('click');
  assert.equal(f.get('[data-seo-table-count]').textContent, '9–16 van 25 resultaten');
  const search = f.get('[data-seo-table-search]'); search.value = 'term 00'; search.fire('input');
  assert.equal(f.get('[data-seo-table-count]').textContent, '1–1 van 1 resultaten');
  assert.equal(f.get('[data-seo-table-next]').disabled, true);
  assert.equal(f.get('[data-seo-table-prev]').disabled, true);
  search.value = ''; search.fire('input');
  const sort = f.get('[data-seo-table-sort]'); sort.value = 'position'; sort.fire('change');
  assert.match(f.get('[data-seo-table-body]').innerHTML, /^<tr><td title="term 01"/);
  assert.doesNotMatch(f.get('[data-seo-table-body]').innerHTML, /term 00/);
});

test('more priorities remain available and page links only open Softora URLs', async (t) => {
  const f = fixture(t);
  await f.respond(f.performance()[0], payload({ actionQueue: Array.from({ length: 7 }, (_, i) => ({ priority: 'hoog', action: `Actie ${i}` })), rows: { pages: [{ label: 'https://www.softora.nl/blog/kosten', clicks: 2 }, { label: 'https://example.org/', clicks: 1 }] } }));
  assert.equal(f.get('[data-seo-action-count]').textContent, '7');
  assert.match(f.get('[data-seo-actions]').innerHTML, /<details[^>]*><summary>Meer prioriteiten \(4\)/);
  assert.match(f.get('[data-seo-actions]').innerHTML, /Actie 6/);
  f.groups['[data-seo-table-tab]'][1].fire('click');
  assert.match(f.get('[data-seo-table-body]').innerHTML, /href="https:\/\/www\.softora\.nl\/blog\/kosten"/);
  assert.doesNotMatch(f.get('[data-seo-table-body]').innerHTML, /href="https:\/\/example\.org/);
});

test('CTR changes keep their sign and percentage-point unit', async (t) => {
  const f = fixture(t);
  await f.respond(f.performance()[0], payload({ totals: { current: { ctr: 0.014 }, ctrDelta: 0.004 } }));
  assert.equal(f.get('[data-seo-metric="ctr"]').textContent, '1,4%');
  assert.equal(f.get('[data-seo-delta="ctr"]').textContent, '+0,4 pp vs vorige periode');
  f.groups['[data-seo-days]'][0].fire('click');
  await f.respond(f.performance()[1], payload({ totals: { current: { ctr: 0.008 }, ctrDelta: -0.002 } }));
  assert.equal(f.get('[data-seo-delta="ctr"]').textContent, '-0,2 pp vs vorige periode');
});

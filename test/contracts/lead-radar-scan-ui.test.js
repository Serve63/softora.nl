'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function mount({ scan, signals = () => [], storageConfigured = true } = {}) {
  const nodes = new Map();
  const intervals = [];
  let lastRun = null;
  const requests = [];
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, disabled: false, textContent: '', innerHTML: '',
      classList: { add() {}, remove() {} },
      addEventListener(event, handler) { this[event] = handler; },
    });
    return nodes.get(selector);
  };
  const globals = {
    document: { querySelector: node, hidden: false },
    window: { setInterval: (handler) => intervals.push(handler) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      let body;
      if (url.endsWith('/scan')) { lastRun = await scan(JSON.parse(options.body)); body = { run: lastRun }; }
      else if (url.endsWith('/status')) body = { storageConfigured, provider: { configured: true }, counts: { total: 0, new: 0 }, lastRun };
      else { const rows = signals(); body = { signals: rows, total: rows.length }; }
      return { ok: true, json: async () => ({ ok: true, ...body }) };
    },
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const scriptPath = require.resolve('../../assets/lead-radar.js');
  delete require.cache[scriptPath];
  require('../../assets/lead-radar.js');
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete require.cache[scriptPath];
  };
  return { node, requests, restore, poll: () => intervals[0]() };
}

test('Scanknop blijft geblokkeerd tijdens een aanvraag en het resultaat blijft zichtbaar', async (t) => {
  let resolveScan;
  const ui = mount({ scan: () => new Promise((resolve) => { resolveScan = resolve; }) });
  t.after(ui.restore);
  await settle();
  assert.equal(ui.node('#scan-button').disabled, false);
  const scanning = ui.node('#scan-button').click();
  await settle();
  assert.equal(ui.node('#scan-button').disabled, true);
  ui.poll();
  await ui.node('#scan-button').click();
  assert.equal(ui.requests.filter((request) => request.url.endsWith('/scan')).length, 1);
  resolveScan({ status: 'completed', finished_at: new Date().toISOString(), result_count: 24, filtered_count: 24, new_signal_count: 0, source_checks: [{ platform: 'mastodon', term: 'website', source_url: 'https://mastodon.nl', status: 'completed', result_count: 24 }] });
  await scanning;
  assert.equal(ui.node('#scan-button').disabled, false);
  assert.equal(ui.node('#scan-summary').hidden, false);
  assert.match(ui.node('#scan-summary').innerHTML, /24 berichten bekeken.*24 niet geselecteerd/);
  assert.match(ui.node('#scan-summary').innerHTML, /mastodon.nl/);
  assert.equal(ui.node('#scan-progress').hidden, true);
});

test('Een mislukte scan houdt zijn fout zichtbaar en kan opnieuw worden gestart', async (t) => {
  const ui = mount({ scan: async () => { throw new Error('Verbinding verbroken'); } });
  t.after(ui.restore);
  await settle();
  await ui.node('#scan-button').click();
  assert.equal(ui.node('#scan-progress').hidden, false);
  assert.match(ui.node('#scan-progress-label').textContent, /Scan niet afgerond: Verbinding verbroken/);
  assert.equal(ui.node('#scan-button').disabled, false);
});

test('Een gepauzeerde scan gaat met hetzelfde run-ID verder', async (t) => {
  const payloads = [];
  const ui = mount({ scan: async (payload) => {
    payloads.push(payload);
    return { id: 'existing-run', status: payload.runId ? 'completed' : 'paused', query_cursor: payload.runId ? 6 : 3 };
  } });
  t.after(ui.restore);
  await settle();
  await ui.node('#scan-button').click();
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].runId, undefined);
  assert.equal(payloads[1].runId, 'existing-run');
});

test('Achtergrondfout wist bestaande leads niet en ontbrekende opslag blokkeert de scan', async (t) => {
  let fail = false;
  const ui = mount({ signals: () => {
    if (fail) throw new Error('Opslag tijdelijk niet bereikbaar');
    return [{ platform: 'web', post_url: 'https://example.com/vraag', display_summary: 'Website gezocht voor onze winkel.' }];
  } });
  t.after(ui.restore);
  await settle();
  const previous = ui.node('#lead-list').innerHTML;
  assert.match(previous, /Website gezocht voor onze winkel/);
  fail = true;
  ui.poll();
  await settle();
  assert.equal(ui.node('#lead-list').innerHTML, previous);
  assert.match(ui.node('#inbox-state').textContent, /konden niet worden bijgewerkt/);
  ui.restore();
  const unavailable = mount({ storageConfigured: false });
  t.after(unavailable.restore);
  await settle();
  assert.equal(unavailable.node('#scan-button').disabled, true);
  assert.match(unavailable.node('#provider-banner').innerHTML, /Opslag tijdelijk niet beschikbaar/);
});

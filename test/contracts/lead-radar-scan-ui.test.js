'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/lead-radar.js'), 'utf8');
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
  vm.runInNewContext(source, {
    document: { querySelector: node, hidden: false },
    window: { setInterval: (handler) => intervals.push(handler) },
    URL, URLSearchParams, Intl, Date,
    fetch: async (url, options) => {
      requests.push({ url, options });
      let body;
      if (url.endsWith('/scan')) { lastRun = await scan(JSON.parse(options.body)); body = { run: lastRun }; }
      else if (url.endsWith('/status')) body = { storageConfigured, provider: { configured: true }, counts: { total: 0, new: 0 }, lastRun };
      else { const rows = signals(); body = { signals: rows, total: rows.length }; }
      return { ok: true, json: async () => ({ ok: true, ...body }) };
    },
  });
  return { node, requests, poll: () => intervals[0]() };
}

test('Scanknop blijft geblokkeerd tijdens een aanvraag en het resultaat blijft zichtbaar', async () => {
  let resolveScan;
  const ui = mount({ scan: () => new Promise((resolve) => { resolveScan = resolve; }) });
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

test('Een mislukte scan houdt zijn fout zichtbaar en kan opnieuw worden gestart', async () => {
  const ui = mount({ scan: async () => { throw new Error('Verbinding verbroken'); } });
  await settle();
  await ui.node('#scan-button').click();
  assert.equal(ui.node('#scan-progress').hidden, false);
  assert.match(ui.node('#scan-progress-label').textContent, /Scan niet afgerond: Verbinding verbroken/);
  assert.equal(ui.node('#scan-button').disabled, false);
});

test('Een gepauzeerde scan gaat met hetzelfde run-ID verder', async () => {
  const payloads = [];
  const ui = mount({ scan: async (payload) => {
    payloads.push(payload);
    return { id: 'existing-run', status: payload.runId ? 'completed' : 'paused', query_cursor: payload.runId ? 6 : 3 };
  } });
  await settle();
  await ui.node('#scan-button').click();
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].runId, undefined);
  assert.equal(payloads[1].runId, 'existing-run');
});

test('Achtergrondfout wist bestaande leads niet en ontbrekende opslag blokkeert de scan', async () => {
  let fail = false;
  const ui = mount({ signals: () => {
    if (fail) throw new Error('Opslag tijdelijk niet bereikbaar');
    return [{ platform: 'web', post_url: 'https://example.com/vraag', display_summary: 'Website gezocht voor onze winkel.' }];
  } });
  await settle();
  const previous = ui.node('#lead-list').innerHTML;
  assert.match(previous, /Website gezocht voor onze winkel/);
  fail = true;
  ui.poll();
  await settle();
  assert.equal(ui.node('#lead-list').innerHTML, previous);
  assert.match(ui.node('#inbox-state').textContent, /konden niet worden bijgewerkt/);
  const unavailable = mount({ storageConfigured: false });
  await settle();
  assert.equal(unavailable.node('#scan-button').disabled, true);
  assert.match(unavailable.node('#provider-banner').innerHTML, /Opslag tijdelijk niet beschikbaar/);
});

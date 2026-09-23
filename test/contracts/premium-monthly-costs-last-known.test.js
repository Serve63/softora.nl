const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createReadModelStore } = require('../../assets/premium-readmodel-store');

const scriptSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-monthly-costs-dynamic.js'), 'utf8');

function createStorage() {
  const map = new Map();
  return { map, get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
}

function loadPage({ storage, fetchImpl }) {
  const renders = [];
  const data = { 'Totale kosten:': [{ naam: 'Supabase', bedrag: 33, currency: 'eur', note: '', status: '' }] };
  const window = {
    location: { origin: 'https://softora.test' },
    softoraMonthlyCostsData: data,
    softoraMonthlyCostsRender: () => renders.push(data['Totale kosten:'][0].bedrag),
    SoftoraReadModelStore: createReadModelStore({ localStorage: storage }),
    SoftoraPageBootstrapSession: { get: () => ({ authenticated: true, email: 'serve@softora.nl' }) },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, addEventListener() {},
  };
  const document = { readyState: 'complete', hidden: false, addEventListener() {} };
  vm.runInNewContext(scriptSource, { window, document, URL, fetch: fetchImpl, console: { warn() {}, error() {}, log() {} } });
  return { item: data['Totale kosten:'][0], renders };
}

const livePayload = { ok: true, summary: { costEur: 46.18, exact: false, addons: 1, baseCostLinked: true } };

test('terugkerende kosten opent met de laatst bekende live bedragen en ververst daarna', async () => {
  const storage = createStorage();
  const first = loadPage({ storage, fetchImpl: async () => ({ ok: true, status: 200, json: async () => livePayload }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.item.bedrag, 46.18, 'the live read updates the amount');
  assert.equal(storage.map.size, 1, 'the verified live amount is remembered');

  let releaseLive;
  const second = loadPage({ storage, fetchImpl: () => new Promise((resolve) => { releaseLive = resolve; }) });
  assert.equal(second.item.bedrag, 46.18, 'the page opens with the last verified amount before any request returns');
  assert.equal(second.item.amountLabel, 'Vanaf €46,18');
  releaseLive({ ok: true, status: 200, json: async () => ({ ok: true, summary: { ...livePayload.summary, costEur: 47 } }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.item.bedrag, 47, 'a changed live amount still replaces the remembered one');
});

test('laatst bekende bedragen gelden niet voor een andere gebruiker of maand', () => {
  const storage = createStorage();
  const key = 'softora-readmodel-sync:premium-monthly-costs:last-known:supabase';
  storage.setItem(key, JSON.stringify({ identity: 'serve@softora.nl', savedAt: Date.now(),
    value: { month: '2020-01', savedAt: Date.now(), payload: livePayload } }));
  const oldMonth = loadPage({ storage, fetchImpl: () => new Promise(() => {}) });
  assert.equal(oldMonth.item.bedrag, 33);

  storage.setItem(key, JSON.stringify({ identity: 'ander@softora.nl', savedAt: Date.now(),
    value: { month: 'any', savedAt: Date.now(), payload: livePayload } }));
  const otherUser = loadPage({ storage, fetchImpl: () => new Promise(() => {}) });
  assert.equal(otherUser.item.bedrag, 33);
  assert.equal(storage.map.size, 0, "another user's copy is wiped");
});

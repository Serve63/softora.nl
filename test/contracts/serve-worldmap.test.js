const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SCOPE, filterCountries, createProgressStore } = require('../../assets/serve-worldmap');
const { countries } = require('../../assets/serve-worldmap-countries.json');
const { createRuntimeOpsCoordinator } = require('../../server/services/runtime-ops');
const { createAdminOnlyUiStateScopesSet } = require('../../server/config/admin-ui-state-scopes');
const { createPremiumAdminOnlyHtmlFilesSet } = require('../../server/config/premium-admin-html-files');

const snapshot = (values = {}) => ({ ok: true, source: 'supabase', values });
function fixture(initial = {}) {
  let values = { ...initial }; const writes = [];
  const client = { invalidate() {}, async get() { return snapshot({ ...values }); }, async set(scope, body) { writes.push({ scope, body }); values = { ...values, ...body.patch }; return snapshot({ ...values }); } };
  return { client, writes, store: createProgressStore(client, countries) };
}
test('world map uses unique geographic identities, Dutch labels, valid geometry and all six inhabited continents', () => {
  assert.equal(countries.length, 239); assert.equal(new Set(countries.map((country) => country.code)).size, countries.length);
  assert.equal(new Set(countries.map((country) => country.continent)).size, 6);
  for (const code of ['NL', 'BE', 'FR', 'US', 'AU', 'NZ', 'JP', 'VA', 'MC', 'SG', 'MV']) assert.ok(countries.some((country) => country.code === code), code);
  assert.equal(countries.find((country) => country.code === 'NL').name, 'Nederland');
  for (const country of countries) { assert.match(country.code, /^[A-Z]{2,3}$/); assert.match(country.path, /^M[\d.,LMZ-]+Z$/); assert.ok(country.center.every(Number.isFinite)); assert.ok(country.name); }
  assert.equal(countries.find((country) => country.code === 'VA').small, true);
});
test('search is accent-insensitive and combines visited filters with both Dutch and English country names', () => {
  const visited = new Set(['NL']);
  assert.deepEqual(filterCountries(countries, visited, 'nederland', 'visited').map((country) => country.code), ['NL']);
  assert.equal(filterCountries(countries, visited, 'Netherlands', 'locked').length, 0);
  assert.equal(filterCountries(countries, visited, 'belgie')[0].code, 'BE');
  assert.equal(filterCountries(countries, visited, 'no such country').length, 0);
});
test('unlock, independent device reload and undo persist only a country patch and preserve other visits', async () => {
  const { client, store, writes } = fixture({ visited_be: '1', unrelated: 'preserve' });
  assert.equal(await store.save('NL', true), false); assert.equal(writes.length, 0);
  await store.load(); assert.deepEqual([...store.state.visited], ['BE']);
  assert.equal(await store.save('NL', true), true);
  assert.deepEqual(writes[0], { scope: SCOPE, body: { patch: { visited_nl: '1' }, source: 'serve-worldmap' } });
  const secondDevice = createProgressStore(client, countries); await secondDevice.load(); assert.equal(secondDevice.state.visited.has('NL'), true);
  assert.equal(await secondDevice.save('NL', false), true); await store.load();
  assert.equal(store.state.visited.has('NL'), false); assert.equal(store.state.visited.has('BE'), true);
  assert.equal((await client.get()).values.unrelated, 'preserve');
  assert.equal(await store.save('UNKNOWN', true), false); assert.equal(await store.save('NL', 'true'), false);
});
test('failed reads and memory-only snapshots never enable edits or manufacture zero saved visits', async () => {
  for (const data of [{ ok: true, source: 'memory', values: {} }, { ok: false, source: 'supabase', values: {} }, { ok: true, source: 'supabase', values: [] }]) {
    const { store, client, writes } = fixture({ visited_nl: '1' }); await store.load(); client.get = async () => data;
    assert.equal(await store.load(), false); assert.equal(store.state.ready, false); assert.equal(store.state.visited.has('NL'), true);
    assert.equal(await store.save('BE', true), false); assert.equal(writes.length, 0);
  }
});
test('failed saves stay unvisited, and ambiguous timeouts reconcile a committed write', async () => {
  const { store, client } = fixture(); await store.load(); client.set = async () => { throw new Error('offline'); };
  assert.equal(await store.save('NL', true), false); assert.equal(store.state.visited.has('NL'), false); assert.ok(store.state.error);
  client.get = async () => snapshot({ visited_nl: '1' });
  assert.equal(await store.save('NL', true), true); assert.equal(store.state.visited.has('NL'), true); assert.equal(store.state.error, '');
  client.get = async () => { throw new Error('offline'); };
  assert.equal(await store.save('BE', true), false); assert.equal(store.state.ready, false); assert.equal(store.state.visited.has('NL'), true);
});
test('writes serialize while pending and never turn green before durable confirmation', async () => {
  const { store, client } = fixture(); await store.load(); let complete;
  client.set = () => new Promise((resolve) => { complete = resolve; });
  const saving = store.save('NL', true); assert.equal(store.state.busy, true); assert.equal(store.state.visited.has('NL'), false);
  assert.equal(await store.save('BE', true), false); assert.equal(await store.load(), false);
  complete(snapshot({ visited_nl: '1' })); assert.equal(await saving, true); assert.equal(store.state.visited.has('NL'), true); assert.equal(store.state.busy, false);
});
test('travel page and existing state API require Full Access before any private data read or write', async () => {
  assert.equal(createPremiumAdminOnlyHtmlFilesSet().has('premium-wereldmap.html'), true);
  assert.equal(createAdminOnlyUiStateScopesSet().has(SCOPE), true);
  let reads = 0, writes = 0;
  const coordinator = createRuntimeOpsCoordinator({ normalizeUiStateScope: (value) => value, getUiStateValues: async () => { reads++; return snapshot(); }, setUiStateValues: async () => { writes++; return snapshot(); } });
  for (const premiumAuth of [{ authenticated: false, isAdmin: false }, { authenticated: true, isAdmin: false }]) {
    for (const method of ['sendUiStateGetResponse', 'sendUiStateSetResponse']) {
      const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await coordinator[method]({ premiumAuth, body: { patch: { visited_nl: '1' } } }, res, SCOPE); assert.equal(res.statusCode, 403);
    }
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
});
test('world map ships external logic, accessible search and zoom with no browser storage of travel history', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const html = read('premium-wereldmap.html'), script = read('assets/serve-worldmap.js');
  assert.match(html, /name="robots" content="noindex, nofollow"/); assert.match(html, /id="wm-unlock"[^>]*disabled/); assert.match(html, /id="wm-search"/); assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(script, /innerHTML|localStorage|sessionStorage/); assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(script, /pointercancel/); assert.match(script, /visibilitychange/); assert.match(script, /ArrowLeft/);
});

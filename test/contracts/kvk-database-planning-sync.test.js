const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'assets/kvk-database.js'), 'utf8');
const fast = fs.readFileSync(path.join(root, 'assets/kvk-database-fast-progress.js'), 'utf8');
const time = seconds => `2026-09-15T20:00:${String(seconds).padStart(2, '0')}Z`;

// Synthetic fixtures only; no operational company or location exports.
function full(seconds, code = 'TEST-1', treated = 10) {
  return {
    generatedAt: time(seconds),
    state: { treated, companies_found: 100, processed_location_codes: [code],
      contact_location_progress: { existing_total: 1 } },
    locations: [{ woonplaatscode: code, woonplaats: code, volgorde: 1,
      land: 'Testland', provincie: 'Testprovincie', gemeente: 'Testgemeente' }],
    companies: { all: [{ bedrijfsnaam: 'Synthetic company', kvk_nummer: 'TEST' }] },
    companyTotals: { all: 100, usable: treated },
    latestTreated: [{ bedrijfsnaam: `full-${seconds}`, lead_status: 'usable' }],
  };
}

function progress(seconds, treated = 20) {
  return { generatedAt: time(seconds), state: { treated },
    companyTotals: { usable: treated },
    latestTreated: [{ bedrijfsnaam: `progress-${seconds}`, lead_status: 'usable' }] };
}

// Execute the real browser scripts, including init(), with controllable fetch
// completion. This reproduces the startup race, not a reference implementation.
function browser(initial = full(10), withFast = true) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: id === 'kvkSnapshot' ? '{}' : '', innerHTML: '', value: '',
      scrollTop: 0, clientHeight: 0, scrollHeight: 0,
      addEventListener() {}, setAttribute() {}, classList: { toggle() {} },
    });
    return elements.get(id);
  };
  let response = initial;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  const intervals = [];
  const requests = [];
  const context = vm.createContext({
    URL, URLSearchParams, console, location: { origin: 'https://example.test' },
    document: { hidden: false, title: 'Test', getElementById: element,
      querySelectorAll: () => [], addEventListener() {} },
    history: { state: {}, replaceState() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    setTimeout, clearTimeout, addEventListener() {}, dispatchEvent() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith('/api/kvk-database/snapshot?')) {
        if (first) { first = false; await gate; }
        return { ok: true, json: async () => ({ snapshot: response }) };
      }
      return { ok: false };
    },
  });
  context.window = context;
  context.parent = context;
  const boot = vm.runInContext(core, context, { filename: 'kvk-database.js' });
  if (withFast) vm.runInContext(fast, context, { filename: 'kvk-database-fast-progress.js' });
  return {
    element, requests, intervals,
    async start() { release(); await boot; },
    async refresh(snapshot) {
      response = snapshot;
      await vm.runInContext('refreshDashboard({reloadTables:false})', context);
    },
    merge(value) {
      context.input = value;
      return vm.runInContext('SoftoraKvkFastProgress.mergeProgress(input)', context);
    },
    inspect() {
      return JSON.parse(vm.runInContext('JSON.stringify({snapshot:activeSnapshot,clock:activeSnapshotTime,state})', context));
    },
  };
}

test('planning hydrates when fast progress arrives before the first full snapshot', async () => {
  const app = browser();
  assert.equal(app.merge(progress(20, 21)), true);
  await app.start();
  const result = app.inspect();
  assert.equal(result.state.locations.length, 1);
  assert.match(app.element('location-list').innerHTML, /TEST-1/);
  assert.doesNotMatch(app.element('location-list').innerHTML, /Nog geen locaties/);
  assert.equal(result.state.scraper.treated, 21);
  assert.equal(result.snapshot.latestTreated[0].bedrijfsnaam, 'progress-20');
  assert.equal(result.clock, Date.parse(time(10)), 'partial updates do not advance the full clock');
  assert.equal(result.snapshot.companies.all.length, 1);
});

test('a later full snapshot refreshes planning without rolling back newer counters', async () => {
  const app = browser();
  await app.start();
  app.merge(progress(30, 30));
  const next = full(20, 'TEST-2', 20);
  next.state.contact_search_completed_location_codes = ['TEST-2'];
  await app.refresh(next);
  const result = app.inspect();
  assert.equal(result.state.locations[0].woonplaatscode, 'TEST-2');
  assert.deepEqual(result.state.scraper.contact_search_completed_location_codes, ['TEST-2']);
  assert.equal(result.state.scraper.treated, 30);
  assert.equal(result.snapshot.latestTreated[0].bedrijfsnaam, 'progress-30');
  assert.equal(result.clock, Date.parse(time(20)));
  assert.match(app.element('location-list').innerHTML, /TEST-2/);
});

test('full-first startup retains planning through fast updates and rejects old responses', async () => {
  const app = browser(full(20));
  await app.start();
  assert.equal(app.merge(progress(40, 40)), true);
  assert.equal(app.merge(progress(30, 30)), false);
  await app.refresh(full(10, 'STALE', 1));
  const result = app.inspect();
  assert.equal(result.state.locations[0].woonplaatscode, 'TEST-1');
  assert.equal(result.state.scraper.treated, 40);
  assert.equal(result.clock, Date.parse(time(20)));
});

test('a genuinely newer full response wins, including legitimate counter corrections', async () => {
  const app = browser();
  await app.start();
  app.merge(progress(20, 90));
  await app.refresh(full(30, 'TEST-3', 12));
  assert.equal(app.merge(progress(25, 99)), false);
  const result = app.inspect();
  assert.equal(result.state.scraper.treated, 12);
  assert.equal(result.snapshot.companyTotals.usable, 12);
  assert.equal(result.snapshot.latestTreated[0].bedrijfsnaam, 'full-30');
  assert.equal(result.state.locations[0].woonplaatscode, 'TEST-3');
});

test('progress ordering compares instants rather than timestamp spellings', async () => {
  const app = browser();
  await app.start();
  assert.equal(app.merge({ ...progress(20), generatedAt: '2026-09-15T22:00:20+02:00' }), true);
  assert.equal(app.merge(progress(30, 31)), true);
  assert.equal(app.inspect().state.scraper.treated, 31);
  assert.equal(app.merge(progress(25)), false);
});

test('partial updates cannot erase canonical locations or company rows', async () => {
  const app = browser();
  await app.start();
  app.merge({ ...progress(20), locations: [], companies: {} });
  const result = app.inspect();
  assert.equal(result.snapshot.locations.length, 1);
  assert.equal(result.snapshot.companies.all.length, 1);
  assert.equal(result.clock, Date.parse(time(10)));
});

test('missing or invalid progress timestamps never replace reliable data', async () => {
  const app = browser();
  await app.start();
  for (const value of [null, {}, { state: [] }, { state: {} },
    { ...progress(20), generatedAt: 'invalid' }]) {
    assert.equal(app.merge(value), false);
  }
  assert.equal(app.inspect().state.scraper.treated, 10);
});

test('the full dashboard remains usable when the fast script or endpoint is unavailable', async () => {
  for (const withFast of [false, true]) {
    const app = browser(full(10), withFast);
    await app.start();
    assert.equal(app.inspect().state.locations.length, 1);
    await app.refresh(full(20, 'FALLBACK', 22));
    assert.equal(app.inspect().state.scraper.treated, 22);
    assert.match(app.element('location-list').innerHTML, /FALLBACK/);
    assert.ok(app.intervals.some(item => item.ms === 15000));
    for (const request of app.requests) {
      assert.equal(request.options.cache, 'no-store');
      assert.equal(request.options.credentials, 'same-origin');
    }
  }
});

test('the planning list hydrates at production-sized scale without fabricated rows', async () => {
  const snapshot = full(10);
  snapshot.locations = Array.from({ length: 2502 }, (_, i) => ({
    ...snapshot.locations[0], woonplaatscode: `TEST-${i}`, woonplaats: `TEST-${i}`, volgorde: i + 1,
  }));
  snapshot.state.contact_location_progress.existing_total = 2502;
  const app = browser(snapshot);
  app.merge(progress(20));
  await app.start();
  assert.equal(app.inspect().state.locations.length, 2502);
  assert.equal((app.element('location-list').innerHTML.match(/class="location-item"/g) || []).length, 2502);
});

test('a truly empty canonical planning stays empty rather than retaining fabricated progress rows', async () => {
  const app = browser();
  await app.start();
  app.merge(progress(30));
  const snapshot = full(20);
  snapshot.locations = [];
  snapshot.state.contact_location_progress.existing_total = 0;
  await app.refresh(snapshot);
  assert.equal(app.inspect().state.locations.length, 0);
  assert.match(app.element('location-list').innerHTML, /Nog geen locaties/);
  assert.equal(app.inspect().state.scraper.treated, 20);
});

test('both changed browser assets have fresh cache keys and preserve script ordering', () => {
  const page = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  const coreUrl = '/assets/kvk-database.js?v=20260914-fast-progress-planning-sync';
  const fastUrl = '/assets/kvk-database-fast-progress.js?v=20260915b-planning-sync';
  assert.ok(page.includes(coreUrl));
  assert.ok(page.includes(fastUrl));
  assert.ok(page.indexOf(coreUrl) < page.indexOf(fastUrl));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveColdmailStatsResponse } = require('../../server/services/coldmail-live-stats-response');
const { COLDMAIL_SENT_TIMESTAMP_MODEL } = require('../../server/services/coldmail-guard-sent-at');
const root = path.join(__dirname, '../..');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const cached = () => ({ ok: true, stats: {
  reliable: true, dateKey: '2026-09-08', updatedAt: '2026-09-08T19:00:00.000Z',
  authoritativeSource: 'central-outbound-recipient-guard', sentTimestampModel: COLDMAIL_SENT_TIMESTAMP_MODEL,
  systemTotalSent: 3500, systemSentToday: 70,
} });

test('slow stats refresh returns proven current-day counters without extending their timestamp', async () => {
  const refresh = deferred();
  const previous = cached();
  const result = await resolveColdmailStatsResponse(refresh.promise, previous, '2026-09-08', 5);
  assert.equal(result.stats.systemTotalSent, 3500);
  assert.equal(result.stats.systemSentToday, 70);
  assert.equal(result.stats.authoritativeStatsStale, true);
  assert.equal(result.stats.updatedAt, previous.stats.updatedAt);
  assert.equal(previous.stats.authoritativeStatsStale, undefined);
  refresh.resolve({ ok: true, stats: { systemTotalSent: 3501 } });
  assert.equal((await refresh.promise).stats.systemTotalSent, 3501);
});

test('fast stats refresh wins; yesterday and unproven totals never become today fallback', async () => {
  const fresh = { ok: true, stats: { systemTotalSent: 3501 } };
  assert.equal(await resolveColdmailStatsResponse(Promise.resolve(fresh), cached(), '2026-09-08'), fresh);
  for (const [previous, day] of [[cached(), '2026-09-09'], [{ ...cached(), stats: { ...cached().stats, reliable: false } }, '2026-09-08']]) {
    const refresh = deferred();
    let settled = false;
    const response = resolveColdmailStatsResponse(refresh.promise, previous, day, 1).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(settled, false);
    refresh.resolve(fresh);
    assert.equal(await response, fresh);
  }
});

test('complete snapshot becomes visible while canonical customer details are still pending, without loading legacy photos', async () => {
  const page = fs.readFileSync(path.join(root, 'premium-database.html'), 'utf8');
  const snapshot = deferred(), customers = deferred();
  const state = {
    klanten: [{ id: 'available-1', availableSnapshot: true }],
    mailReadySnapshotLoaded: true, mailReadySnapshotTotal: 0, mailReadySnapshotCustomers: [],
    availableSnapshotLoaded: true, availableSnapshotTotal: 1,
    availableSnapshotCustomers: [{ id: 'available-1', availableSnapshot: true }],
    foundSnapshotLoaded: true, foundSnapshotTotal: 0, foundSnapshotCustomerIdSet: new Set(),
    canonicalSnapshotApplied: true, remoteCustomersLoaded: false,
  };
  let photoReads = 0, readyRenders = 0, finished = false;
  const window = { SoftoraDatabaseResilience: {}, SoftoraDatabaseMailReadySnapshot: null };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/premium-database-mail-ready-snapshot.js'), 'utf8'), { window });
  window.SoftoraDatabaseMailReadySnapshot.load = () => snapshot.promise;
  const sandbox = {
    window, state, console, databaseHadBootstrapCustomers: true, databaseHasFastSnapshotBootstrap: false,
    normalizeCustomer: (value) => value, applyCustomerList() {},
    renderPage() { if (state.canonicalInventoryReady) readyRenders += 1; },
    bootstrapCustomers: () => customers.promise,
    loadCustomerPhotoMap() { photoReads += 1; return new Promise(() => {}); },
    webdesignActionController: { preloadPhotoImages: async () => {} },
    getSortedCustomers: (rows) => rows, getFilteredCustomers: () => state.klanten,
    releaseDatabaseBootShell() {}, databasePendingJobsPromise: Promise.resolve(),
    databaseImportController: { startAutoSync() { finished = true; } },
  };
  vm.runInNewContext(page.match(/async function loadMailReadySnapshot\(\) \{[^\n]+/)[0], sandbox);
  const boot = page.slice(page.lastIndexOf('void (async function () {'), page.lastIndexOf('})();') + 5);
  vm.runInNewContext(boot, sandbox);
  snapshot.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.remoteCustomersLoaded, false);
  assert.equal(state.canonicalInventoryReady, true);
  assert.ok(readyRenders > 0);
  assert.equal(photoReads, 0);
  customers.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, true);
  assert.equal(photoReads, 0);
});

test('a valid design website is independent of email eligibility while mail readiness stays blocked', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/premium-database-webdesign-asset-state.js'), 'utf8'), { window });
  const build = window.SoftoraDatabaseWebdesignAssetState.buildWebdesignAssetState;
  const helpers = { isMailLeadEligible: () => false };
  for (const email of ['first@example.test; second@example.test', '', 'invalid']) {
    const customer = { id: 'design-1', website: 'https://example.test/contact', email };
    assert.equal(build(customer, helpers).canGeneratePhoto, true);
    assert.equal(build({ ...customer, hasPhoto: true, hasMockup: true }, helpers).isMailReady, false);
    assert.equal(build({ ...customer, hasPhoto: true }, helpers).canGeneratePhoto, false);
  }
  assert.equal(build({ id: 'no-website' }, helpers).canGeneratePhoto, false);
});

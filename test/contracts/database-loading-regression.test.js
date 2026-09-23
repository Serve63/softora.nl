const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snapshotClient = require('../../assets/premium-database-mail-ready-snapshot');
const assetClient = require('../../assets/premium-database-webdesign-asset-state');
const bootClient = require('../../assets/premium-database-boot');
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

test('compact snapshot waits for canonical details and defers the boot render', async () => {
  const page = fs.readFileSync(path.join(root, 'premium-database.html'), 'utf8');
  const snapshot = deferred(), customers = deferred(), ready = deferred();
  const state = {
    klanten: [{ id: 'available-1', availableSnapshot: true }],
    mailReadySnapshotLoaded: true, mailReadySnapshotTotal: 0, mailReadySnapshotCustomers: [],
    availableSnapshotLoaded: true, availableSnapshotTotal: 1,
    availableSnapshotCustomers: [{ id: 'available-1', availableSnapshot: true }],
    foundSnapshotLoaded: true, foundSnapshotTotal: 0, foundSnapshotCustomerIdSet: new Set(),
    canonicalSnapshotApplied: true, remoteCustomersLoaded: false,
  };
  let photoReads = 0, readyRenders = 0, finished = false, releases = 0, readinessCalls = 0;
  const sandbox = {
    snapshotClient, state, console, databaseHadBootstrapCustomers: true, databaseHasFastSnapshotBootstrap: false,
    normalizeCustomer: (value) => value, applyCustomerList() {},
    renderPage() { if (state.canonicalInventoryReady) readyRenders += 1; },
    bootstrapCustomers: () => customers.promise,
    loadCustomerPhotoMap() { photoReads += 1; return new Promise(() => {}); },
    webdesignActionController: { preloadPhotoImages: async () => {} },
    getSortedCustomers: (rows) => rows, getFilteredCustomers: () => state.klanten,
    databaseReadiness: { publish: () => { readinessCalls += 1; return ready.promise; } },
    releaseDatabaseBootShell() { releases += 1; }, databasePendingJobsPromise: Promise.resolve(),
    databaseImportController: {
      prepareAutoSync: async () => ({}),
      startAutoSync() { finished = true; return { ok: true, configured: false }; },
    },
  };
  assert.match(page, /window\.SoftoraDatabaseBoot\.run\(/);
  assert.match(page, /compactAvailableDuringBoot: options\.boot === true, deferRenderDuringBoot: options\.boot === true/);
  sandbox.loadMailReadySnapshot = (options) => snapshotClient.loadAndPublish({
    state, renderPage: sandbox.renderPage, normalizeCustomer: (row) => row,
    applyCustomerList: (rows) => { state.klanten = rows; },
    compactAvailableDuringBoot: options.boot, deferRenderDuringBoot: options.boot,
    fetchJsonWithTimeout: (url) => { assert.match(url, /\/archive\?compact=1$/); return snapshot.promise; },
  });
  const boot = bootClient.run(sandbox);
  snapshot.resolve({ ok: true, json: async () => ({ ok: true, compactAvailable: true, total: 0, customers: [],
    availableTotal: 1, availableCustomers: [{ id: 'available-1', availableSnapshot: true }],
    instantlyReadyTotal: 0, instantlyReadyCustomers: [], snapshotVersion: 'v1',
    foundTotal: 0, foundCustomerIds: [], generatedAt: '2026-09-08T19:00:00.000Z',
  }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.remoteCustomersLoaded, false);
  assert.equal(state.canonicalInventoryReady, true);
  assert.equal(readyRenders, 0);
  assert.equal(photoReads, 0);
  assert.equal(releases, 0);
  customers.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readinessCalls, 1);
  assert.ok(readyRenders > 0);
  assert.equal(releases, 0);
  ready.resolve(true);
  await boot;
  assert.ok(releases > 0);
  assert.equal(finished, true);
  assert.equal(photoReads, 0);
});

test('compact available rows inherit canonical details and reject missing canonical rows', () => {
  const canonical = { id: 'available-1', bedrijf: 'Bekende klant', email: 'info@example.nl', website: 'https://example.nl' };
  const available = { id: 'available-1', availableSnapshot: true, compactAvailable: true };
  const merged = snapshotClient.mergeWithCanonicalSnapshots([canonical], [], [available], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].bedrijf, canonical.bedrijf);
  assert.equal(merged[0].email, canonical.email);
  assert.equal(merged[0].availableSnapshot, true);
  assert.throws(() => snapshotClient.mergeWithCanonicalSnapshots([], [], [available], []), /officiële klantdatabase/);
});

test('one photo merge preserves canonical, stored and previous media precedence', () => {
  const customers = [
    { id: 'stored', websitePhoto: 'https://example.nl/canonical.jpg' },
    { id: 'previous', websitePhoto: '' },
    { id: 'hidden', websitePhoto: 'https://example.nl/hidden.jpg' },
  ];
  const previous = [
    { id: 'stored', websitePhoto: 'https://example.nl/old.jpg' },
    { id: 'previous', websitePhoto: 'https://example.nl/previous.jpg' },
  ];
  const stored = {
    stored: { websitePhoto: 'https://example.nl/stored.jpg', websiteMockup: 'https://example.nl/mockup.jpg' },
  };
  const helpers = {
    normalizeCustomer: (customer) => ({ ...customer }),
    sortCustomers: (rows) => rows,
    shouldShowWebsitePhoto: (customer) => customer.id !== 'hidden',
    buildCustomerIdentityKey: (customer) => customer.id,
  };
  const oldTwoPass = assetClient.mergeCustomersWithPhotos(customers, stored,
    assetClient.mergeCustomersWithPhotos(customers, {}, previous, helpers), helpers);
  const onePass = assetClient.mergeCustomersWithPhotos(customers, stored, previous, helpers);
  assert.deepEqual(onePass, oldTwoPass);
  assert.equal(onePass[0].websitePhoto, stored.stored.websitePhoto);
  assert.equal(onePass[1].websitePhoto, previous[1].websitePhoto);
  assert.equal(onePass[2].websitePhoto, '');
});

test('photo merge reuses normalized boot rows without changing media precedence', () => {
  const customers = [{ id: 'one', websitePhoto: '' }, { id: 'two', websitePhoto: 'https://example.nl/canonical.jpg' }];
  const fallback = [{ id: 'one', websitePhoto: 'https://example.nl/old.jpg' }];
  const photos = { one: { websitePhoto: 'https://example.nl/stored.jpg' } };
  const helpers = {
    normalizeCustomer: (customer) => ({ ...customer }),
    sortCustomers: (rows) => rows,
    buildCustomerIdentityKey: (customer) => customer.id,
  };
  const expected = assetClient.mergeCustomersWithPhotos(customers, photos, fallback, helpers);
  const actual = assetClient.mergeCustomersWithPhotos(customers, photos, fallback, {
    ...helpers,
    normalizedInputs: true,
    normalizeCustomer: () => { throw new Error('Already normalized customers must not be normalized again'); },
  });
  assert.deepEqual(actual, expected);
  assert.equal(actual[0].websitePhoto, photos.one.websitePhoto);
  assert.equal(actual[1].websitePhoto, customers[1].websitePhoto);
  assert.equal(customers[0].websitePhoto, '');
});

test('a valid design website is independent of email eligibility while mail readiness stays blocked', () => {
  const build = assetClient.buildWebdesignAssetState;
  const helpers = { isMailLeadEligible: () => false };
  for (const email of ['first@example.test; second@example.test', '', 'invalid']) {
    const customer = { id: 'design-1', website: 'https://example.test/contact', email };
    assert.equal(build(customer, helpers).canGeneratePhoto, true);
    assert.equal(build({ ...customer, hasPhoto: true, hasMockup: true }, helpers).isMailReady, false);
    assert.equal(build({ ...customer, hasPhoto: true }, helpers).canGeneratePhoto, false);
  }
  assert.equal(build({ id: 'no-website' }, helpers).canGeneratePhoto, false);
});

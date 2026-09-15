const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const distance = require('../../assets/premium-database-distance');
const { createPremiumDatabaseSnapshotCacheCodec } = require('../../server/services/premium-database-snapshot-cache');
const {
  createPremiumDatabaseMailReadySnapshotService,
  COLDMAIL_SEND_GUARD_KEY,
} = require('../../server/services/premium-database-mail-ready-snapshot');

const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const ids = rows => Array.from(rows, row => row.id || row.customer_id);
const near = Object.freeze({ id: 'near', bedrijf: 'Z dichtbij', plaats: 'Haaren', lat: 51.6027, lng: 5.2222, email: 'info@near.example.nl' });
const middle = Object.freeze({ id: 'middle', bedrijf: 'M midden', plaats: 'Tilburg', email: 'info@middle.example.nl' });
const far = Object.freeze({ id: 'far', bedrijf: 'A ver', plaats: 'Roosendaal', email: 'info@far.example.nl' });

function isolatedFunction(file, start, end, dependencies) {
  const source = read(file);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Actual function anchors present in ${file}`);
  return vm.runInNewContext(`(${source.slice(startIndex, endIndex).trim()})`, dependencies, { timeout: 1000 });
}

test('fixed Haaren origin ignores stale distances and keeps unknown locations last', () => {
  const unknown = Object.freeze({ id: 'unknown', bedrijf: 'A onbekend', distanceKm: 0 });
  const staleNear = Object.freeze({ ...near, distanceKm: 900, afstandKm: 900 });
  const staleFar = Object.freeze({ ...far, distanceKm: 0.01 });
  const original = Object.freeze([unknown, staleFar, middle, staleNear]);
  assert.equal(distance.getDistanceKm(staleNear), 0);
  assert.deepEqual(ids(distance.sortCustomersByDistance(original)), ['near', 'middle', 'far', 'unknown']);
  assert.deepEqual(ids(original), ['unknown', 'far', 'middle', 'near']);
  assert.equal(distance.getDistanceKm(unknown), Infinity);
});

test('location cache includes explicit coordinates and null coordinates never become zero', () => {
  const close = { plaats: 'Haaren', lat: 51.6027, lng: 5.2222 };
  const remote = { plaats: 'Haaren', lat: 53.2, lng: 6.5 };
  assert.equal(distance.getDistanceKm(close), 0);
  assert.ok(distance.getDistanceKm(remote) > 100);
  for (const value of [null, undefined, '', ' ', false]) {
    assert.equal(distance.getDistanceKm({ lat: value, lng: value }), Infinity);
  }
  assert.equal(distance.getDistanceKm({ lat: 91, lng: 181 }), Infinity);
  assert.ok(Number.isFinite(distance.getDistanceKm({ lat: 0, lng: 0 })));
  assert.equal(distance.getDistanceKm(null), Infinity);
});

test('nested database payload and narrowed UI/snapshot records retain identical locations', () => {
  const raw = { customer_id: 'nested', company: 'Payload', payload: { latitude: 51.6027, longitude: 5.2222, city: 'Haaren', province: 'Noord-Brabant', address: 'Testadres, Haaren' } };
  const narrowed = { id: raw.customer_id, ...distance.getCustomerLocationFields(raw) };
  assert.equal(distance.getDistanceKm(raw), 0);
  assert.equal(distance.getDistanceKm(narrowed), 0);
  assert.equal(narrowed.plaats, 'Haaren');
  assert.equal(narrowed.provincie, 'Noord-Brabant');
});

test('national place data works identically in browser and server, including screenshot addresses', () => {
  const browser = { atob };
  vm.runInNewContext(read('assets/premium-database-target-coords.js'), browser);
  vm.runInNewContext(read('assets/premium-database-distance.js'), browser);
  const examples = [
    { id: 'haar', adres: 'Teststraat, Haaren, Noord-Brabant' },
    { id: 'hel', adres: 'Achterstraat, Helvoirt, Noord-Brabant' },
    { id: 'oist', adres: 'Gasthuisstraat, Oisterwijk, Noord-Brabant' },
    { id: 'vro', adres: 'Zandbank, Vrouwenpolder, Zeeland' },
    { id: 'eem', plaats: 'Eemshaven', provincie: 'Groningen' },
  ];
  for (const row of examples) {
    const actual = distance.getDistanceKm(row);
    assert.ok(Number.isFinite(actual), row.adres || row.plaats);
    assert.equal(browser.SoftoraPremiumDatabaseDistance.getDistanceKm(row), actual);
  }
  const sorted = ids(distance.sortCustomersByDistance(examples));
  assert.equal(sorted[0], 'haar');
  assert.ok(sorted.indexOf('vro') > sorted.indexOf('oist'));
  assert.ok(sorted.indexOf('eem') > sorted.indexOf('hel'));
});

test('equal distances use deterministic company/id ties while retaining original row indices', () => {
  const a = { ...near, id: 'a', bedrijf: 'Zelfde' };
  const b = { ...near, id: 'b', bedrijf: 'Zelfde' };
  assert.deepEqual(ids(distance.sortCustomersByDistance([b, a])), ['a', 'b']);
  const entries = distance.sortCustomerEntriesByDistance([far, near, middle]);
  assert.deepEqual(entries.map(entry => [entry.row.id, entry.index]), [['near', 1], ['middle', 2], ['far', 0]]);
  assert.equal(entries[0].row, near);
});

test('every premium database filter sorts before visible-row pagination', () => {
  const state = { activeStatus: '' };
  const sorted = isolatedFunction('premium-database.html', '        function getSortedCustomers(customers) {', '        function isDatabaseMediaDebugEnabled()', { state, sortCustomers: distance.sortCustomersByDistance });
  for (const status of ['beschikbaar', 'benaderbaar', 'instantly-ready', 'benaderd', 'instantly', 'verstuurd', 'klant']) {
    state.activeStatus = status;
    assert.deepEqual(ids(sorted([far, middle, near])), ['near', 'middle', 'far'], status);
  }
  const source = read('premium-database.html');
  assert.match(source, /getSortedCustomers\(getFilteredCustomers\(\)\)/);
  assert.ok(source.indexOf('baseFiltered = getSortedCustomers(getFilteredCustomers())') < source.indexOf('getVisibleRows(visibleCustomers, state.visibleLimit'));
});

test('the independent sent-register renderer sorts by distance, not newest send time', () => {
  const browser = { SoftoraPremiumDatabaseDistance: distance };
  vm.runInNewContext(read('assets/premium-database-sent-register.js'), browser);
  const register = browser.SoftoraDatabaseSentRegister;
  register.accept({ source: 'central-outbound-recipient-guard', total: 2, recipients: [
    { key: 'far', customerId: far.id, email: far.email, sentAt: '2026-09-15T10:00:00Z' },
    { key: 'near', customerId: near.id, email: near.email, sentAt: '2026-09-01T10:00:00Z' },
  ] });
  assert.deepEqual(Array.from(register.rows([far, near], ''), row => row.key), ['near', 'far']);
  assert.equal(register.rows([far, near], 'far.example')[0].key, 'far');
});

test('durable and bootstrap snapshot codecs sort globally before truncation', () => {
  const codec = createPremiumDatabaseSnapshotCacheCodec({ maxLimit: 3000, formatVersion: 2 });
  const rows = [far, middle, near];
  const snapshot = { generatedAt: '2026-09-15T12:00:00.000Z', customers: rows, availableCustomers: rows, instantlyReadyCustomers: rows };
  const bootstrap = JSON.parse(codec.serializeMailReadySnapshotCache(snapshot, 1));
  for (const key of ['customers', 'availableCustomers', 'instantlyReadyCustomers']) assert.deepEqual(ids(bootstrap[key]), ['near']);
  const restored = codec.parseMailReadySnapshotCacheValue(JSON.stringify(snapshot));
  for (const key of ['customers', 'availableCustomers', 'instantlyReadyCustomers']) assert.deepEqual(ids(restored[key]), ['near', 'middle', 'far']);
  assert.deepEqual(ids(rows), ['far', 'middle', 'near']);
});

test('snapshot service orders fresh available inventory before page limits and keeps payload coordinates', async () => {
  const records = [far, middle, near].map(row => ({ customer_id: row.id, company: row.bedrijf, email: row.email, database_status: 'prospect', payload: distance.getCustomerLocationFields(row) }));
  const service = createPremiumDatabaseMailReadySnapshotService({
    dataOpsStore: {
      listCustomerSnapshotRows: async () => records,
      listDesignPhotoAssetFlags: async () => [],
      listOutboundRecipientGuardKeys: async () => [],
      listDesignPhotosWithSignedUrls: async () => [],
    },
    getUiStateValues: async () => ({ source: 'supabase', values: { [COLDMAIL_SEND_GUARD_KEY]: '{}' } }),
    setUiStateValues: async () => ({ source: 'supabase' }),
    logger: { warn() {} },
  });
  const first = await service.buildMailReadySnapshot({ limit: 1, offset: 0 });
  assert.deepEqual(ids(first.availableCustomers), ['near']);
  assert.equal(first.availableTotal, 3);
  assert.equal(first.availableCustomers[0].lat, near.lat);
  const second = await service.buildMailReadySnapshot({ limit: 1, offset: 1 });
  assert.deepEqual(ids(second.availableCustomers), ['middle']);
});

function selectionRows() {
  return [
    far,
    { ...near, id: 'disabled', mail: false },
    { ...near, id: 'guarded' },
    { ...near, id: 'eligible' },
    middle,
  ];
}

test('Softora real recipient selector orders before limits, preserves indices and duplicate guards', async () => {
  const rows = selectionRows();
  const resolve = isolatedFunction('server/services/coldmail-campaign.js', '  async function resolveColdmailRecipients(input = {}) {', '  async function getColdmailCampaignRecipients(input = {}) {', {
    compareCustomersByDistance: distance.compareCustomersByDistance,
    normalizeString: value => String(value || '').trim(),
    parsePositiveInt: (value, fallback) => Number(value) || fallback,
    getColdmailCampaignSendLimit: () => 81,
    isCampaignTestModeEnabled: () => false,
    parseBlockedEmailList: () => new Set(),
    customerDbScope: 'customers',
    leadDbScope: 'leads',
    getUiStateValues: async () => ({ values: {} }),
    parseDatabaseRows: () => rows,
    mailReadySnapshotService: { buildMailReadySnapshot: async () => ({ ok: true, customers: rows }) },
    loadColdmailSendGuardState: async () => ({ recipientEntries: [] }),
    getRowId: row => row.id,
    isEligibleColdmailRow: row => row.mail !== false,
    requiresReadyWebdesign: () => false,
    getColdmailOutboundDuplicateBlock: async item => item.id === 'guarded' ? { id: item.id, error: 'blocked' } : null,
    getRowEmail: row => row.email,
    isTestRecipientRow: () => false,
    shouldBlockPersonalMailboxDomains: () => false,
    isDeliverableEmailDomain: async () => true,
    hasExplicitRadiusKm: () => false,
  });
  const result = await resolve({ count: 1 });
  assert.deepEqual(Array.from(result.selectedRows, item => [item.id, item.index]), [['eligible', 3]]);
  assert.deepEqual(ids(rows), ['far', 'disabled', 'guarded', 'eligible', 'middle']);
  const all = await resolve({ count: 3 });
  assert.deepEqual(Array.from(all.selectedRows, item => item.id), ['eligible', 'middle', 'far']);
  assert.ok(all.failed.some(item => item.id === 'guarded'));
});

test('Instantly real eligible-row collector orders before limits and keeps original write indices', async () => {
  const rows = selectionRows();
  const collect = isolatedFunction('server/services/instantly-outreach.js', '  async function collectEligibleRows(rows, limit, context = {}) {', '  async function buildInstantlyLead(item, context = {}) {', {
    sortCustomerEntriesByDistance: distance.sortCustomerEntriesByDistance,
    normalizeString: value => String(value || '').trim(),
    getRowId: row => row.id,
    getRowEmail: row => row.email,
    getRowCompany: row => row.bedrijf,
    normalizeContactStatus: value => value || 'prospect',
    isInstantlyQueueSelectionMatch: () => true,
    isLikelyValidEmail: () => true,
    EXCLUDED_DATABASE_STATUSES: new Set(['geblokkeerd']),
    hasActiveInstantlyOutreach: () => false,
    hasColdmailSendGuardMatch: () => false,
    getSupabaseOutboundRecipientBlock: async item => item.id === 'guarded' ? { id: item.id, error: 'blocked' } : null,
    hasPriorColdmailOutreach: () => false,
    config: { blockPersonalMailboxDomains: false, requireWebdesignAssets: false },
    isDeliverableEmail: async () => true,
  });
  const result = await collect(rows, 1);
  assert.deepEqual(Array.from(result.selectedRows, item => [item.id, item.index]), [['eligible', 3]]);
  assert.deepEqual(ids(rows), ['far', 'disabled', 'guarded', 'eligible', 'middle']);
  const all = await collect(rows, 3);
  assert.deepEqual(Array.from(all.selectedRows, item => item.id), ['eligible', 'middle', 'far']);
  assert.ok(all.failed.some(item => item.id === 'guarded'));
});

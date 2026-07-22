const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COLDMAIL_SEND_GUARD_KEY,
  COLDMAIL_SEND_GUARD_SCOPE,
  MAIL_READY_BOOTSTRAP_CACHE_KEY,
  MAIL_READY_BOOTSTRAP_CACHE_SCOPE,
  MAIL_READY_SNAPSHOT_CACHE_KEY,
  MAIL_READY_SNAPSHOT_CACHE_SCOPE,
  createPremiumDatabaseMailReadySnapshotService,
} = require('../../server/services/premium-database-mail-ready-snapshot');

function createService(overrides = {}) {
  const calls = [];
  const dataOpsStore = {
    async listCustomerSnapshotRows(options) {
      calls.push('customers-snapshot');
      calls.push(['customers-snapshot-options', options]);
      if (overrides.customerRowsPromise) return overrides.customerRowsPromise;
      return overrides.customers || [];
    },
    async listDesignPhotoAssetFlags(options) {
      calls.push('photo-flags');
      calls.push(['photo-flags-options', options]);
      return Object.prototype.hasOwnProperty.call(overrides, 'photoFlags') ? overrides.photoFlags : [];
    },
    async listOutboundRecipientGuardKeys(keys) {
      calls.push(['guard-keys', keys.slice()]);
      return Object.prototype.hasOwnProperty.call(overrides, 'centralGuardKeys') ? overrides.centralGuardKeys : [];
    },
    async listDesignPhotosWithSignedUrls(options) {
      calls.push(['signed-photos', options]);
      return overrides.signedPhotos || [];
    },
  };
  const getUiStateValues = async (scope) => {
    if (scope === MAIL_READY_SNAPSHOT_CACHE_SCOPE) {
      calls.push(['durable-snapshot-read', scope]);
      const durableSnapshot = typeof overrides.getDurableSnapshot === 'function'
        ? overrides.getDurableSnapshot()
        : overrides.durableSnapshot;
      return {
        source: 'supabase',
        values: durableSnapshot
          ? { [MAIL_READY_SNAPSHOT_CACHE_KEY]: JSON.stringify(durableSnapshot) }
          : {},
      };
    }
    calls.push(['legacy-guard', scope]);
    if (scope === COLDMAIL_SEND_GUARD_SCOPE && overrides.legacyGuardError) throw overrides.legacyGuardError;
    return {
      source: 'supabase',
      values: {
        [COLDMAIL_SEND_GUARD_KEY]: JSON.stringify(overrides.legacyGuard || {}),
      },
    };
  };
  const setUiStateValues = async (scope, values, options) => {
    calls.push(['ui-state-write', scope, values, options]);
    return { source: 'supabase', values };
  };
  return {
    calls,
    service: createPremiumDatabaseMailReadySnapshotService({
      dataOpsStore,
      getUiStateValues,
      setUiStateValues,
      now: () => new Date('2026-06-16T12:00:00.000Z'),
      nowMs: overrides.nowMs,
      logger: { warn() {} },
    }),
  };
}

test('premium database mail-ready snapshot filters safely and returns a compact shape', async () => {
  const customers = [
    {
      customer_id: 'ready-1',
      company: 'Ready One',
      contact_name: 'Ruben',
      email: 'ruben@ready-one.nl',
      phone: '0612345678',
      website: 'ready-one.nl',
      database_status: 'prospect',
      updated_at: '2026-06-15T10:00:00.000Z',
    },
    { customer_id: 'mailed-1', company: 'Mailed', email: 'info@mailed.nl', website: 'mailed.nl', database_status: 'gemaild' },
    { customer_id: 'bad-email', company: 'Bad Mail', email: 'geen-mail', website: 'bad.nl', database_status: 'prospect' },
    { customer_id: 'no-mockup', company: 'No Mockup', email: 'info@nomockup.nl', website: 'nomockup.nl', database_status: 'prospect' },
    { customer_id: 'central-guard', company: 'Central Guard', email: 'info@centralguard.nl', website: 'centralguard.nl', database_status: 'prospect' },
    { customer_id: 'legacy-guard', company: 'Legacy Guard', email: 'info@legacyguard.nl', website: 'legacyguard.nl', database_status: 'prospect' },
    { customer_id: 'instantly-1', company: 'Instantly Lead', email: 'info@instant.nl', website: 'instant.nl', database_status: 'prospect', payload: { lastColdmailProvider: 'instantly' } },
    { customer_id: 'used-coldmail', company: 'Used Coldmail', email: 'info@used.nl', website: 'used.nl', database_status: 'prospect', payload: { lastColdmailSentAt: '2026-06-15T09:00:00.000Z' } },
    { customer_id: 'used-coldcall', company: 'Used Coldcall', email: 'info@called.nl', website: 'called.nl', database_status: 'prospect', payload: { lastColdCallAt: '2026-06-15T09:00:00.000Z' } },
  ];
  const photoFlags = customers.map((customer) => ({
    customerId: customer.customer_id,
    identityKey: customer.identity_key,
    hasPhoto: true,
    hasMockup: !['no-mockup', 'used-coldcall'].includes(customer.customer_id),
  }));
  const { service, calls } = createService({
    customers,
    photoFlags,
    centralGuardKeys: ['email:info@centralguard.nl'],
    legacyGuard: {
      recipientEntries: [{ recipientEmail: 'info@legacyguard.nl' }],
    },
  });

  const payload = await service.buildMailReadySnapshot({ limit: 10 });

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'structured-mail-ready-snapshot');
  assert.equal(payload.generatedAt, '2026-06-16T12:00:00.000Z');
  assert.equal(payload.total, 1);
  assert.equal(payload.availableTotal, 1);
  assert.equal(payload.customers.length, 1);
  assert.deepEqual(payload.availableCustomers.map((customer) => customer.id), ['no-mockup']);
  assert.deepEqual(payload.customers[0], {
    id: 'ready-1',
    bedrijf: 'Ready One',
    naam: 'Ruben',
    email: 'ruben@ready-one.nl',
    telefoon: '0612345678',
    tel: '0612345678',
    website: 'ready-one.nl',
    dom: 'ready-one.nl',
    adres: '',
    stad: '',
    status: 'prospect',
    databaseStatus: 'prospect',
    verantwoordelijk: '',
    updatedAt: '2026-06-15T10:00:00.000Z',
    hasPhoto: true,
    hasMockup: true,
    websitePhotoAssetReady: true,
    websiteMockupAssetReady: true,
    mailReady: true,
    mailReadySnapshot: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.customers[0], 'payload'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.customers[0], 'websitePhoto'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.customers[0], 'websiteMockup'), false);
  assert.equal(calls.includes('customers-snapshot'), true);
  assert.equal(calls.includes('photo-flags'), true);
  assert.equal(calls.find((call) => Array.isArray(call) && call[0] === 'customers-snapshot-options')[1].bypassReadCache, true);
  assert.equal(calls.find((call) => Array.isArray(call) && call[0] === 'photo-flags-options')[1].bypassReadCache, true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'guard-keys'), true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'legacy-guard'), true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'ui-state-write' && call[1] === MAIL_READY_SNAPSHOT_CACHE_SCOPE), true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'ui-state-write' && call[1] === MAIL_READY_BOOTSTRAP_CACHE_SCOPE), true);
});

test('premium database mail-ready snapshot honors limit and offset', async () => {
  const customers = Array.from({ length: 5 }, (_, index) => ({
    customer_id: `ready-${index + 1}`,
    company: `Ready ${index + 1}`,
    email: `info${index + 1}@ready.nl`,
    website: `ready-${index + 1}.nl`,
    database_status: 'prospect',
  }));
  const { service } = createService({
    customers,
    photoFlags: customers.map((customer) => ({
      customerId: customer.customer_id,
      hasPhoto: true,
      hasMockup: true,
    })),
  });

  const payload = await service.buildMailReadySnapshot({ limit: 2, offset: 2 });

  assert.equal(payload.total, 5);
  assert.equal(payload.limit, 2);
  assert.equal(payload.offset, 2);
  assert.deepEqual(payload.customers.map((customer) => customer.id), ['ready-3', 'ready-4']);
});

test('premium database snapshot deduplicates customer ids and embeds bootstrap photo URLs', async () => {
  const duplicate = {
    customer_id: 'ready-1',
    company: 'Ready One',
    email: 'info@ready-one.nl',
    website: 'ready-one.nl',
    database_status: 'prospect',
    updated_at: '2026-07-10T12:00:00.000Z',
  };
  const { service, calls } = createService({
    customers: [duplicate, { ...duplicate }],
    photoFlags: [{ customerId: 'ready-1', hasPhoto: true, hasMockup: true }],
    signedPhotos: [{
      customerId: 'ready-1',
      websitePhotoUrl: 'https://storage.example.test/ready-1-photo.png',
      websiteMockupUrl: 'https://storage.example.test/ready-1-mockup.jpg',
      fileName: 'ready-1-photo.png',
      websiteMockupName: 'ready-1-mockup.jpg',
      signedUrlExpiresAt: '2026-07-11T12:00:00.000Z',
    }],
  });

  const payload = await service.buildMailReadySnapshot({ limit: 10 });

  assert.equal(payload.total, 1);
  assert.equal(payload.customers[0].websitePhoto, 'https://storage.example.test/ready-1-photo.png');
  assert.equal(payload.customers[0].websiteMockup, 'https://storage.example.test/ready-1-mockup.jpg');
  const signedCall = calls.find((call) => Array.isArray(call) && call[0] === 'signed-photos');
  assert.deepEqual(signedCall[1].customerIds, ['ready-1']);
  assert.equal(signedCall[1].maxMatches, 1);
});

test('premium database mail-ready snapshot reuses one full calculation across pages', async () => {
  const customers = Array.from({ length: 3 }, (_, index) => ({
    customer_id: `ready-${index + 1}`,
    company: `Ready ${index + 1}`,
    email: `info${index + 1}@ready.nl`,
    website: `ready-${index + 1}.nl`,
    database_status: 'prospect',
  }));
  const { service, calls } = createService({
    customers,
    photoFlags: customers.map((customer) => ({ customerId: customer.customer_id, hasPhoto: true, hasMockup: true })),
  });

  const first = await service.buildMailReadySnapshot({ limit: 2, offset: 0 });
  const second = await service.buildMailReadySnapshot({ limit: 2, offset: 2 });

  assert.deepEqual(first.customers.map((customer) => customer.id), ['ready-1', 'ready-2']);
  assert.deepEqual(second.customers.map((customer) => customer.id), ['ready-3']);
  assert.equal(calls.filter((call) => call === 'customers-snapshot').length, 1);
  assert.equal(calls.filter((call) => call === 'photo-flags').length, 1);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'guard-keys').length, 1);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'legacy-guard').length, 1);
});

test('premium database mail-ready snapshot reuses a fresh durable snapshot without heavy reads', async () => {
  const durableSnapshot = {
    version: 1,
    generatedAt: '2026-06-16T12:00:00.000Z',
    total: 1,
    customers: [{ id: 'ready-cached', mailReady: true, mailReadySnapshot: true }],
    availableTotal: 1,
    availableCustomers: [{ id: 'available-cached', availableSnapshot: true }],
  };
  const { service, calls } = createService({
    durableSnapshot,
    nowMs: () => Date.parse('2026-06-16T12:00:30.000Z'),
  });

  const payload = await service.buildMailReadySnapshot({ limit: 3000 });

  assert.deepEqual(payload.customers.map((customer) => customer.id), ['ready-cached']);
  assert.deepEqual(payload.availableCustomers.map((customer) => customer.id), ['available-cached']);
  assert.equal(calls.includes('customers-snapshot'), false);
  assert.equal(calls.includes('photo-flags'), false);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'guard-keys'), false);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'legacy-guard'), false);
});

test('invalidating the snapshot bypasses durable stale rows after a lead delete', async () => {
  const { service, calls } = createService({
    customers: [{ customer_id: 'live-1', company: 'Live BV', email: 'info@live.nl', website: 'live.nl', database_status: 'prospect' }],
    photoFlags: [{ customerId: 'live-1', hasPhoto: true, hasMockup: true }],
    durableSnapshot: {
      generatedAt: '2026-06-16T12:00:00.000Z',
      total: 1,
      customers: [{ id: 'deleted-1', bedrijf: 'Deleted BV', email: 'info@deleted.nl', mailReady: true, mailReadySnapshot: true }],
      availableCustomers: [],
    },
    nowMs: () => Date.parse('2026-06-16T12:00:00.000Z'),
  });

  const cached = await service.buildMailReadySnapshot({ limit: 10 });
  assert.equal(cached.customers[0].id, 'deleted-1');

  service.invalidate();
  const refreshed = await service.buildMailReadySnapshot({ limit: 10 });

  assert.equal(refreshed.customers[0].id, 'live-1');
  assert.equal(calls.filter((call) => call === 'customers-snapshot').length, 1);
});

test('premium database snapshot upgrades a legacy bootstrap cache with signed photo urls in the background', async () => {
  const durableSnapshot = {
    version: 1,
    generatedAt: '2026-06-16T12:00:00.000Z',
    total: 1,
    customers: [{
      id: 'ready-cached',
      hasPhoto: true,
      hasMockup: true,
      websitePhotoAssetReady: true,
      websiteMockupAssetReady: true,
      mailReady: true,
      mailReadySnapshot: true,
    }],
    availableTotal: 0,
    availableCustomers: [],
  };
  const { service, calls } = createService({
    durableSnapshot,
    nowMs: () => Date.parse('2026-06-16T12:00:30.000Z'),
    signedPhotos: [{
      customerId: 'ready-cached',
      websitePhotoUrl: 'https://storage.example.test/ready-cached-photo.png',
      websiteMockupUrl: 'https://storage.example.test/ready-cached-mockup.jpg',
    }],
  });

  const stale = await service.buildMailReadySnapshot({ limit: 10 });
  assert.equal(stale.customers[0].websitePhoto, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  const upgraded = await service.buildMailReadySnapshot({ limit: 10 });

  assert.equal(upgraded.customers[0].websitePhoto, 'https://storage.example.test/ready-cached-photo.png');
  assert.equal(upgraded.customers[0].websiteMockup, 'https://storage.example.test/ready-cached-mockup.jpg');
  const signedCall = calls.find((call) => Array.isArray(call) && call[0] === 'signed-photos');
  assert.deepEqual(signedCall[1].customerIds, ['ready-cached']);
  assert.equal(signedCall[1].bypassReadFailureCooldown, true);
  const bootstrapWrite = calls.find((call) => Array.isArray(call) && call[0] === 'ui-state-write' && call[1] === MAIL_READY_BOOTSTRAP_CACHE_SCOPE);
  assert.equal(JSON.parse(bootstrapWrite[2][MAIL_READY_BOOTSTRAP_CACHE_KEY]).version, 2);
});

test('premium database mail-ready snapshot refreshes an expired durable snapshot before responding', async () => {
  const durableSnapshot = {
    version: 1,
    generatedAt: '2026-06-16T10:00:00.000Z',
    total: 1,
    customers: [{ id: 'ready-cached', mailReady: true, mailReadySnapshot: true }],
    availableTotal: 1,
    availableCustomers: [{ id: 'available-cached', availableSnapshot: true }],
  };
  const { service, calls } = createService({
    durableSnapshot,
    nowMs: () => Date.parse('2026-06-16T12:00:00.000Z'),
    customers: [{ customer_id: 'ready-live', company: 'Live BV', email: 'info@live.nl', website: 'live.nl', database_status: 'prospect' }],
    photoFlags: [{ customerId: 'ready-live', hasPhoto: true, hasMockup: true }],
  });

  const payload = await service.buildMailReadySnapshot({ limit: 3000 });

  assert.deepEqual(payload.customers.map((customer) => customer.id), ['ready-live']);
  assert.deepEqual(payload.availableCustomers, []);
  assert.equal(calls.includes('customers-snapshot'), true);
});

test('premium database mail-ready snapshot keeps the last durable rows when a background refresh regresses to empty', async () => {
  const durableSnapshot = {
    version: 2,
    generatedAt: '2026-06-16T10:00:00.000Z',
    total: 1,
    customers: [{ id: 'ready-cached', mailReady: true, mailReadySnapshot: true }],
    availableTotal: 1,
    availableCustomers: [{ id: 'available-cached', availableSnapshot: true }],
  };
  const { service, calls } = createService({
    durableSnapshot,
    nowMs: () => Date.parse('2026-06-16T12:00:00.000Z'),
    customers: [],
    photoFlags: [],
  });

  const payload = await service.buildMailReadySnapshot({ limit: 3000 });

  assert.deepEqual(payload.customers.map((customer) => customer.id), ['ready-cached']);
  assert.deepEqual(payload.availableCustomers.map((customer) => customer.id), ['available-cached']);
  assert.equal(calls.includes('customers-snapshot'), true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'ui-state-write'), false);
});

test('an older in-flight refresh cannot overwrite a newer durable snapshot generation', async () => {
  const durableSnapshots = [
    {
      version: 2,
      generatedAt: '2026-06-16T10:00:00.000Z',
      total: 1,
      customers: [{ id: 'expired-ready', mailReady: true, mailReadySnapshot: true }],
      availableCustomers: [],
    },
    {
      version: 2,
      generatedAt: '2026-06-16T12:01:00.000Z',
      total: 1,
      customers: [{ id: 'newer-ready', mailReady: true, mailReadySnapshot: true }],
      availableCustomers: [],
    },
  ];
  const { service, calls } = createService({
    getDurableSnapshot: () => durableSnapshots.shift() || durableSnapshots[durableSnapshots.length - 1] || null,
    nowMs: () => Date.parse('2026-06-16T12:00:00.000Z'),
    customers: [{ customer_id: 'older-refresh', company: 'Older BV', email: 'info@older.nl', website: 'older.nl', database_status: 'prospect' }],
    photoFlags: [{ customerId: 'older-refresh', hasPhoto: true, hasMockup: true }],
  });

  const payload = await service.buildMailReadySnapshot({ limit: 10 });

  assert.deepEqual(payload.customers.map((customer) => customer.id), ['newer-ready']);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'ui-state-write'), false);
});

test('premium database mail-ready snapshot prunes deleted customers from both durable caches', async () => {
  const { service, calls } = createService({
    durableSnapshot: {
      version: 2,
      generatedAt: '2026-06-16T11:59:30.000Z',
      total: 2,
      customers: [
        { id: 'deleted-ready', mailReady: true, mailReadySnapshot: true },
        { id: 'kept-ready', mailReady: true, mailReadySnapshot: true },
      ],
      availableTotal: 1,
      availableCustomers: [{ id: 'deleted-available', availableSnapshot: true }],
    },
    nowMs: () => Date.parse('2026-06-16T12:00:00.000Z'),
  });

  assert.equal(await service.removeCustomers(['deleted-ready', 'deleted-available']), true);
  const payload = await service.buildMailReadySnapshot({ limit: 10 });

  assert.deepEqual(payload.customers.map((customer) => customer.id), ['kept-ready']);
  assert.deepEqual(payload.availableCustomers, []);
  const cacheWrites = calls.filter((call) => Array.isArray(call) && call[0] === 'ui-state-write');
  const fullSnapshot = JSON.parse(cacheWrites.find((call) => call[1] === MAIL_READY_SNAPSHOT_CACHE_SCOPE)[2][MAIL_READY_SNAPSHOT_CACHE_KEY]);
  const bootstrapSnapshot = JSON.parse(cacheWrites.find((call) => call[1] === MAIL_READY_BOOTSTRAP_CACHE_SCOPE)[2][MAIL_READY_BOOTSTRAP_CACHE_KEY]);
  assert.deepEqual(fullSnapshot.customers.map((customer) => customer.id), ['kept-ready']);
  assert.deepEqual(fullSnapshot.availableCustomers, []);
  assert.deepEqual(bootstrapSnapshot.customers.map((customer) => customer.id), ['kept-ready']);
  assert.deepEqual(bootstrapSnapshot.availableCustomers, []);
});

test('premium database mail-ready snapshot moves removed webdesign assets to available in both durable caches', async () => {
  const { service, calls } = createService({
    durableSnapshot: {
      version: 2,
      generatedAt: '2026-06-16T11:59:30.000Z',
      total: 1,
      customers: [{
        id: 'removed-assets',
        bedrijf: 'Demo BV',
        websitePhoto: 'https://assets.softora.test/demo.png',
        websiteMockup: 'https://assets.softora.test/demo-mockup.png',
        hasPhoto: true,
        hasMockup: true,
        websitePhotoAssetReady: true,
        websiteMockupAssetReady: true,
        mailReady: true,
        mailReadySnapshot: true,
      }],
      availableTotal: 0,
      availableCustomers: [],
    },
    nowMs: () => Date.parse('2026-06-16T12:00:00.000Z'),
  });

  assert.equal(await service.markCustomersAvailableAfterAssetRemoval(['removed-assets']), true);
  const payload = await service.buildMailReadySnapshot({ limit: 10 });

  assert.deepEqual(payload.customers, []);
  assert.deepEqual(payload.availableCustomers.map((customer) => customer.id), ['removed-assets']);
  assert.equal(payload.availableCustomers[0].websitePhoto, '');
  assert.equal(payload.availableCustomers[0].websiteMockup, '');
  assert.equal(payload.availableCustomers[0].websitePhotoAssetReady, false);
  assert.equal(payload.availableCustomers[0].websiteMockupAssetReady, false);
  assert.equal(payload.availableCustomers[0].mailReady, false);
  assert.equal(payload.availableCustomers[0].availableSnapshot, true);
  const cacheWrites = calls.filter((call) => Array.isArray(call) && call[0] === 'ui-state-write');
  const fullSnapshot = JSON.parse(cacheWrites.find((call) => call[1] === MAIL_READY_SNAPSHOT_CACHE_SCOPE)[2][MAIL_READY_SNAPSHOT_CACHE_KEY]);
  const bootstrapSnapshot = JSON.parse(cacheWrites.find((call) => call[1] === MAIL_READY_BOOTSTRAP_CACHE_SCOPE)[2][MAIL_READY_BOOTSTRAP_CACHE_KEY]);
  assert.deepEqual(fullSnapshot.customers, []);
  assert.deepEqual(fullSnapshot.availableCustomers.map((customer) => customer.id), ['removed-assets']);
  assert.deepEqual(bootstrapSnapshot.customers, []);
  assert.deepEqual(bootstrapSnapshot.availableCustomers.map((customer) => customer.id), ['removed-assets']);
});

test('premium database mail-ready snapshot persists compact full and bootstrap caches', async () => {
  const customers = Array.from({ length: 120 }, (_, index) => ({
    customer_id: `ready-${index + 1}`,
    company: `Ready ${index + 1}`,
    email: `info${index + 1}@ready.nl`,
    website: `ready-${index + 1}.nl`,
    database_status: 'prospect',
  }));
  const { service, calls } = createService({
    customers,
    photoFlags: customers.map((customer) => ({ customerId: customer.customer_id, hasPhoto: true, hasMockup: true })),
  });

  await service.buildMailReadySnapshot({ limit: 3000 });

  const fullWrite = calls.find((call) => Array.isArray(call) && call[0] === 'ui-state-write' && call[1] === MAIL_READY_SNAPSHOT_CACHE_SCOPE);
  const bootstrapWrite = calls.find((call) => Array.isArray(call) && call[0] === 'ui-state-write' && call[1] === MAIL_READY_BOOTSTRAP_CACHE_SCOPE);
  assert.ok(fullWrite);
  assert.ok(bootstrapWrite);
  assert.equal(JSON.parse(fullWrite[2][MAIL_READY_SNAPSHOT_CACHE_KEY]).customers.length, 120);
  assert.equal(JSON.parse(bootstrapWrite[2][MAIL_READY_BOOTSTRAP_CACHE_KEY]).customers.length, 100);
  assert.equal(JSON.parse(bootstrapWrite[2][MAIL_READY_BOOTSTRAP_CACHE_KEY]).total, 120);
});

test('premium database mail-ready snapshot waits for the central refresh after its memory cache expires', async () => {
  let clockMs = 1000;
  const customers = [{ customer_id: 'ready-1', company: 'Ready One', email: 'info@ready.nl', website: 'ready.nl', database_status: 'prospect' }];
  const { service, calls } = createService({
    customers,
    photoFlags: [{ customerId: 'ready-1', hasPhoto: true, hasMockup: true }],
    nowMs: () => clockMs,
  });

  await service.buildMailReadySnapshot({ limit: 10 });
  clockMs += 61 * 1000;
  const refreshed = await service.buildMailReadySnapshot({ limit: 10 });

  assert.equal(refreshed.total, 1);
  assert.equal(calls.filter((call) => call === 'customers-snapshot').length, 2);
});

test('premium database mail-ready snapshot response cannot be replayed from a browser cache', async () => {
  const customers = [{ customer_id: 'ready-1', company: 'Ready One', email: 'info@ready.nl', website: 'ready.nl', database_status: 'prospect' }];
  const { service } = createService({
    customers,
    photoFlags: [{ customerId: 'ready-1', hasPhoto: true, hasMockup: true }],
  });
  const headers = {};
  const res = {
    setHeader: (name, value) => { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };

  await service.sendMailReadySnapshotResponse({ query: { limit: '10', offset: '0' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(headers.Pragma, 'no-cache');
  assert.equal(headers.Expires, '0');
  assert.equal(res.payload.total, 1);
});

test('premium database mail-ready snapshot fails closed when legacy send guard cannot be read', async () => {
  const customers = [{
    customer_id: 'ready-1',
    company: 'Ready One',
    email: 'info@ready-one.nl',
    website: 'ready-one.nl',
    database_status: 'prospect',
  }];
  const { service } = createService({
    customers,
    photoFlags: [{ customerId: 'ready-1', hasPhoto: true, hasMockup: true }],
    legacyGuardError: new Error('legacy guard unavailable'),
  });

  await assert.rejects(
    () => service.buildMailReadySnapshot({ limit: 10 }),
    /Mailklare snapshot kon verzendbeveiliging niet laden/
  );
});

test('premium database mail-ready snapshot refuses fake empty totals when photo flags cannot be read', async () => {
  const customers = [{
    customer_id: 'ready-1',
    company: 'Ready One',
    email: 'info@ready-one.nl',
    website: 'ready-one.nl',
    database_status: 'prospect',
  }];
  const { service } = createService({
    customers,
    photoFlags: null,
  });

  await assert.rejects(
    () => service.buildMailReadySnapshot({ limit: 10 }),
    /Mailklare snapshot kon foto- en mockupdata niet laden/
  );
});

test('premium database mail-ready snapshot refuses fake empty totals when central guards cannot be read', async () => {
  const customers = [{
    customer_id: 'ready-1',
    company: 'Ready One',
    email: 'info@ready-one.nl',
    website: 'ready-one.nl',
    database_status: 'prospect',
  }];
  const { service } = createService({
    customers,
    photoFlags: [{ customerId: 'ready-1', hasPhoto: true, hasMockup: true }],
    centralGuardKeys: null,
  });

  await assert.rejects(
    () => service.buildMailReadySnapshot({ limit: 10 }),
    /Mailklare snapshot kon verzendbeveiliging niet laden/
  );
});

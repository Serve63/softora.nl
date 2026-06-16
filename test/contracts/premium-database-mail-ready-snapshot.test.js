const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COLDMAIL_SEND_GUARD_KEY,
  createPremiumDatabaseMailReadySnapshotService,
} = require('../../server/services/premium-database-mail-ready-snapshot');

function createService(overrides = {}) {
  const calls = [];
  const dataOpsStore = {
    async listCustomerSnapshotRows() {
      calls.push('customers-snapshot');
      return overrides.customers || [];
    },
    async listDesignPhotoAssetFlags() {
      calls.push('photo-flags');
      return overrides.photoFlags || [];
    },
    async listOutboundRecipientGuardKeys(keys) {
      calls.push(['guard-keys', keys.slice()]);
      return overrides.centralGuardKeys || [];
    },
    async listDesignPhotosWithSignedUrls() {
      throw new Error('signed URLs mogen niet in de snapshotroute worden gemaakt');
    },
  };
  const getUiStateValues = async (scope) => {
    calls.push(['legacy-guard', scope]);
    if (overrides.legacyGuardError) throw overrides.legacyGuardError;
    return {
      source: 'supabase',
      values: {
        [COLDMAIL_SEND_GUARD_KEY]: JSON.stringify(overrides.legacyGuard || {}),
      },
    };
  };
  return {
    calls,
    service: createPremiumDatabaseMailReadySnapshotService({
      dataOpsStore,
      getUiStateValues,
      now: () => new Date('2026-06-16T12:00:00.000Z'),
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
  ];
  const photoFlags = customers.map((customer) => ({
    customerId: customer.customer_id,
    identityKey: customer.identity_key,
    hasPhoto: true,
    hasMockup: customer.customer_id !== 'no-mockup',
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
  assert.equal(payload.customers.length, 1);
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
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'guard-keys'), true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'legacy-guard'), true);
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

  const payload = await service.buildMailReadySnapshot({ limit: 10 });

  assert.equal(payload.ok, true);
  assert.equal(payload.total, 0);
  assert.deepEqual(payload.customers, []);
});

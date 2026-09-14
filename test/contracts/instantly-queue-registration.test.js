const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInstantlyQueueRegistrationService,
  hasPriorNonInstantlyOutbound,
  normalizeRegistrationRow,
} = require('../../server/services/instantly-queue-registration');
const { hasPendingInstantlyQueue } = require('../../server/services/instantly-queue-status');

const DIGEST = 'a'.repeat(64);

function buildLead(overrides = {}) {
  return {
    sheetRow: 2,
    bedrijf: 'Voorbeeldbedrijf B.V.',
    adres: 'Dorpsstraat 12, 1234 AB Tilburg',
    website: 'https://voorbeeldbedrijf.nl/contact',
    email: 'info@voorbeeldbedrijf.nl',
    telefoon: '013-1234567',
    ...overrides,
  };
}

function buildInput(rows) {
  return {
    rows,
    sourceId: 'database-vondsten-20260914',
    fileDigest: DIGEST,
    totalRows: rows.length,
    batchIndex: 0,
    batchCount: 1,
  };
}

test('Instantly queue status is separate from actual Instantly outreach', () => {
  assert.equal(hasPendingInstantlyQueue({ instantlyQueueStatus: 'registered' }), true);
  assert.equal(hasPendingInstantlyQueue({ payload: { instantlyQueueStatus: 'registered' } }), true);
  assert.equal(hasPendingInstantlyQueue({ instantlyStatus: 'queued' }), false);
});

test('Instantly queue normalizes all five verified sheet fields', () => {
  assert.deepEqual(normalizeRegistrationRow(buildLead({ website: 'voorbeeldbedrijf.nl' })), {
    sheetRow: 2,
    bedrijf: 'Voorbeeldbedrijf B.V.',
    adres: 'Dorpsstraat 12, 1234 AB Tilburg',
    website: 'https://voorbeeldbedrijf.nl/',
    email: 'info@voorbeeldbedrijf.nl',
    telefoon: '013-1234567',
  });
  assert.throws(
    () => normalizeRegistrationRow(buildLead({ telefoon: '' })),
    (error) => error.code === 'INSTANTLY_QUEUE_ROW_INVALID' && error.sheetRow === 2
  );
});

test('Instantly queue inserts new rows, updates exact email matches and leaves transferred leads untouched', async () => {
  const writes = [];
  const identityWrites = [];
  const existing = [
    {
      id: 'existing-customer',
      bedrijf: 'Oude naam',
      email: 'contact@bestaand.nl',
      status: 'prospect',
      databaseStatus: 'prospect',
      customField: 'blijft staan',
    },
    {
      id: 'already-instantly',
      bedrijf: 'Al overgezet',
      email: 'info@alovergezet.nl',
      status: 'gemaild',
      lastColdmailProvider: 'instantly',
      instantlyLeadId: 'lead-1',
    },
  ];
  const service = createInstantlyQueueRegistrationService({
    now: () => new Date('2026-09-14T16:00:00.000Z'),
    dataOpsStore: {
      async listUniqueCustomersByEmails() { return existing; },
      async upsertCustomers(rows, meta) { writes.push({ rows, meta }); return { ok: true }; },
      async upsertCustomerIdentityKeys(rows, meta) { identityWrites.push({ rows, meta }); return { ok: true }; },
    },
  });
  const result = await service.registerBatch(buildInput([
    buildLead(),
    buildLead({ sheetRow: 3, bedrijf: 'Bestaand Nieuw', email: 'contact@bestaand.nl' }),
    buildLead({ sheetRow: 4, bedrijf: 'Al overgezet', email: 'info@alovergezet.nl' }),
  ]));

  assert.equal(result.processed, 3);
  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.alreadyTransferred, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].rows.length, 2);
  const inserted = writes[0].rows.find((row) => row.email === 'info@voorbeeldbedrijf.nl');
  const updated = writes[0].rows.find((row) => row.email === 'contact@bestaand.nl');
  assert.match(inserted.id, /^instantly_queue_[a-f0-9]{24}$/);
  assert.equal(inserted.instantlyQueueStatus, 'registered');
  assert.equal(inserted.status, 'prospect');
  assert.equal(inserted.lastColdmailProvider, undefined);
  assert.equal(updated.id, 'existing-customer');
  assert.equal(updated.bedrijf, 'Bestaand Nieuw');
  assert.equal(updated.customField, 'blijft staan');
  assert.equal(updated.instantlyQueueRegisteredAt, '2026-09-14T16:00:00.000Z');
  assert.equal(identityWrites[0].rows.length, 2);
});

test('Instantly queue is idempotent because a new email always receives the same customer id', async () => {
  const ids = [];
  const service = createInstantlyQueueRegistrationService({
    dataOpsStore: {
      async listUniqueCustomersByEmails() { return []; },
      async upsertCustomers(rows) { ids.push(rows[0].id); return { ok: true }; },
    },
  });
  await service.registerBatch(buildInput([buildLead()]));
  await service.registerBatch(buildInput([buildLead()]));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('Instantly queue fails closed on prior non-Instantly outreach', async () => {
  assert.equal(hasPriorNonInstantlyOutbound({ status: 'gemaild' }), true);
  assert.equal(hasPriorNonInstantlyOutbound({ lastColdmailProvider: 'softora' }), true);
  assert.equal(hasPriorNonInstantlyOutbound({ lastColdmailProvider: 'instantly', instantlyLeadId: 'lead-1' }), false);
  const service = createInstantlyQueueRegistrationService({
    dataOpsStore: {
      async listUniqueCustomersByEmails() {
        return [{ id: 'sent', email: 'info@voorbeeldbedrijf.nl', status: 'gemaild', lastColdmailProvider: 'softora' }];
      },
      async upsertCustomers() { throw new Error('mag niet schrijven'); },
    },
  });
  await assert.rejects(
    service.registerBatch(buildInput([buildLead()])),
    (error) => error.code === 'INSTANTLY_QUEUE_OUTREACH_CONFLICT' && error.conflictCount === 1
  );
});

test('Instantly queue fails closed when exact email uniqueness cannot be proven', async () => {
  const service = createInstantlyQueueRegistrationService({
    dataOpsStore: {
      async listUniqueCustomersByEmails() { return null; },
      async upsertCustomers() { throw new Error('mag niet schrijven'); },
    },
  });
  await assert.rejects(
    service.registerBatch(buildInput([buildLead()])),
    (error) => error.code === 'INSTANTLY_QUEUE_EXACT_LOOKUP_FAILED' && error.status === 503
  );
});

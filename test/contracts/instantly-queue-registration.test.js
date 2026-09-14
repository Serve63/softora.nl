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
  assert.equal(hasPendingInstantlyQueue({ instantlyQueueStatus: 'design_pending' }), false);
  assert.equal(hasPendingInstantlyQueue({ payload: { instantlyQueueStatus: 'registered' } }), true);
  assert.equal(hasPendingInstantlyQueue({ instantlyStatus: 'queued' }), false);
});

test('Instantly queue moves an exact registered batch to design staging without marking outreach', async () => {
  const writes = [];
  const rows = [
    {
      id: 'queue-1',
      bedrijf: 'Ontwerplead',
      email: 'ontwerp@voorbeeld.nl',
      status: 'prospect',
      instantlyQueueStatus: 'registered',
      instantlyQueueSource: 'database-vondsten-20260914',
      instantlyQueueFileDigest: DIGEST,
    },
  ];
  const service = createInstantlyQueueRegistrationService({
    now: () => new Date('2026-09-14T17:00:00.000Z'),
    dataOpsStore: {
      async listUniqueCustomersByEmails() { return rows; },
      async upsertCustomers(updates, meta) { writes.push({ updates, meta }); return { ok: true }; },
    },
  });

  const result = await service.stageDesignBatch({
    emails: ['ontwerp@voorbeeld.nl'],
    sourceId: 'database-vondsten-20260914',
    fileDigest: DIGEST,
  });

  assert.equal(result.staged, 1);
  assert.equal(result.status, 'design_pending');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].updates[0].instantlyQueueStatus, 'design_pending');
  assert.equal(writes[0].updates[0].instantlyDesignStagedAt, '2026-09-14T17:00:00.000Z');
  assert.equal(writes[0].updates[0].lastColdmailProvider, undefined);
  assert.equal(writes[0].meta.source, 'instantly-design-staging');
});

test('Instantly design staging can synchronously refresh the canonical inventory after the final batch', async () => {
  const calls = [];
  const row = {
    id: 'queue-1',
    bedrijf: 'Ontwerplead',
    email: 'ontwerp@voorbeeld.nl',
    status: 'prospect',
    instantlyQueueStatus: 'design_pending',
    instantlyQueueSource: 'database-vondsten-20260914',
    instantlyQueueFileDigest: DIGEST,
  };
  const service = createInstantlyQueueRegistrationService({
    dataOpsStore: {
      async listUniqueCustomersByEmails() { return [row]; },
      async upsertCustomers() { throw new Error('Een reeds gestagede rij mag niet opnieuw worden geschreven.'); },
    },
    mailReadySnapshotService: {
      invalidate() { calls.push('invalidate'); },
      async buildMailReadySnapshot(options) {
        calls.push({ build: options });
        return {
          generatedAt: '2026-09-14T17:30:00.000Z',
          snapshotVersion: 'sha256:inventory',
          total: 518,
          availableTotal: 13_357,
        };
      },
    },
  });

  const result = await service.stageDesignBatch({
    emails: ['ontwerp@voorbeeld.nl'],
    sourceId: 'database-vondsten-20260914',
    fileDigest: DIGEST,
    refreshInventory: true,
  });

  assert.equal(result.staged, 0);
  assert.equal(result.alreadyStaged, 1);
  assert.deepEqual(calls, [
    'invalidate',
    {
      build: {
        limit: 1,
        offset: 0,
        includeFoundSnapshot: true,
        allowStaleWhileRefreshing: false,
      },
    },
  ]);
  assert.deepEqual(result.inventory, {
    generatedAt: '2026-09-14T17:30:00.000Z',
    snapshotVersion: 'sha256:inventory',
    mailReadyTotal: 518,
    availableTotal: 13_357,
  });
});

test('Instantly queue design staging fails closed on a different source', async () => {
  let wrote = false;
  const service = createInstantlyQueueRegistrationService({
    dataOpsStore: {
      async listUniqueCustomersByEmails() {
        return [{
          id: 'queue-1',
          email: 'ontwerp@voorbeeld.nl',
          instantlyQueueStatus: 'registered',
          instantlyQueueSource: 'andere-bron',
          instantlyQueueFileDigest: DIGEST,
        }];
      },
      async upsertCustomers() { wrote = true; return { ok: true }; },
    },
  });

  await assert.rejects(
    service.stageDesignBatch({
      emails: ['ontwerp@voorbeeld.nl'],
      sourceId: 'database-vondsten-20260914',
      fileDigest: DIGEST,
    }),
    (error) => error.code === 'INSTANTLY_QUEUE_DESIGN_STAGE_CONFLICT' && error.status === 409
  );
  assert.equal(wrote, false);
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

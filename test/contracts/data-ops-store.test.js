const test = require('node:test');
const assert = require('node:assert/strict');

const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');

function createSupabaseClientRecorder(currentCustomerIds = []) {
  const recorder = {
    upsertRows: [],
    deletedIds: [],
  };
  const client = {
    from(table) {
      return {
        upsert(rows) {
          if (table === 'softora_customers') recorder.upsertRows = rows;
          return Promise.resolve({ data: rows, error: null });
        },
        select(column) {
          return {
            is() {
              return {
                limit() {
                  const idColumn = String(column || 'customer_id');
                  return Promise.resolve({
                    data: currentCustomerIds.map((id) => ({ [idColumn]: id })),
                    error: null,
                  });
                },
              };
            },
          };
        },
        update() {
          return {
            in(_column, ids) {
              recorder.deletedIds = ids;
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      };
    },
  };
  return { client, recorder };
}

test('data ops store merges duplicate customer identities before structured upsert', async () => {
  const { client, recorder } = createSupabaseClientRecorder(['lead-1', 'lead-2']);
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-05-11T12:00:00.000Z'),
    logger: { error: () => {} },
  });

  const result = await store.replaceCustomers(
    [
      {
        id: 'lead-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        telefoon: '+31 6 12345678',
        email: '',
        status: 'prospect',
        databaseStatus: 'prospect',
        hist: [{ type: 'import', label: 'Import', date: '2026-04-01' }],
      },
      {
        id: 'lead-2',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        telefoon: '+31 6 12345678',
        email: 'ruben@example.test',
        status: 'klant',
        databaseStatus: 'klant',
        updatedAt: '2026-05-10T09:00:00.000Z',
        hist: [{ type: 'klant', label: 'Klant geworden', date: '2026-05-10' }],
      },
    ],
    { source: 'contract-test' }
  );

  assert.equal(result.ok, true);
  assert.equal(recorder.upsertRows.length, 1);
  assert.equal(recorder.upsertRows[0].customer_id, 'lead-2');
  assert.equal(recorder.upsertRows[0].database_status, 'klant');
  assert.equal(recorder.upsertRows[0].payload.email, 'ruben@example.test');
  assert.deepEqual(recorder.upsertRows[0].payload.mergedCustomerIds, ['lead-2', 'lead-1']);
  assert.deepEqual(
    recorder.upsertRows[0].payload.hist.map((entry) => entry.type),
    ['klant', 'import']
  );
  assert.deepEqual(recorder.deletedIds, ['lead-1']);
});

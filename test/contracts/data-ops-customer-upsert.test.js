const test = require('node:test');
const assert = require('node:assert/strict');

const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');

test('data ops customer partial upsert does not mark missing customers deleted', async () => {
  const recorder = {
    upsertRows: [],
    selectCalled: false,
    updateCalled: false,
  };
  const client = {
    from(table) {
      return {
        upsert(rows, options) {
          assert.equal(table, 'softora_customers');
          assert.deepEqual(options, { onConflict: 'customer_id' });
          recorder.upsertRows = rows;
          return Promise.resolve({ data: rows, error: null });
        },
        select() {
          recorder.selectCalled = true;
          return { is: () => ({ limit: async () => ({ data: [], error: null }) }) };
        },
        update() {
          recorder.updateCalled = true;
          return { in: async () => ({ data: [], error: null }) };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-06-26T12:00:00.000Z'),
    logger: { error() {} },
  });

  const result = await store.upsertCustomers(
    [{ id: 'cust-new', bedrijf: 'Snelle Import', naam: 'Snelle Import' }],
    { source: 'premium-database-import' }
  );

  assert.equal(result.ok, true);
  assert.equal(recorder.upsertRows.length, 1);
  assert.equal(recorder.upsertRows[0].customer_id, 'cust-new');
  assert.equal(recorder.upsertRows[0].source, 'premium-database-import');
  assert.equal(recorder.selectCalled, false);
  assert.equal(recorder.updateCalled, false);
});

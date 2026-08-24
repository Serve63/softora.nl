const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerPersistence } = require('../../assets/premium-customers-store.js');

function createFixture(overrides = {}) {
  const requests = [];
  let sharedRows = [
    { id: 'prospect-1', databaseStatus: 'prospect' },
    { id: 'customer-1', databaseStatus: 'klant', naam: 'Oud' },
  ];
  const persistence = createCustomerPersistence({
    scope: 'premium_customers_database',
    key: 'softora_customers_premium_v1',
    normalizeCustomer: (customer) => ({ ...customer, databaseStatus: 'klant' }),
    normalizeString: (value) => String(value || '').trim(),
    isCustomerLifecycleRecord: (row) => row && row.databaseStatus === 'klant',
    fetchUiStateSetWithFallback: async (scope, body) => {
      requests.push({ scope, body });
      if (overrides.error) throw overrides.error;
    },
    getSharedCustomerRows: () => sharedRows,
    setSharedCustomerRows: (rows) => { sharedRows = rows; },
  });
  return { persistence, requests, getSharedRows: () => sharedRows };
}

test('customer persistence sends exactly one customer and preserves unrelated shared rows', async () => {
  const fixture = createFixture();
  const result = await fixture.persistence.persistCustomerUpsert({ id: 'customer-1', naam: 'Nieuw' });

  assert.deepEqual(result, { ok: true });
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].scope, 'premium_customers_database');
  assert.equal(fixture.requests[0].body.mode, 'upsert');
  assert.equal(fixture.requests[0].body.upsertOnly, true);
  assert.deepEqual(
    JSON.parse(fixture.requests[0].body.patch.softora_customers_premium_v1),
    [{ id: 'customer-1', naam: 'Nieuw', databaseStatus: 'klant' }]
  );
  assert.deepEqual(fixture.getSharedRows(), [
    { id: 'prospect-1', databaseStatus: 'prospect' },
    { id: 'customer-1', naam: 'Nieuw', databaseStatus: 'klant' },
  ]);
});

test('customer persistence leaves local rows unchanged when storage fails', async () => {
  const fixture = createFixture({ error: new Error('Supabase niet bereikbaar') });
  const before = fixture.getSharedRows();
  const result = await fixture.persistence.persistCustomerUpsert({ id: 'customer-2', naam: 'Nieuw' });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /Supabase niet bereikbaar/);
  assert.equal(fixture.getSharedRows(), before);
});

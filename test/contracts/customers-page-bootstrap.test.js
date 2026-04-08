const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCustomersPageBootstrapService,
} = require('../../server/services/customers-page-bootstrap');

test('customers page bootstrap prefers stored customer database rows', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope !== 'premium_customers_database') return null;
      return {
        values: {
          softora_customers_premium_v1: JSON.stringify([
            {
              id: 'klant-2',
              naam: 'Maarten Van Gemert',
              bedrijf: 'Growingbyknowing.nl',
              telefoon: '(06) 10 10 22 93',
              type: 'Website',
              website: 'Growingbyknowing.nl',
              bedrag: 300,
              status: 'Betaald',
              actief: 'Nee',
              datum: '2026-01-07',
            },
            {
              id: 'klant-1',
              naam: 'Linsey Klaus',
              bedrijf: 'Linszorgt.nl',
              telefoon: '+31 6 13 18 38 44',
              type: 'Website',
              website: 'Linszorgt.nl',
              bedrag: 300,
              status: 'Betaald',
              actief: 'Ja',
              datum: '2026-03-23',
            },
          ]),
        },
      };
    },
  });

  const payload = await service.buildCustomersBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'customers');
  assert.deepEqual(
    payload.customers.map((customer) => customer.naam),
    ['Linsey Klaus', 'Maarten Van Gemert']
  );
  assert.match(String(payload.loadedAt || ''), /^\d{4}-\d{2}-\d{2}T/);
});

test('customers page bootstrap falls back to deriving customers from active orders', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: '[]',
          },
        };
      }

      if (scope === 'premium_active_orders') {
        return {
          values: {
            softora_custom_orders_premium_v1: JSON.stringify([
              {
                id: 11,
                clientName: 'Servé Creusen',
                location: 'Breda',
                title: 'Website opdracht',
                description: 'Nieuwe website bouwen',
                amount: 2500,
                status: 'betaald',
                paidAt: '2026-04-08T10:00:00.000Z',
              },
            ]),
          },
        };
      }

      return null;
    },
  });

  const payload = await service.buildCustomersBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'orders');
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.customers[0].naam, 'Servé Creusen');
  assert.equal(payload.customers[0].bedrijf, 'Breda');
  assert.equal(payload.customers[0].type, 'Website');
  assert.equal(payload.customers[0].status, 'Betaald');
});

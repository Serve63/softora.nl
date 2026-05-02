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
              datum: '2026-01-07T10:00:00.000Z',
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
  assert.equal(payload.customers[0].service, 'website');
  assert.equal(payload.customers[0].review, 'Nee');
  assert.equal(payload.customers[0].verantwoordelijk, 'Serve');
  assert.equal(payload.customers[1].datum, '2026-01-07');
  assert.match(String(payload.loadedAt || ''), /^\d{4}-\d{2}-\d{2}T/);

  const replacements = service.buildDashboardHtmlReplacements(payload);
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '\u20ac600');
  assert.equal(replacements.SOFTORA_DASHBOARD_MAINTENANCE_REVENUE, '\u20ac0');
  assert.match(replacements.SOFTORA_DASHBOARD_REVENUE_CHART, /<span class="chart-label">Jan<\/span>/);
  assert.match(replacements.SOFTORA_DASHBOARD_REVENUE_CHART, /<span class="chart-label">Mrt<\/span>/);
  assert.match(
    replacements.SOFTORA_DASHBOARD_REVENUE_CHART,
    /data-chart-index="0" style="height: 214px;" title="€300"/
  );
  assert.match(
    replacements.SOFTORA_DASHBOARD_REVENUE_CHART,
    /data-chart-index="2" style="height: 214px;" title="€300"/
  );
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /^2<script>/);
});

test('customers page bootstrap vult dashboard actieve-opdrachten teller server-side', () => {
  const orders = JSON.stringify([
    {
      id: 11,
      clientName: 'Servé Creusen',
      title: 'Website opdracht',
      description: 'Nieuwe website bouwen',
      amount: 2500,
      status: 'wacht',
    },
    {
      id: 12,
      clientName: 'BusinessCo',
      title: 'Bedrijfssoftware opdracht',
      description: 'CRM bouwen',
      amount: 2500,
      status: 'wacht',
    },
    {
      id: 13,
      clientName: 'VoiceCo',
      title: 'Voicesoftware opdracht',
      description: 'Belbot bouwen',
      amount: 2500,
      status: 'wacht',
    },
    {
      id: 14,
      clientName: 'ChatCo',
      title: 'Chatbot opdracht',
      description: 'WhatsApp bot bouwen',
      amount: 2500,
      status: 'wacht',
    },
    {
      id: 15,
      clientName: 'KlaarCo',
      title: 'Website opdracht',
      description: 'Al gebouwd',
      amount: 2500,
      status: 'wacht',
    },
  ]);
  const service = createCustomersPageBootstrapService({});

  const replacements = service.buildDashboardHtmlReplacements({
    customers: [],
    activeOrdersState: {
      values: {
        softora_custom_orders_premium_v1: '',
        softora_custom_orders_premium_v1_chunks_v1: JSON.stringify({ count: 2 }),
        softora_custom_orders_premium_v1_chunk_0: orders.slice(0, 80),
        softora_custom_orders_premium_v1_chunk_1: orders.slice(80),
        softora_order_runtime_premium_v1: JSON.stringify({
          11: { statusKey: 'bezig', progressPct: 0 },
          12: { statusKey: 'bezig', progressPct: 0 },
          13: { statusKey: 'bezig', progressPct: 0 },
          14: { statusKey: 'bezig', progressPct: 0 },
          15: { statusKey: 'betaald', progressPct: 0 },
        }),
      },
    },
  });

  const script = replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS;
  assert.match(script, /"website":1/);
  assert.match(script, /"business":1/);
  assert.match(script, /"voice":1/);
  assert.match(script, /"chatbot":1/);
  assert.match(script, /data-kpi-active-website/);
});

test('customers page bootstrap levert actieve-opdrachten state voor snelle paginastart', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      assert.equal(scope, 'premium_active_orders');
      return {
        source: 'supabase:data_ops',
        updatedAt: '2026-05-01T00:00:00.000Z',
        values: {
          softora_custom_orders_premium_v1: '',
          softora_custom_orders_premium_v1_chunks_v1: JSON.stringify({ count: 1 }),
          softora_custom_orders_premium_v1_chunk_0: JSON.stringify([
            {
              id: 11,
              clientName: 'Servé Creusen',
              title: 'Website opdracht',
              description: 'Nieuwe website bouwen',
              amount: 2500,
            },
          ]),
          softora_order_runtime_premium_v1: JSON.stringify({
            11: { statusKey: 'bezig', progressPct: 0 },
          }),
        },
      };
    },
  });

  const payload = await service.buildActiveOrdersPageBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.activeOrdersState.source, 'supabase:data_ops');
  assert.equal(payload.activeOrdersState.updatedAt, '2026-05-01T00:00:00.000Z');
  assert.match(
    payload.activeOrdersState.values.softora_custom_orders_premium_v1_chunks_v1,
    /"count":1/
  );
  assert.match(payload.activeOrdersState.values.softora_order_runtime_premium_v1, /"bezig"/);
});

test('customers page bootstrap leest chunked customer database rows', async () => {
  const rawCustomers = JSON.stringify([
    {
      id: 'klant-1',
      naam: 'Linsey Klaus',
      bedrijf: 'Linszorgt.nl',
      telefoon: '+31 6 13 18 38 44',
      type: 'Website',
      website: 'Linszorgt.nl',
      websiteBedrag: 300,
      status: 'Betaald',
      actief: 'Ja',
      datum: '2026-03-23',
    },
  ]);
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope !== 'premium_customers_database') return null;
      return {
        values: {
          softora_customers_premium_v1: '',
          softora_customers_premium_v1_chunks_v1: JSON.stringify({ count: 2 }),
          softora_customers_premium_v1_chunk_0: rawCustomers.slice(0, 40),
          softora_customers_premium_v1_chunk_1: rawCustomers.slice(40),
        },
      };
    },
  });

  const payload = await service.buildCustomersBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'customers');
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.customers[0].naam, 'Linsey Klaus');
  assert.equal(payload.customers[0].websiteBedrag, 300);
});

test('customers page bootstrap behoudt database-statussen voor dashboard filtering', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope !== 'premium_customers_database') return null;
      return {
        values: {
          softora_customers_premium_v1: JSON.stringify([
            {
              id: 'lead-1',
              naam: 'Prospect Bedrijf',
              bedrijf: 'Prospect Bedrijf',
              status: 'benaderbaar',
              databaseStatus: 'benaderbaar',
            },
            {
              id: 'klant-1',
              naam: 'Linsey Klaus',
              bedrijf: 'Linszorgt.nl',
              websiteBedrag: 300,
              status: 'klant',
              databaseStatus: 'klant',
              datum: '2026-03-23',
            },
          ]),
        },
      };
    },
  });

  const payload = await service.buildCustomersBootstrapPayload();

  assert.equal(payload.customers.length, 2);
  const prospect = payload.customers.find((customer) => customer.id === 'lead-1');
  const customer = payload.customers.find((item) => item.id === 'klant-1');
  assert.equal(prospect.databaseStatus, 'benaderbaar');
  assert.equal(prospect.status, 'benaderbaar');
  assert.equal(customer.databaseStatus, 'klant');
  assert.equal(customer.status, 'Betaald');
  assert.equal(customer.websiteBedrag, 300);
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
  assert.equal(payload.customers[0].service, 'website');
  assert.equal(payload.customers[0].review, 'Nee');
  assert.equal(payload.customers[0].status, 'Betaald');
  assert.equal(payload.customers[0].verantwoordelijk, 'Serve');
});

test('customers page bootstrap prefers explicit order customer identity fields when available', async () => {
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
                id: 21,
                clientName: 'Softora B.V.',
                location: 'Servé Creusen',
                companyName: 'Softora B.V.',
                contactName: 'Servé Creusen',
                contactPhone: '+31 6 12 34 56 78',
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
  assert.equal(payload.customers[0].bedrijf, 'Softora B.V.');
  assert.equal(payload.customers[0].telefoon, '+31 6 12 34 56 78');
  assert.equal(payload.customers[0].verantwoordelijk, 'Serve');
});

test('customers page bootstrap derives verantwoordelijke from active order claim owner', async () => {
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
                id: 31,
                companyName: 'Alpha B.V.',
                contactName: 'Iris de Boer',
                contactPhone: '+31 6 11 22 33 44',
                title: 'Website opdracht',
                description: 'Nieuwe website bouwen',
                amount: 3200,
                status: 'betaald',
                paidAt: '2026-04-08T10:00:00.000Z',
                claimedBy: 'Martijn van de Ven',
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
  assert.equal(payload.customers[0].verantwoordelijk, 'Martijn');
});

test('customers page bootstrap backfills verantwoordelijke for stored rows from matching active orders', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: 'klant-11',
                naam: 'Iris de Boer',
                bedrijf: 'Alpha B.V.',
                telefoon: '+31 6 11 22 33 44',
                type: 'Website',
                website: 'alpha.nl',
                bedrag: 3200,
                status: 'Betaald',
                actief: 'Ja',
                datum: '2026-04-08',
              },
            ]),
          },
        };
      }

      if (scope === 'premium_active_orders') {
        return {
          values: {
            softora_custom_orders_premium_v1: JSON.stringify([
              {
                id: 31,
                companyName: 'Alpha B.V.',
                contactName: 'Iris de Boer',
                contactPhone: '+31 6 11 22 33 44',
                title: 'Website opdracht',
                description: 'Nieuwe website bouwen',
                amount: 3200,
                status: 'betaald',
                paidAt: '2026-04-08T10:00:00.000Z',
                claimedBy: 'Martijn van de Ven',
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
  assert.equal(payload.source, 'customers');
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.customers[0].verantwoordelijk, 'Martijn');
});

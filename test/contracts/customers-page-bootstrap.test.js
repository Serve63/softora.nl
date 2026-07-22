const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCustomersPageBootstrapService,
} = require('../../server/services/customers-page-bootstrap');
const {
  MAIL_READY_BOOTSTRAP_CACHE_KEY,
  MAIL_READY_BOOTSTRAP_CACHE_SCOPE,
} = require('../../server/services/premium-database-mail-ready-snapshot');

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
              stad: 'Raadhuisplein 1, 4861 RV Chaam',
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
              adres: 'Gemullehoekenweg 1, 5062 SB Oisterwijk',
              bedrag: 300,
              status: 'Betaald',
              actief: 'Ja',
              datum: '2026-03-23',
              lastColdmailProvider: 'instantly',
              lastColdmailProviderStatus: 'synced',
              instantlyLeadId: 'instantly-lead-1',
              instantlyCampaignId: 'instantly-campaign-1',
              instantlyStatus: 'synced',
              instantlySyncedAt: '2026-05-25T21:36:48.980Z',
              instantlyLastEventAt: '2026-05-25T21:36:48.980Z',
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
  assert.equal(payload.customers[0].stad, 'Gemullehoekenweg 1, 5062 SB Oisterwijk');
  assert.equal(payload.customers[0].review, 'Nee');
  assert.equal(payload.customers[0].verantwoordelijk, 'Team');
  assert.equal(payload.customers[0].lastColdmailProvider, 'instantly');
  assert.equal(payload.customers[0].instantlyLeadId, 'instantly-lead-1');
  assert.equal(payload.customers[0].instantlyCampaignId, 'instantly-campaign-1');
  assert.equal(payload.customers[0].instantlySyncedAt, '2026-05-25T21:36:48.980Z');
  assert.equal(payload.customers[1].datum, '2026-01-07');
  assert.deepEqual(payload.activeOrdersState.values, {});
  assert.match(String(payload.loadedAt || ''), /^\d{4}-\d{2}-\d{2}T/);

  const replacements = service.buildDashboardHtmlReplacements(payload);
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '\u20ac600');
  assert.equal(replacements.SOFTORA_DASHBOARD_MAINTENANCE_REVENUE, '\u20ac0');
  assert.equal(replacements.SOFTORA_DASHBOARD_RECURRING_REVENUE, '\u20ac0');
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

test('customers page bootstrap can defer heavy customer rows for the premium database page', async () => {
  const seenScopes = [];
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      seenScopes.push(scope);
      if (scope === 'premium_customers_database') {
        return {
          source: 'supabase:data_ops',
          values: {
            softora_customers_premium_v1: JSON.stringify([
              { id: 'heavy-1', bedrijf: 'Zware database rij', status: 'prospect' },
            ]),
          },
        };
      }
      return {
        source: 'supabase:data_ops',
        values: {
          softora_custom_orders_premium_v1: JSON.stringify([]),
        },
      };
    },
  });

  const payload = await service.buildCustomersBootstrapPayload({ includeCustomers: false });

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'deferred');
  assert.equal(payload.deferred, true);
  assert.deepEqual(payload.customers, []);
  assert.deepEqual(seenScopes, []);
  assert.equal(payload.activeOrdersState.source, '');
});

test('premium database bootstrap reads the compact snapshot and lightweight metric caches', async () => {
  const seenReads = [];
  const snapshot = {
    version: 1,
    generatedAt: '2026-07-10T12:00:00.000Z',
    total: 1013,
    customers: [
      { id: 'mail-ready-1', bedrijf: 'Mailklaar', mailReady: true, mailReadySnapshot: true },
    ],
    availableTotal: 113,
    availableCustomers: [
      { id: 'available-1', bedrijf: 'Beschikbaar', availableSnapshot: true },
    ],
  };
  const service = createCustomersPageBootstrapService({
    now: () => new Date('2026-07-10T12:00:30.000Z'),
    getUiStateValues: async (scope, options) => {
      seenReads.push({ scope, options });
      if (scope === 'premium_coldmail_stats_cache') return { source: 'supabase', values: { softora_coldmail_stats_cache_v1: JSON.stringify({ ok: true, stats: { systemSentToday: 4, totalBounces: 29, systemTotalSent: 1462, updatedAt: '2026-07-10T12:00:00.000Z' } }) } };
      if (scope === 'premium_database_mail_roi') return { source: 'supabase', values: { premium_database_mail_roi_v1: JSON.stringify({ dealCount: 2 }) } };
      if (scope === 'premium_coldmail_autopilot') return { source: 'supabase', values: { softora_coldmail_autopilot_v1: JSON.stringify({ enabled: false }) } };
      assert.equal(scope, MAIL_READY_BOOTSTRAP_CACHE_SCOPE);
      return {
        source: 'supabase',
        values: { [MAIL_READY_BOOTSTRAP_CACHE_KEY]: JSON.stringify(snapshot) },
      };
    },
  });

  const payload = await service.buildMailReadySnapshotBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'mail-ready-snapshot-cache');
  assert.equal(payload.stale, false);
  assert.equal(payload.mailReadySnapshotTotal, 1013);
  assert.equal(payload.availableSnapshotTotal, 113);
  assert.deepEqual(payload.customers.map((customer) => customer.id), ['mail-ready-1', 'available-1']);
  assert.deepEqual(payload.mailStats, { sentToday: 4, bounces: 29, totalSent: 1462, updatedAt: '2026-07-10T12:00:00.000Z' });
  assert.deepEqual(payload.mailRoi, { dealCount: 2 });
  assert.deepEqual(payload.autopilot, { loaded: true, enabled: false });
  assert.deepEqual(seenReads.map((read) => read.scope), [
    MAIL_READY_BOOTSTRAP_CACHE_SCOPE,
    'premium_coldmail_stats_cache',
    'premium_database_mail_roi',
    'premium_coldmail_autopilot',
  ]);
  assert.equal(seenReads.every((read) => read.options.uiStateReadTimeoutMs === 1200), true);
  assert.equal(seenReads.some((read) => read.scope === 'premium_customers_database'), false);
});

test('premium database bootstrap renders an expired valid snapshot while fresh data loads in the background', async () => {
  const service = createCustomersPageBootstrapService({
    now: () => new Date('2026-07-10T12:02:00.000Z'),
    getUiStateValues: async (scope) => {
      if (scope !== MAIL_READY_BOOTSTRAP_CACHE_SCOPE) return { source: 'supabase', values: {} };
      return {
        source: 'supabase',
        values: {
          [MAIL_READY_BOOTSTRAP_CACHE_KEY]: JSON.stringify({
            version: 2,
            generatedAt: '2026-07-10T12:00:00.000Z',
            total: 740,
            customers: [{ id: 'stale-ready', mailReady: true, mailReadySnapshot: true }],
            availableTotal: 1,
            availableCustomers: [{ id: 'stale-deleted', availableSnapshot: true }],
          }),
        },
      };
    },
  });

  const payload = await service.buildMailReadySnapshotBootstrapPayload();

  assert.equal(payload.source, 'mail-ready-snapshot-cache');
  assert.equal(payload.stale, true);
  assert.deepEqual(payload.customers.map((customer) => customer.id), ['stale-ready', 'stale-deleted']);
  assert.equal(payload.mailReadySnapshotTotal, 740);
  assert.equal(payload.availableSnapshotTotal, 1);
});

test('premium database bootstrap still rejects a snapshot without a valid generation time', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => ({
      source: 'supabase',
      values: scope === MAIL_READY_BOOTSTRAP_CACHE_SCOPE
        ? {
            [MAIL_READY_BOOTSTRAP_CACHE_KEY]: JSON.stringify({
              generatedAt: 'ongeldig',
              total: 1,
              customers: [{ id: 'invalid-ready', mailReadySnapshot: true }],
              availableTotal: 0,
              availableCustomers: [],
            }),
          }
        : {},
    }),
  });

  const payload = await service.buildMailReadySnapshotBootstrapPayload();

  assert.equal(payload.source, 'deferred');
  assert.equal(payload.deferred, true);
  assert.deepEqual(payload.customers, []);
});

test('premium database bootstrap never turns a missing cache into fake zero totals', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async () => ({ source: 'supabase', values: {} }),
  });

  const payload = await service.buildMailReadySnapshotBootstrapPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'deferred');
  assert.equal(payload.deferred, true);
  assert.deepEqual(payload.customers, []);
  assert.equal(payload.mailReadySnapshotTotal, null);
  assert.equal(payload.availableSnapshotTotal, null);
});

test('customers page bootstrap gebruikt compacte dashboardklanten zonder zware customer state', async () => {
  const seenScopes = [];
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      seenScopes.push(scope);
      if (scope === 'premium_customers_database') {
        throw new Error('Dashboard bootstrap mag de zware klantstate niet lezen.');
      }
      if (scope === 'premium_active_orders') {
        return {
          source: 'supabase:data_ops',
          values: {
            softora_custom_orders_premium_v1: JSON.stringify([]),
          },
        };
      }
      return null;
    },
    listDashboardCustomers: async () => [
      {
        id: 'klant-compact-1',
        naam: 'Linsey Klaus',
        bedrijf: 'Linszorgt.nl',
        websiteBedrag: 300,
        status: 'Betaald',
        databaseStatus: 'klant',
        datum: '2026-03-23',
      },
    ],
  });

  const payload = await service.buildCustomersBootstrapPayload({
    preferDashboardCustomers: true,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'dashboard-customers');
  assert.deepEqual(seenScopes, ['premium_active_orders']);
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.customers[0].bedrijf, 'Linszorgt.nl');
  assert.equal(payload.customers[0].websiteBedrag, 300);

  const replacements = service.buildDashboardHtmlReplacements(payload);
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '\u20ac300');
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /^1<script>/);
});

test('dashboard bootstrap toont geen nep-nullen wanneer alleen opdrachten geladen zijn', async () => {
  const seenScopes = [];
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      seenScopes.push(scope);
      if (scope !== 'premium_active_orders') {
        throw new Error('Dashboard mag niet terugvallen op de zware customer-state.');
      }
      return {
        source: 'supabase:data_ops',
        values: {
          softora_custom_orders_premium_v1: JSON.stringify([
            { id: 1, clientName: 'Klant A', title: 'Website opdracht', status: 'wacht' },
            { id: 2, clientName: 'Klant B', title: 'Website opdracht', status: 'wacht' },
          ]),
          softora_order_runtime_premium_v1: '{}',
        },
      };
    },
    listDashboardCustomers: async () => null,
  });

  const payload = await service.buildCustomersBootstrapPayload({
    preferDashboardCustomers: true,
    dashboardCustomersTimeoutMs: 25,
    dashboardOrderStateTimeoutMs: 25,
  });
  const replacements = service.buildDashboardHtmlReplacements(payload);

  assert.equal(payload.ok, false);
  assert.equal(payload.source, 'unavailable');
  assert.deepEqual(payload.customers, []);
  assert.deepEqual(seenScopes, ['premium_active_orders']);
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '--');
  assert.equal(replacements.SOFTORA_DASHBOARD_RECURRING_REVENUE, '--');
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /^--<script>/);
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /"website":2/);
});

test('dashboard bootstrap behandelt een lege formele klantenlijst als geldige nul', async () => {
  const seenScopes = [];
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      seenScopes.push(scope);
      return {
        source: 'supabase:data_ops',
        values: {
          softora_custom_orders_premium_v1: '[]',
          softora_order_runtime_premium_v1: '{}',
        },
      };
    },
    listDashboardCustomers: async () => [],
  });

  const payload = await service.buildCustomersBootstrapPayload({
    preferDashboardCustomers: true,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'dashboard-customers');
  assert.deepEqual(payload.customers, []);
  assert.deepEqual(seenScopes, ['premium_active_orders']);
  assert.equal(service.buildDashboardHtmlReplacements(payload).SOFTORA_DASHBOARD_TOTAL_REVENUE, '\u20ac0');
});

test('dashboard bootstrap behandelt runtime zonder opdrachtenlijst als onvolledig', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async () => ({
      source: 'supabase:data_ops',
      values: {
        softora_order_runtime_premium_v1: JSON.stringify({ 7: { statusKey: 'running' } }),
      },
    }),
    listDashboardCustomers: async () => [
      {
        id: 'klant-1',
        databaseStatus: 'klant',
        status: 'Betaald',
        websiteBedrag: 300,
        datum: '2026-03-23',
      },
    ],
  });

  const payload = await service.buildCustomersBootstrapPayload({ preferDashboardCustomers: true });
  const replacements = service.buildDashboardHtmlReplacements(payload);

  assert.equal(payload.ok, true);
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '\u20ac300');
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /markActiveOrdersUnavailable/);
  assert.doesNotMatch(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /"website":0/);
});

test('customers page bootstrap laat trage actieve opdrachten dashboardklanten niet blokkeren', async () => {
  const seenScopes = [];
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async (scope) => {
      seenScopes.push(scope);
      if (scope === 'premium_active_orders') return new Promise(() => {});
      throw new Error('Zware klantstate mag niet nodig zijn wanneer dashboardklanten geladen zijn.');
    },
    listDashboardCustomers: async () => [
      {
        id: 'klant-compact-1',
        naam: 'Linsey Klaus',
        bedrijf: 'Linszorgt.nl',
        websiteBedrag: 300,
        status: 'Betaald',
        databaseStatus: 'klant',
        datum: '2026-03-23',
      },
    ],
  });

  const payload = await service.buildCustomersBootstrapPayload({
    preferDashboardCustomers: true,
    dashboardOrderStateTimeoutMs: 5,
    dashboardCustomersTimeoutMs: 50,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'dashboard-customers');
  assert.deepEqual(seenScopes, ['premium_active_orders']);
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.activeOrdersState.source, 'unavailable');

  const replacements = service.buildDashboardHtmlReplacements(payload);
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '\u20ac300');
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /^1<script>/);
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /markActiveOrdersUnavailable/);
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
      source: 'supabase:data_ops',
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

test('customers page bootstrap toont dashboard data als tijdelijk niet geladen in plaats van nep-nullen', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async () => null,
  });

  const payload = await service.buildCustomersBootstrapPayload();
  const replacements = service.buildDashboardHtmlReplacements({
    ...payload,
    activeOrdersState: null,
  });

  assert.equal(payload.ok, false);
  assert.equal(payload.source, 'unavailable');
  assert.equal(replacements.SOFTORA_DASHBOARD_TOTAL_REVENUE, '--');
  assert.equal(replacements.SOFTORA_DASHBOARD_RECURRING_REVENUE, '--');
  assert.doesNotMatch(replacements.SOFTORA_DASHBOARD_REVENUE_CHART, /title="€0"/);
  assert.match(replacements.SOFTORA_DASHBOARD_REVENUE_CHART, /title="--"/);
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /^--<script>/);
  assert.match(replacements.SOFTORA_DASHBOARD_TOTAL_CLIENTS, /markActiveOrdersUnavailable/);
});

test('customers page bootstrap behandelt geworpen Supabase-read errors als tijdelijk niet geladen', async () => {
  const service = createCustomersPageBootstrapService({
    getUiStateValues: async () => {
      throw new Error('Supabase timeout');
    },
  });

  const payload = await service.buildCustomersBootstrapPayload();

  assert.equal(payload.ok, false);
  assert.equal(payload.source, 'unavailable');
  assert.match(payload.message, /Supabase-data tijdelijk niet geladen/);
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
  assert.match(
    payload.activeOrdersState.values.softora_custom_orders_premium_v1,
    /Servé Creusen/
  );
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.customers[0].naam, 'Servé Creusen');
  assert.equal(payload.customers[0].bedrijf, 'Breda');
  assert.equal(payload.customers[0].type, 'Website');
  assert.equal(payload.customers[0].service, 'website');
  assert.equal(payload.customers[0].review, 'Nee');
  assert.equal(payload.customers[0].status, 'Betaald');
  assert.equal(payload.customers[0].verantwoordelijk, 'Team');
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
  assert.equal(payload.customers[0].verantwoordelijk, 'Team');
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

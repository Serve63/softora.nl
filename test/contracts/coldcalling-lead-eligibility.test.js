const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterColdcallingLeadsByDatabaseStatus,
  normalizeDatabaseContactStatus,
  parseCustomerDatabaseRowsFromUiState,
} = require('../../server/services/coldcalling-lead-eligibility');
const { registerColdcallingRoutes } = require('../../server/routes/coldcalling');

function createRouteHarness(deps) {
  let startHandler = null;
  const app = {
    post(path, ...handlers) {
      if (path === '/api/coldcalling/start') {
        startHandler = handlers[handlers.length - 1];
      }
    },
    get() {},
  };
  registerColdcallingRoutes(app, deps);
  assert.equal(typeof startHandler, 'function');

  return async function callStart(body = {}) {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return payload;
      },
    };
    await startHandler({ body }, res);
    return res;
  };
}

function buildCampaign(overrides = {}) {
  return {
    amount: 1,
    sector: 'Website',
    region: 'Oisterwijk',
    dispatchMode: 'parallel',
    dispatchDelaySeconds: 0,
    coldcallingStack: 'retell',
    coldcallingStackLabel: 'Retell',
    ...overrides,
  };
}

test('coldcalling lead eligibility normalizes database statuses that block outreach', () => {
  assert.equal(normalizeDatabaseContactStatus('Interesse'), 'interesse');
  assert.equal(normalizeDatabaseContactStatus('geïnteresseerd'), 'interesse');
  assert.equal(normalizeDatabaseContactStatus('meeting'), 'afspraak');
  assert.equal(normalizeDatabaseContactStatus('customer'), 'klant');
  assert.equal(normalizeDatabaseContactStatus('geen deal'), 'afgehaakt');
  assert.equal(normalizeDatabaseContactStatus('do not call'), 'geblokkeerd');
  assert.equal(normalizeDatabaseContactStatus('invalid number'), 'buiten');
  assert.equal(normalizeDatabaseContactStatus('Geen gehoor'), 'geengehoor');
});

test('coldcalling lead eligibility filters blocked premium database rows by phone and company', () => {
  const leads = [
    { company: 'Servé Creusen', phone: '06 2991 7185' },
    { company: 'Growingbyknowing', phone: '06 1111 1111' },
    { company: 'Open Prospect', phone: '06 2222 2222' },
    { company: 'Inactive Prospect', phone: '06 3333 3333' },
    { company: 'Lost Prospect', phone: '06 4444 4444' },
  ];
  const databaseRows = [
    { bedrijf: 'Servé Creusen', telefoon: '+31629917185', status: 'interesse' },
    { bedrijf: 'Growingbyknowing', telefoon: '', databaseStatus: 'Afspraak' },
    { bedrijf: 'Open Prospect', telefoon: '+31622222222', status: 'Gemaild' },
    { bedrijf: 'Inactive Prospect', telefoon: '+31633333333', status: 'Benaderbaar', actief: 'Nee' },
    { bedrijf: 'Lost Prospect', telefoon: '+31644444444', databaseStatus: 'afgehaakt' },
  ];

  const result = filterColdcallingLeadsByDatabaseStatus(leads, databaseRows);

  assert.equal(result.allowed.length, 1);
  assert.equal(result.allowed[0].lead.company, 'Open Prospect');
  assert.equal(result.allowed[0].index, 2);
  assert.equal(result.skippedResults.length, 4);
  assert.deepEqual(
    result.skippedResults.map((item) => item.details.databaseStatus),
    ['interesse', 'afspraak', 'buiten', 'afgehaakt']
  );
});

test('coldcalling lead eligibility parses premium database rows from ui state', () => {
  const values = {
    softora_customers_premium_v1: JSON.stringify([
      { bedrijf: 'A', status: 'interesse' },
      null,
      { bedrijf: 'B', status: 'klant' },
    ]),
  };

  const rows = parseCustomerDatabaseRowsFromUiState(values);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].bedrijf, 'A');
  assert.equal(rows[1].bedrijf, 'B');
});

test('coldcalling start skips database-blocked leads before provider dispatch', async () => {
  let processed = 0;
  let envChecked = false;
  const callStart = createRouteHarness({
    validateStartPayload: () => ({
      campaign: buildCampaign({ amount: 1 }),
      leads: [{ company: 'Servé Creusen', phone: '06 2991 7185' }],
    }),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    resolveColdcallingProviderForCampaign: () => 'retell',
    getUiStateValues: async (scope) => {
      if (scope === 'premium_active_orders') {
        return { values: { softora_custom_orders_premium_v1: '[]' }, source: 'supabase' };
      }
      assert.equal(scope, 'premium_customers_database');
      return {
        values: {
          softora_customers_premium_v1: JSON.stringify([
            { bedrijf: 'Servé Creusen', telefoon: '+31629917185', status: 'interesse' },
          ]),
        },
        source: 'supabase',
      };
    },
    premiumActiveOrdersScope: 'premium_active_orders',
    premiumActiveCustomOrdersKey: 'softora_custom_orders_premium_v1',
    getMissingEnvVars: () => {
      envChecked = true;
      return [];
    },
    processColdcallingLead: async () => {
      processed += 1;
      return { success: true };
    },
    createSequentialDispatchQueue: () => ({ id: 'queue-1', leads: [], results: [] }),
    advanceSequentialDispatchQueue: async () => null,
    waitForQueuedRuntimeStatePersist: async () => null,
    sleep: async () => null,
  });

  const res = await callStart({});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.summary.started, 0);
  assert.equal(res.body.summary.skipped, 1);
  assert.equal(res.body.summary.failed, 0);
  assert.equal(res.body.results[0].skipped, true);
  assert.equal(processed, 0);
  assert.equal(envChecked, false);
});

test('coldcalling start dispatches only allowed leads and keeps original lead indexes', async () => {
  const processedIndexes = [];
  const callStart = createRouteHarness({
    validateStartPayload: () => ({
      campaign: buildCampaign({ amount: 2 }),
      leads: [
        { company: 'Blocked Lead', phone: '06 1000 0000' },
        { company: 'Open Lead', phone: '06 2000 0000' },
      ],
    }),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    resolveColdcallingProviderForCampaign: () => 'retell',
    getUiStateValues: async (scope) => {
      if (scope === 'premium_active_orders') {
        return { values: { softora_custom_orders_premium_v1: '[]' }, source: 'supabase' };
      }
      return {
        values: {
          softora_customers_premium_v1: JSON.stringify([
            { bedrijf: 'Blocked Lead', telefoon: '+31610000000', status: 'klant' },
          ]),
        },
        source: 'supabase',
      };
    },
    premiumActiveOrdersScope: 'premium_active_orders',
    premiumActiveCustomOrdersKey: 'softora_custom_orders_premium_v1',
    getMissingEnvVars: () => [],
    processColdcallingLead: async (lead, campaign, index) => {
      processedIndexes.push(index);
      return {
        index,
        success: true,
        lead: { company: lead.company, phone: lead.phone },
        call: { callId: `call-${index}` },
      };
    },
    createSequentialDispatchQueue: () => ({ id: 'queue-1', leads: [], results: [] }),
    advanceSequentialDispatchQueue: async () => null,
    waitForQueuedRuntimeStatePersist: async () => null,
    sleep: async () => null,
  });

  const res = await callStart({});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.started, 1);
  assert.equal(res.body.summary.skipped, 1);
  assert.equal(res.body.summary.failed, 0);
  assert.equal(res.body.summary.attempted, 1);
  assert.deepEqual(processedIndexes, [1]);
  assert.equal(res.body.results[0].skipped, true);
  assert.equal(res.body.results[1].success, true);
  assert.equal(res.body.results[1].index, 1);
});

test('coldcalling start skips leads that already have an active order from akkoord/dossier', async () => {
  let processed = 0;
  const callStart = createRouteHarness({
    validateStartPayload: () => ({
      campaign: buildCampaign({ amount: 1 }),
      leads: [{ company: 'Softora', phone: '06 12 34 56 78' }],
    }),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    resolveColdcallingProviderForCampaign: () => 'retell',
    getUiStateValues: async (scope) => {
      if (scope === 'premium_active_orders') {
        return {
          values: {
            softora_custom_orders_premium_v1: JSON.stringify([
              {
                id: 7,
                companyName: 'Softora',
                contactPhone: '+31612345678',
                title: 'Website opdracht',
                description: 'Dossier aangemaakt na akkoord.',
                sourceAppointmentId: 42,
              },
            ]),
          },
          source: 'supabase',
        };
      }
      return { values: { softora_customers_premium_v1: '[]' }, source: 'supabase' };
    },
    premiumActiveOrdersScope: 'premium_active_orders',
    premiumActiveCustomOrdersKey: 'softora_custom_orders_premium_v1',
    getMissingEnvVars: () => [],
    processColdcallingLead: async () => {
      processed += 1;
      return { success: true };
    },
    createSequentialDispatchQueue: () => ({ id: 'queue-1', leads: [], results: [] }),
    advanceSequentialDispatchQueue: async () => null,
    waitForQueuedRuntimeStatePersist: async () => null,
    sleep: async () => null,
  });

  const res = await callStart({});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.started, 0);
  assert.equal(res.body.summary.skipped, 1);
  assert.equal(res.body.results[0].details.databaseStatus, 'klant');
  assert.equal(processed, 0);
});

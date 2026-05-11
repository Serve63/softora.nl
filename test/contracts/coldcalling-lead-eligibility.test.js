const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterColdcallingLeadsByDatabaseStatus,
  normalizeDatabaseContactStatus,
  parseCustomerDatabaseRowsFromUiState,
} = require('../../server/services/coldcalling-lead-eligibility');
const { buildRetellCostSummary, registerColdcallingRoutes } = require('../../server/routes/coldcalling');

function normalizeString(value) {
  return String(value || '').trim();
}

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
    { company: 'Active Campaign', phone: '06 5555 5555' },
  ];
  const databaseRows = [
    { bedrijf: 'Servé Creusen', telefoon: '+31629917185', status: 'interesse' },
    { bedrijf: 'Growingbyknowing', telefoon: '', databaseStatus: 'Afspraak' },
    { bedrijf: 'Open Prospect', telefoon: '+31622222222', status: 'Gemaild' },
    { bedrijf: 'Inactive Prospect', telefoon: '+31633333333', status: 'Benaderbaar', actief: 'Nee' },
    { bedrijf: 'Lost Prospect', telefoon: '+31644444444', databaseStatus: 'afgehaakt' },
    {
      bedrijf: 'Active Campaign',
      telefoon: '+31655555555',
      status: 'gemaild',
      activeColdmailCampaignUntil: '2999-01-01T00:00:00.000Z',
    },
  ];

  const result = filterColdcallingLeadsByDatabaseStatus(leads, databaseRows);

  assert.equal(result.allowed.length, 1);
  assert.equal(result.allowed[0].lead.company, 'Open Prospect');
  assert.equal(result.allowed[0].index, 2);
  assert.equal(result.skippedResults.length, 5);
  assert.deepEqual(
    result.skippedResults.map((item) => item.details.databaseStatus),
    ['interesse', 'afspraak', 'buiten', 'afgehaakt', 'mailcampagne']
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

test('coldcalling cost summary gebruikt Retell call_cost en schat alleen ontbrekende kosten', async () => {
  const listCallsOptions = [];
  const summary = await buildRetellCostSummary(
    {
      env: {},
      usdToEurRate: 0.9,
      normalizeString,
      listRetellCalls: async (options) => {
        listCallsOptions.push(options);
        return {
          data: {
            items: [
              {
                call_id: 'call-exact',
                call_type: 'phone_call',
                direction: 'outbound',
                call_status: 'ended',
                start_timestamp: Date.UTC(2026, 4, 3, 10, 0, 0),
                duration_ms: 60_000,
                metadata: { source: 'softora-coldcalling-dashboard' },
                call_cost: {
                  total_duration_seconds: 60,
                  total_duration_unit_price: 1,
                  product_costs: [{ product: 'elevenlabs_tts', cost: 60 }],
                  combined_cost: 70,
                },
              },
              {
                call_id: 'call-estimated',
                call_type: 'phone_call',
                direction: 'outbound',
                call_status: 'ended',
                start_timestamp: Date.UTC(2026, 4, 4, 10, 0, 0),
                duration_ms: 120_000,
                metadata: { source: 'softora-coldcalling-dashboard' },
              },
              {
                call_id: 'call-older',
                call_type: 'phone_call',
                direction: 'outbound',
                call_status: 'ended',
                start_timestamp: Date.UTC(2026, 3, 28, 10, 0, 0),
                duration_ms: 60_000,
                metadata: { source: 'softora-coldcalling-dashboard' },
                call_cost: { combined_cost: 500 },
              },
            ],
            has_more: false,
          },
        };
      },
      resolveRetellCallCostFields: (call) => {
        const combinedCost = Number(call?.call_cost?.combined_cost);
        const hasOfficialShape = Array.isArray(call?.call_cost?.product_costs);
        if (!Number.isFinite(combinedCost)) {
          return { costUsd: null, costUsdMilli: null };
        }
        const costUsdMilli = hasOfficialShape ? Math.round(combinedCost) : Math.round(combinedCost);
        return { costUsd: costUsdMilli / 1000, costUsdMilli };
      },
    },
    'month',
    { force: true, nowMs: Date.UTC(2026, 4, 15, 12, 0, 0), apiVersion: 'v3' }
  );

  assert.equal(listCallsOptions[0].apiVersion, 'v3');
  assert.equal(summary.source, 'retell');
  assert.equal(summary.exact, false);
  assert.equal(summary.callCount, 2);
  assert.equal(summary.exactCostCount, 1);
  assert.equal(summary.estimatedCostCount, 1);
  assert.equal(summary.costUsd, 0.21);
  assert.equal(summary.costEur, 0.19);
  assert.equal(summary.retellListApiVersion, 'v3');
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

test('coldcalling start test mode does not dispatch real provider calls', async () => {
  let processed = 0;
  let envChecked = false;
  let agendaChecked = false;
  const callStart = createRouteHarness({
    validateStartPayload: () => ({
      campaign: buildCampaign({ amount: 2, testMode: true }),
      leads: [
        { company: 'Test Lead 1', phone: '06 1111 1111' },
        { company: 'Test Lead 2', phone: '06 2222 2222' },
      ],
    }),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    getColdcallingAgendaCapacityNow: () => {
      agendaChecked = true;
      return new Date('2026-05-06T06:30:00.000Z');
    },
    resolveColdcallingProviderForCampaign: () => 'retell',
    getUiStateValues: async () => ({ values: { softora_customers_premium_v1: '[]' }, source: 'supabase' }),
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
  assert.equal(res.body.testMode, true);
  assert.equal(res.body.summary.started, 2);
  assert.equal(res.body.results[0].testMode, true);
  assert.equal(processed, 0);
  assert.equal(envChecked, false);
  assert.equal(agendaChecked, false);
});

test('coldcalling start blocks provider dispatch when the next 10 workdays are full', async () => {
  let processed = 0;
  let envChecked = false;
  let synced = false;
  const fullWorkdayDates = [
    '2026-05-06',
    '2026-05-07',
    '2026-05-08',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-18',
    '2026-05-19',
  ];
  const callStart = createRouteHarness({
    validateStartPayload: () => ({
      campaign: buildCampaign({ amount: 1 }),
      leads: [{ company: 'Open Lead', phone: '06 2000 0000' }],
    }),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    getColdcallingAgendaCapacityNow: () => new Date('2026-05-06T06:30:00.000Z'),
    isSupabaseConfigured: () => true,
    syncRuntimeStateFromSupabaseIfNewer: async (options) => {
      synced = true;
      assert.equal(options.maxAgeMs, 0);
    },
    generatedAgendaAppointments: fullWorkdayDates.map((date, id) => ({
      id,
      date,
      time: '09:00',
      manualAllDayUnavailable: true,
    })),
    isGeneratedAppointmentVisibleForAgenda: () => true,
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => null,
    resolveColdcallingProviderForCampaign: () => 'retell',
    getUiStateValues: async () => ({ values: { softora_customers_premium_v1: '[]' }, source: 'supabase' }),
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
    logger: { error: () => null },
  });

  const res = await callStart({});

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.agendaBlocked, true);
  assert.equal(res.body.reason, 'agenda_full_10_workdays');
  assert.equal(res.body.agendaCapacity.availableSlots, 0);
  assert.equal(synced, true);
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

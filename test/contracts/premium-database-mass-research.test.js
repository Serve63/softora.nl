const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  MASS_RESEARCH_JOBS_KEY,
  MASS_RESEARCH_SCOPE,
  collectCustomerIdentityKeys,
  createPremiumDatabaseMassResearchCoordinator,
  mapWithConcurrency,
} = require('../../server/services/premium-database-mass-research');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createUiStateRecorder() {
  const valuesByScope = {};
  const writes = [];
  return {
    writes,
    getUiStateValues: async (scope) => ({ values: { ...(valuesByScope[scope] || {}) } }),
    setUiStateValues: async (scope, patch, meta) => {
      writes.push({ scope, patch, meta });
      valuesByScope[scope] = { ...(valuesByScope[scope] || {}), ...(patch || {}) };
      return { ok: true, values: valuesByScope[scope] };
    },
  };
}

function createDataOpsRecorder(options = {}) {
  const existingCustomers = Array.isArray(options.existingCustomers)
    ? options.existingCustomers.map((customer) => ({ ...customer }))
    : [];
  const identityRows = Array.isArray(options.identityRows)
    ? options.identityRows.map((row) => ({ ...row }))
    : [];
  const recorder = {
    upsertCalls: [],
    identityUpsertCalls: [],
  };

  return {
    recorder,
    listCustomers: async () => existingCustomers.map((customer) => ({ ...customer })),
    listCustomerIdentityKeys: async (keys) => {
      const requested = new Set((keys || []).map((key) => `${key.type}:${key.value}`));
      return {
        ok: true,
        data: identityRows.filter((row) => requested.has(`${row.key_type}:${row.key_value}`)),
      };
    },
    upsertCustomers: async (rows, meta) => {
      recorder.upsertCalls.push({ rows: rows.map((row) => ({ ...row })), meta });
      rows.forEach((row) => {
        const index = existingCustomers.findIndex((customer) => customer.id === row.id);
        if (index === -1) existingCustomers.push({ ...row });
        else existingCustomers[index] = { ...existingCustomers[index], ...row };
      });
      return { ok: true, data: rows };
    },
    upsertCustomerIdentityKeys: async (entries, meta) => {
      recorder.identityUpsertCalls.push({ entries: entries.map((entry) => ({ ...entry })), meta });
      entries.forEach((entry) => {
        const index = identityRows.findIndex((row) => (
          row.key_type === entry.key_type && row.key_value === entry.key_value
        ));
        if (index === -1) identityRows.push({ ...entry });
        else identityRows[index] = { ...identityRows[index], ...entry };
      });
      return { ok: true, data: entries };
    },
  };
}

function makePlace(overrides = {}) {
  const name = overrides.name || 'Softora Testbedrijf';
  return {
    id: overrides.id || 'place-1',
    displayName: { text: name },
    formattedAddress: overrides.address || 'Kerkstraat 1, Oisterwijk',
    nationalPhoneNumber: overrides.phone || '+31 13 123 4567',
    websiteUri: Object.prototype.hasOwnProperty.call(overrides, 'websiteUri')
      ? overrides.websiteUri
      : 'https://softora.test',
    types: overrides.types || ['store'],
  };
}

async function runSingleBatch(options = {}) {
  const ui = createUiStateRecorder();
  const dataOps = createDataOpsRecorder(options.dataOps || {});
  const coordinator = createPremiumDatabaseMassResearchCoordinator({
    dataOpsStore: dataOps,
    getUiStateValues: ui.getUiStateValues,
    setUiStateValues: ui.setUiStateValues,
    fetchGooglePlacesBusinessesImpl: options.fetchGooglePlacesBusinessesImpl || (async () => [makePlace()]),
    discoverBusinessEmailFromWebsiteImpl: options.discoverBusinessEmailFromWebsiteImpl || (async () => 'info@softora.test'),
    fetchDeepSearchBusinessRowsImpl: options.fetchDeepSearchBusinessRowsImpl || (async () => ({ businesses: [] })),
    logger: { warn() {} },
  });
  const created = await coordinator.createJob({
    queries: ['webdesign Oisterwijk'],
    desiredCount: options.desiredCount || 10,
    enrichmentConcurrency: options.enrichmentConcurrency || 10,
    domainConcurrency: options.domainConcurrency || 2,
    openAiFallback: options.openAiFallback === true,
  });
  const result = await coordinator.runJob(created.id, { maxRunMs: 10000, maxTasks: 100 });
  return { coordinator, created, dataOps, result, ui };
}

test('mass research worker pool respects concurrency limit', async () => {
  let active = 0;
  let maxActive = 0;

  await mapWithConcurrency(Array.from({ length: 12 }), 3, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await wait(5);
    active -= 1;
  });

  assert.equal(maxActive, 3);
});

test('mass research routes are registered behind the premium admin api surface', () => {
  const featureRoutesSource = fs.readFileSync(
    path.join(__dirname, '../../server/services/feature-routes-runtime.js'),
    'utf8'
  );
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../../server/routes/premium-database-mass-research.js'),
    'utf8'
  );

  assert.match(featureRoutesSource, /registerPremiumDatabaseMassResearchRoutes\(app/);
  assert.match(featureRoutesSource, /createPremiumDatabaseMassResearchCoordinator\(\{[\s\S]*dataOpsStore: deps\.dataOpsStore/);
  assert.match(featureRoutesSource, /coordinator: premiumDatabaseMassResearchCoordinator/);
  assert.match(featureRoutesSource, /requirePremiumAdminApiAccess/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/mass-research-jobs'/);
  assert.match(routeSource, /app\.get\('\/api\/premium-database\/mass-research-jobs\/:jobId'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/mass-research-jobs\/:jobId\/run'/);
  assert.match(routeSource, /app\.post\('\/api\/premium-database\/mass-research-jobs\/:jobId\/cancel'/);
});

test('mass research stores progress in its own UI-state scope and writes only incoming customer upserts', async () => {
  const { dataOps, result, ui } = await runSingleBatch({
    fetchGooglePlacesBusinessesImpl: async () => [makePlace({ id: 'place-partial' })],
  });

  assert.equal(result.ok, true);
  assert.equal(dataOps.recorder.upsertCalls.length, 1);
  assert.equal(dataOps.recorder.upsertCalls[0].rows.length, 1);
  assert.equal(dataOps.recorder.upsertCalls[0].meta.source, 'premium-database-mass-research');
  assert.ok(ui.writes.every((write) => write.scope === MASS_RESEARCH_SCOPE));
  assert.ok(ui.writes.some((write) => Object.prototype.hasOwnProperty.call(write.patch, MASS_RESEARCH_JOBS_KEY)));
  assert.doesNotMatch(JSON.stringify(ui.writes), /softora_customers_database_v1/);
});

test('mass research duplicate resolver updates an existing customer by domain instead of inserting a new imported id', async () => {
  const { dataOps, result } = await runSingleBatch({
    dataOps: {
      existingCustomers: [
        {
          id: 'existing-customer',
          bedrijf: 'Softora Testbedrijf',
          naam: 'Softora Testbedrijf',
          website: 'softora.test',
          dom: 'softora.test',
          email: '—',
          stad: 'Kerkstraat 1, Oisterwijk',
          status: 'prospect',
          databaseStatus: 'prospect',
        },
      ],
    },
    fetchGooglePlacesBusinessesImpl: async () => [makePlace({ id: 'place-existing' })],
  });

  assert.equal(result.stats.inserted, 0);
  assert.equal(result.stats.updated, 1);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(dataOps.recorder.upsertCalls.length, 1);
  assert.equal(dataOps.recorder.upsertCalls[0].rows.length, 1);
  assert.equal(dataOps.recorder.upsertCalls[0].rows[0].id, 'existing-customer');
  assert.equal(dataOps.recorder.upsertCalls[0].rows[0].email, 'info@softora.test');
});

test('mass research parallel candidates with the same domain produce one customer write', async () => {
  const { dataOps, result } = await runSingleBatch({
    fetchGooglePlacesBusinessesImpl: async () => [
      makePlace({ id: 'place-1', name: 'Softora A', websiteUri: 'https://softora.test' }),
      makePlace({ id: 'place-2', name: 'Softora B', websiteUri: 'https://softora.test/contact' }),
    ],
  });

  assert.equal(result.stats.inserted, 1);
  assert.equal(result.stats.updated, 1);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(dataOps.recorder.upsertCalls.length, 1);
  assert.equal(dataOps.recorder.upsertCalls[0].rows.length, 1);
  assert.equal(dataOps.recorder.upsertCalls[0].rows[0].dom, 'softora.test');
});

test('mass research rechecks identity owners after preclaim so parallel jobs collapse to one customer id', async () => {
  const ui = createUiStateRecorder();
  const recorder = { upsertCalls: [], identityUpsertCalls: [] };
  let identityLookupCount = 0;
  const dataOpsStore = {
    listCustomers: async () => [],
    listCustomerIdentityKeys: async () => {
      identityLookupCount += 1;
      return identityLookupCount === 1
        ? { ok: true, data: [] }
        : {
          ok: true,
          data: [{ key_type: 'domain', key_value: 'softora.test', customer_id: 'claimed-by-other-worker' }],
        };
    },
    upsertCustomerIdentityKeys: async (entries, meta) => {
      recorder.identityUpsertCalls.push({ entries, meta });
      return { ok: true, data: [] };
    },
    upsertCustomers: async (rows, meta) => {
      recorder.upsertCalls.push({ rows, meta });
      return { ok: true, data: rows };
    },
  };
  const coordinator = createPremiumDatabaseMassResearchCoordinator({
    dataOpsStore,
    getUiStateValues: ui.getUiStateValues,
    setUiStateValues: ui.setUiStateValues,
    fetchGooglePlacesBusinessesImpl: async () => [makePlace({ id: 'place-race' })],
    discoverBusinessEmailFromWebsiteImpl: async () => 'info@softora.test',
    logger: { warn() {} },
  });

  const created = await coordinator.createJob({ queries: ['webdesign Tilburg'], desiredCount: 1 });
  const result = await coordinator.runJob(created.id, { maxRunMs: 10000, maxTasks: 10 });

  assert.equal(result.stats.inserted, 0);
  assert.equal(result.stats.updated, 1);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(identityLookupCount, 2);
  assert.equal(recorder.upsertCalls.length, 1);
  assert.equal(recorder.upsertCalls[0].rows[0].id, 'claimed-by-other-worker');
});

test('mass research OpenAI fallback is only used when fast enrichment has no usable email', async () => {
  let fallbackCalls = 0;
  const fastOnly = await runSingleBatch({
    openAiFallback: true,
    fetchGooglePlacesBusinessesImpl: async () => [makePlace({ id: 'place-fast' })],
    discoverBusinessEmailFromWebsiteImpl: async () => 'info@softora.test',
    fetchDeepSearchBusinessRowsImpl: async () => {
      fallbackCalls += 1;
      return { businesses: [] };
    },
  });
  assert.equal(fastOnly.result.stats.openAiFallbackCalls, 0);
  assert.equal(fallbackCalls, 0);

  const fallback = await runSingleBatch({
    openAiFallback: true,
    fetchGooglePlacesBusinessesImpl: async () => [makePlace({ id: 'place-fallback' })],
    discoverBusinessEmailFromWebsiteImpl: async () => '',
    fetchDeepSearchBusinessRowsImpl: async () => {
      fallbackCalls += 1;
      return { businesses: [{ email: 'fallback@softora.test', website: 'https://softora.test' }] };
    },
  });

  assert.equal(fallback.result.stats.openAiFallbackCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(fallback.dataOps.recorder.upsertCalls[0].rows[0].email, 'fallback@softora.test');
});

test('mass research cancel stops queued work and keeps saved results intact', async () => {
  const { coordinator, created, dataOps } = await runSingleBatch({
    fetchGooglePlacesBusinessesImpl: async () => [
      makePlace({ id: 'place-cancel-1', name: 'Cancel Een', websiteUri: 'https://cancel-one.test' }),
      makePlace({ id: 'place-cancel-2', name: 'Cancel Twee', websiteUri: 'https://cancel-two.test' }),
    ],
  });

  const beforeCancel = dataOps.recorder.upsertCalls[0].rows.length;
  const cancelled = await coordinator.cancelJob(created.id);
  const afterCancel = await coordinator.runJob(created.id, { maxRunMs: 10000, maxTasks: 100 });

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(afterCancel.status, 'cancelled');
  assert.equal(dataOps.recorder.upsertCalls[0].rows.length, beforeCancel);
});

test('mass research collects duplicate identity keys for google place, domain, email, phone and company address', () => {
  const keys = collectCustomerIdentityKeys({
    googlePlaceId: 'abc123',
    bedrijf: 'Café De Markt',
    stad: 'Markt 1, Tilburg',
    website: 'https://www.demarkt.example/contact',
    email: 'Info@DeMarkt.Example',
    tel: '+31 (0)13 123 4567',
  });

  assert.deepEqual(
    keys.map((key) => `${key.type}:${key.value}`),
    [
      'google_place_id:abc123',
      'domain:demarkt.example',
      'email:info@demarkt.example',
      'phone:310131234567',
      'company_address:cafe de markt|markt 1 tilburg',
    ]
  );
});

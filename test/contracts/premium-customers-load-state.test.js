const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadState = require('../../assets/premium-customers-load-state');

function createCoordinatorFixture(options = {}) {
  const state = {
    klanten: Array.isArray(options.customers) ? options.customers.slice() : [],
    orders: [],
    sharedCustomerRows: [],
    fullCustomerRowsLoaded: false,
    loadState: 'loading',
    loadPromise: null,
  };
  const failures = [];
  const statuses = [];
  const coordinator = loadState.createLoadCoordinator({
    state,
    customerScope: 'customers', customerKey: 'customer-key',
    orderScope: 'orders', orderKey: 'order-key',
    fetchCanonicalCustomers: options.fetchCanonicalCustomers || (async () => { throw new Error('canonical unavailable'); }),
    parseCanonicalCustomers: (rows) => Array.isArray(rows) ? rows : [],
    fetchUiState: options.fetchUiState,
    parseCustomerStorageRows: (raw) => JSON.parse(raw || '[]'),
    readChunkedStateValue: (values, key) => values[key] || '[]',
    parseCustomersFromRows: (rows) => rows.filter((row) => row.databaseStatus === 'klant'),
    parseOrders: (raw) => JSON.parse(raw || '[]'),
    deriveCustomersFromOrders: (orders) => orders.map((order) => ({ id: `order-${order.id}` })),
    mergeCustomersWithResponsible: (customers) => customers,
    customerListsDiffer: (customers) => JSON.stringify(customers) !== JSON.stringify(state.klanten),
    renderTable: options.renderTable || (() => {}), renderPage() {}, setRetryHidden() {},
    setStatusMessage: (...args) => statuses.push(args),
    setCustomerLoadFailure: (hasVisibleCustomers) => {
      state.loadState = 'error';
      failures.push(hasVisibleCustomers);
    },
    logError() {},
  });
  return { coordinator, failures, state, statuses };
}

test('klantenloader accepteert alleen een bewezen succesvolle UI-state response', () => {
  assert.equal(loadState.isValidUiStatePayload({ ok: true, values: {} }), true);
  assert.equal(loadState.isValidUiStatePayload({ ok: false, values: {} }), false);
  assert.equal(loadState.isValidUiStatePayload({ ok: true, values: [] }), false);
  assert.equal(loadState.isValidUiStatePayload({ ok: true }), false);
  assert.equal(loadState.isValidUiStatePayload(null), false);
});

test('klantenloader valideert de formele premium klantenresponse', async () => {
  const requests = [];
  const customers = await loadState.fetchCanonicalCustomers(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, customers: [{ id: 'client-1' }] }) };
  });
  assert.deepEqual(customers, [{ id: 'client-1' }]);
  assert.equal(requests[0].url, '/api/premium-database/customers?view=clients');
  assert.equal(requests[0].options.cache, 'no-store');
  await assert.rejects(
    () => loadState.fetchCanonicalCustomers(async () => ({ ok: true, json: async () => ({ ok: false }) })),
    /geen geldige dataset/
  );
});

test('klantenloader toont leeg uitsluitend na twee bewezen lege reads', () => {
  assert.equal(loadState.classifyLoadOutcome({
    canonicalReadSucceeded: true,
    canonicalCustomerCount: 0,
    customerReadSucceeded: true,
    orderReadSucceeded: true,
    remoteRowCount: 0,
    importedCustomerCount: 0,
    existingCustomerCount: 0,
  }), 'empty');
  assert.equal(loadState.shouldShowEmpty('ready', 0), true);

  for (const retryableFailure of ['timeout', '401', '403', '404', '500', 'malformed']) {
    assert.equal(loadState.classifyLoadOutcome({
      canonicalReadAttempted: true,
      canonicalReadSucceeded: false,
      customerReadSucceeded: false,
      orderReadSucceeded: retryableFailure === 'timeout',
      remoteRowCount: 0,
      importedCustomerCount: 0,
      existingCustomerCount: 0,
    }), 'error');
    assert.equal(loadState.shouldShowEmpty('error', 0), false);
  }
});

test('klantenloader bewaart bootstraprijen bij timeout en verkiest canonieke data bij herstel', () => {
  assert.equal(loadState.getInitialLoadState({ ok: true, completeDataset: false, customers: [{ id: 'klant-1' }] }), 'ready');
  assert.equal(loadState.getInitialLoadState({ ok: false, customers: [] }), 'loading');
  assert.equal(loadState.classifyLoadOutcome({
    customerReadSucceeded: false,
    orderReadSucceeded: true,
    existingCustomerCount: 2,
  }), 'retain');
  assert.equal(loadState.classifyLoadOutcome({
    customerReadSucceeded: true,
    orderReadSucceeded: false,
    remoteRowCount: 2,
    existingCustomerCount: 2,
  }), 'canonical');
  assert.equal(loadState.shouldShowEmpty('error', 2), false);
});

test('klantenloader houdt bestaande inhoud vast bij 503 en accepteert pas bewezen leegte', async () => {
  const failed = createCoordinatorFixture({
    customers: [{ id: 'bestaand-1' }, { id: 'bestaand-2' }],
    fetchUiState: async (scope) => {
      if (scope === 'customers') throw new Error('503');
      return { values: { 'order-key': '[]' } };
    },
  });
  assert.equal(await failed.coordinator.run(), 'retain');
  assert.deepEqual(failed.state.klanten.map((row) => row.id), ['bestaand-1', 'bestaand-2']);
  assert.deepEqual(failed.failures, [true]);

  const empty = createCoordinatorFixture({
    fetchCanonicalCustomers: async () => [],
    fetchUiState: async (scope) => ({
      values: scope === 'customers' ? { 'customer-key': '[]' } : { 'order-key': '[]' },
    }),
  });
  assert.equal(await empty.coordinator.run(), 'empty');
  assert.deepEqual(empty.state.klanten, []);
  assert.equal(empty.state.loadState, 'ready');
  assert.deepEqual(empty.failures, []);
});

test('klantenloader dedupliceert gelijktijdige retries', async () => {
  let releaseCustomerRead;
  let customerReads = 0;
  const fixture = createCoordinatorFixture({
    fetchCanonicalCustomers: async () => [],
    fetchUiState: (scope) => {
      if (scope === 'orders') return Promise.resolve({ values: { 'order-key': '[]' } });
      customerReads += 1;
      return new Promise((resolve) => { releaseCustomerRead = resolve; });
    },
  });
  const first = fixture.coordinator.run();
  const second = fixture.coordinator.run();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  releaseCustomerRead({ values: { 'customer-key': '[]' } });
  assert.equal(await first, 'empty');
  assert.equal(customerReads, 1);
});

test('klantenloader toont de laadstatus ook terwijl bootstraprijen zichtbaar zijn', async () => {
  let releaseCanonicalRead;
  const renderStates = [];
  const fixture = createCoordinatorFixture({
    customers: [{ id: 'bestaand-1' }],
    fetchCanonicalCustomers: () => new Promise((resolve) => { releaseCanonicalRead = resolve; }),
    renderTable: () => renderStates.push(fixture.state.loadState),
    fetchUiState: async (scope) => ({
      values: scope === 'customers'
        ? { 'customer-key': JSON.stringify([{ id: 'bestaand-1', databaseStatus: 'klant' }]) }
        : { 'order-key': '[]' },
    }),
  });

  const pending = fixture.coordinator.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.state.loadState, 'loading');
  assert.deepEqual(renderStates, ['loading']);
  releaseCanonicalRead([{ id: 'bestaand-1' }]);
  await pending;
  assert.equal(fixture.state.loadState, 'ready');
  assert.deepEqual(renderStates, ['loading', 'ready']);
});

test('klantenloader laat de formele klantentabel winnen van een lege legacy UI-state', async () => {
  const fixture = createCoordinatorFixture({
    fetchCanonicalCustomers: async () => [{ id: 'formeel-1' }, { id: 'formeel-2' }],
    fetchUiState: async (scope) => ({
      values: scope === 'customers' ? { 'customer-key': '[]' } : { 'order-key': '[]' },
    }),
  });
  assert.equal(await fixture.coordinator.run(), 'canonical');
  assert.deepEqual(fixture.state.klanten.map((row) => row.id), ['formeel-1', 'formeel-2']);
  assert.equal(fixture.state.loadState, 'ready');
  assert.equal(fixture.state.fullCustomerRowsLoaded, false);
  assert.deepEqual(fixture.failures, []);
});

test('lege legacy UI-state bewijst geen lege klantendatabase als de formele read faalt', async () => {
  const fixture = createCoordinatorFixture({
    fetchCanonicalCustomers: async () => { throw new Error('504'); },
    fetchUiState: async (scope) => ({
      values: scope === 'customers' ? { 'customer-key': '[]' } : { 'order-key': '[]' },
    }),
  });
  assert.equal(await fixture.coordinator.run(), 'error');
  assert.equal(fixture.state.loadState, 'error');
  assert.deepEqual(fixture.state.klanten, []);
  assert.deepEqual(fixture.failures, [false]);
});

test('klantenpagina heeft retry, single-flight en blokkeert writes zonder volledige dataset', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-klanten.html'), 'utf8');
  const loadSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-customers-load-state.js'), 'utf8');
  assert.match(source, /id="retryCustomersButton"[^>]*>Opnieuw proberen<\/button>/);
  assert.match(loadSource, /if \(state\.loadPromise\) return state\.loadPromise;/);
  assert.match(loadSource, /state\.fullCustomerRowsLoaded = remoteRows\.length > 0;/);
  assert.match(source, /customerLoadState\.fetchCanonicalCustomers\(window\.fetch\.bind\(window\)\)/);
  assert.match(loadSource, /fetchImpl\('\/api\/premium-database\/customers\?view=clients'/);
  assert.match(source, /if \(!state\.fullCustomerRowsLoaded\)/);
  assert.match(loadSource, /setCustomerLoadFailure\(true\)/);
  assert.match(source, /nodes\.empty\.hidden = !customerLoadState\.shouldShowEmpty/);
  assert.match(source, /id="customerLoadingOverlay"[\s\S]*Klantgegevens laden…/);
  assert.match(source, /document\.getElementById\("customerLoadingOverlay"\)\.hidden = !isLoading;/);
  assert.match(loadSource, /state\.loadState = 'loading';/);
  assert.doesNotMatch(source, /if \(!hadBootstrapCustomers\) \{ const shouldRerender = customerListsDiffer\(\[\]\)/);
});

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
    fetchUiState: options.fetchUiState,
    parseCustomerStorageRows: (raw) => JSON.parse(raw || '[]'),
    readChunkedStateValue: (values, key) => values[key] || '[]',
    parseCustomersFromRows: (rows) => rows.filter((row) => row.databaseStatus === 'klant'),
    parseOrders: (raw) => JSON.parse(raw || '[]'),
    deriveCustomersFromOrders: (orders) => orders.map((order) => ({ id: `order-${order.id}` })),
    mergeCustomersWithResponsible: (customers) => customers,
    customerListsDiffer: (customers) => JSON.stringify(customers) !== JSON.stringify(state.klanten),
    renderTable() {}, renderPage() {}, setRetryHidden() {},
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

test('klantenloader toont leeg uitsluitend na twee bewezen lege reads', () => {
  assert.equal(loadState.classifyLoadOutcome({
    customerReadSucceeded: true,
    orderReadSucceeded: true,
    remoteRowCount: 0,
    importedCustomerCount: 0,
    existingCustomerCount: 0,
  }), 'empty');
  assert.equal(loadState.shouldShowEmpty('ready', 0), true);

  for (const retryableFailure of ['timeout', '401', '403', '404', '500', 'malformed']) {
    assert.equal(loadState.classifyLoadOutcome({
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
    fetchUiState: (scope) => {
      if (scope === 'orders') return Promise.resolve({ values: { 'order-key': '[]' } });
      customerReads += 1;
      return new Promise((resolve) => { releaseCustomerRead = resolve; });
    },
  });
  const first = fixture.coordinator.run();
  const second = fixture.coordinator.run();
  assert.equal(first, second);
  releaseCustomerRead({ values: { 'customer-key': '[]' } });
  assert.equal(await first, 'empty');
  assert.equal(customerReads, 1);
});

test('klantenpagina heeft retry, single-flight en blokkeert writes zonder volledige dataset', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-klanten.html'), 'utf8');
  const loadSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-customers-load-state.js'), 'utf8');
  assert.match(source, /id="retryCustomersButton"[^>]*>Opnieuw proberen<\/button>/);
  assert.match(loadSource, /if \(state\.loadPromise\) return state\.loadPromise;/);
  assert.match(loadSource, /state\.fullCustomerRowsLoaded = true;/);
  assert.match(source, /if \(!state\.fullCustomerRowsLoaded\)/);
  assert.match(loadSource, /setCustomerLoadFailure\(true\)/);
  assert.match(source, /nodes\.empty\.hidden = !customerLoadState\.shouldShowEmpty/);
  assert.doesNotMatch(source, /if \(!hadBootstrapCustomers\) \{ const shouldRerender = customerListsDiffer\(\[\]\)/);
});

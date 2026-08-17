(function initPremiumCustomersLoadState(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SoftoraPremiumCustomersLoadState = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPremiumCustomersLoadState() {
  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function isValidUiStatePayload(payload) {
    return isObject(payload) && payload.ok === true && isObject(payload.values);
  }

  function getInitialLoadState(payload) {
    const customers = Array.isArray(payload && payload.customers) ? payload.customers : [];
    if (payload && payload.ok === true && (payload.completeDataset === true || customers.length > 0)) {
      return 'ready';
    }
    return 'loading';
  }

  function classifyLoadOutcome(input = {}) {
    const customerReadSucceeded = input.customerReadSucceeded === true;
    const orderReadSucceeded = input.orderReadSucceeded === true;
    const remoteRowCount = Math.max(0, Number(input.remoteRowCount) || 0);
    const importedCustomerCount = Math.max(0, Number(input.importedCustomerCount) || 0);
    const existingCustomerCount = Math.max(0, Number(input.existingCustomerCount) || 0);

    if (customerReadSucceeded && remoteRowCount > 0) return 'canonical';
    if (!customerReadSucceeded && existingCustomerCount > 0) return 'retain';
    if (orderReadSucceeded && importedCustomerCount > 0) return 'orders';
    if (customerReadSucceeded && orderReadSucceeded) return 'empty';
    return 'error';
  }

  function shouldShowEmpty(loadState, visibleCustomerCount) {
    return loadState === 'ready' && Math.max(0, Number(visibleCustomerCount) || 0) === 0;
  }

  function createLoadCoordinator(deps = {}) {
    const state = deps.state;
    const customerScope = deps.customerScope;
    const customerKey = deps.customerKey;
    const orderScope = deps.orderScope;
    const orderKey = deps.orderKey;

    async function bootstrap() {
      const hadBootstrapCustomers = state.klanten.length > 0;
      let customerReadSucceeded = false;
      let orderReadSucceeded = false;
      let remoteRows = [];
      let remoteCustomers = [];
      let orders = [];

      state.loadState = hadBootstrapCustomers ? 'ready' : 'loading';
      deps.setRetryHidden(true);
      deps.renderTable();
      if (!hadBootstrapCustomers) deps.setStatusMessage('Klantenbestand laden...', 'info');

      try {
        const remoteState = await deps.fetchUiState(customerScope);
        remoteRows = deps.parseCustomerStorageRows(
          deps.readChunkedStateValue(remoteState.values, customerKey)
        );
        remoteCustomers = deps.parseCustomersFromRows(remoteRows);
        state.sharedCustomerRows = remoteRows;
        state.fullCustomerRowsLoaded = true;
        customerReadSucceeded = true;
      } catch (error) {
        deps.logError('Klanten laden via Supabase mislukt:', error);
      }

      try {
        const orderState = await deps.fetchUiState(orderScope);
        orders = deps.parseOrders(orderState.values && orderState.values[orderKey]);
        state.orders = Array.isArray(orders) ? orders : [];
        orderReadSucceeded = true;
      } catch (error) {
        deps.logError('Actieve opdrachten voor klanten laden mislukt:', error);
      }

      const importedCustomers = orderReadSucceeded ? deps.deriveCustomersFromOrders(orders) : [];
      const loadOutcome = classifyLoadOutcome({
        customerReadSucceeded,
        orderReadSucceeded,
        remoteRowCount: remoteRows.length,
        importedCustomerCount: importedCustomers.length,
        existingCustomerCount: state.klanten.length,
      });

      if (loadOutcome === 'canonical') {
        const enrichedCustomers = orderReadSucceeded
          ? deps.mergeCustomersWithResponsible(remoteCustomers, orders)
          : remoteCustomers;
        const shouldRerender = deps.customerListsDiffer(enrichedCustomers);
        state.klanten = enrichedCustomers;
        state.loadState = orderReadSucceeded ? 'ready' : 'error';
        if (shouldRerender || !hadBootstrapCustomers) deps.renderPage();
        if (orderReadSucceeded) deps.setStatusMessage('');
        else deps.setCustomerLoadFailure(true);
        return loadOutcome;
      }

      if (loadOutcome === 'retain') {
        deps.setCustomerLoadFailure(true);
        return loadOutcome;
      }

      if (loadOutcome === 'orders') {
        state.sharedCustomerRows = importedCustomers;
        state.klanten = importedCustomers;
        state.loadState = customerReadSucceeded ? 'ready' : 'error';
        deps.renderPage();
        if (customerReadSucceeded) deps.setStatusMessage('');
        else deps.setCustomerLoadFailure(true);
        return loadOutcome;
      }

      if (loadOutcome === 'empty') {
        state.klanten = [];
        state.loadState = 'ready';
        deps.renderPage();
        deps.setStatusMessage('');
        return loadOutcome;
      }

      deps.setCustomerLoadFailure(false);
      return loadOutcome;
    }

    function run() {
      if (state.loadPromise) return state.loadPromise;
      state.loadPromise = bootstrap().finally(function clearLoadPromise() {
        state.loadPromise = null;
      });
      return state.loadPromise;
    }

    return { bootstrap, run };
  }

  return {
    classifyLoadOutcome,
    createLoadCoordinator,
    getInitialLoadState,
    isValidUiStatePayload,
    shouldShowEmpty,
  };
});

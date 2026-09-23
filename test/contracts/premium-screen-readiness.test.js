const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPremiumScreenReadiness } = require('../../assets/premium-screen-readiness');
const createDashboardRefresh = require('../../assets/premium-dashboard-refresh');
const createActiveOrdersBoot = require('../../assets/premium-active-orders-boot');

function createEnvironment(options = {}) {
  const emitted = [];
  const marks = [];
  const listeners = new Map();
  const actions = new Set(options.missingAction ? [] : (options.actions || ['#save', '#filter']));
  const document = {
    readyState: options.readyState || 'complete',
    documentElement: { dataset: {} },
    fonts: { ready: options.fontsReady || Promise.resolve() },
    querySelector(selector) { return actions.has(selector) ? {} : null; },
    dispatchEvent(event) { emitted.push(event); return true; },
  };
  const window = {
    document,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const performance = {
    now: () => 1450,
    mark: (name) => marks.push(name),
  };
  const readiness = createPremiumScreenReadiness({ window, document, performance, startedAt: 0 });
  return { readiness, document, window, emitted, marks, listeners };
}

function createImage({ complete = false, naturalWidth = 0 } = {}) {
  const listeners = new Map();
  return {
    src: '/assets/required.webp',
    currentSrc: '/assets/required.webp',
    complete,
    naturalWidth,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    async decode() {},
    listeners,
  };
}

const readyInput = (overrides = {}) => ({
  page: 'test-screen',
  requiredData: { customers: true, orders: true },
  requiredActions: ['#save', '#filter'],
  requiredImages: [],
  actionsBound: true,
  ...overrides,
});

test('a screen stays loading until every required read and action is ready', async () => {
  const env = createEnvironment();
  assert.equal(await env.readiness.markReady(readyInput({ requiredData: { customers: true, orders: false } })), false);
  assert.equal(await env.readiness.markReady(readyInput({ actionsBound: false })), false);
  assert.equal(env.readiness.getState().status, 'loading');
  assert.equal(env.document.documentElement.dataset.softoraScreenState, 'loading');
  assert.equal(env.emitted.length, 0);
});

test('a screen stays loading while a required image is decoding', async () => {
  const env = createEnvironment({ readyState: 'interactive' });
  const image = createImage();
  const pending = env.readiness.markReady(readyInput({ requiredImages: [image] }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(env.readiness.getState().status, 'loading');
  assert.equal(env.listeners.has('load'), true);
  env.document.readyState = 'complete';
  env.listeners.get('load')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(image.listeners.has('load'), true);
  image.complete = true;
  image.naturalWidth = 128;
  image.listeners.get('load')();

  assert.equal(await pending, true);
  assert.equal(env.readiness.getState().status, 'ready');
  assert.equal(env.document.documentElement.dataset.softoraScreenState, 'ready');
  assert.equal(env.document.documentElement.dataset.softoraScreenReadyMs, '1450');
  assert.deepEqual(env.marks, ['softora:screen-ready']);
  assert.deepEqual(env.emitted.map((event) => event.type), ['softora:screen-ready']);
  assert.equal(env.emitted[0].detail.elapsedMs, 1450);
});

test('a broken required image produces a degraded result, never a ready result', async () => {
  const env = createEnvironment();
  const image = createImage({ complete: true, naturalWidth: 0 });
  assert.equal(await env.readiness.markReady(readyInput({ requiredImages: [image] })), false);
  assert.equal(env.readiness.getState().status, 'degraded');
  assert.equal(env.document.documentElement.dataset.softoraScreenState, 'degraded');
  assert.match(env.readiness.getState().issue, /afbeelding/);
  assert.equal(env.marks.includes('softora:screen-ready'), false);
  assert.deepEqual(env.emitted.map((event) => event.type), ['softora:screen-degraded']);
});

test('a screen stays loading until the shared personnel shell finishes', async () => {
  const env = createEnvironment();
  let shellLoading = true;
  let notifyShellChange;
  env.document.documentElement.hasAttribute = (name) => name === 'data-personnel-loading' && shellLoading;
  env.window.MutationObserver = class MutationObserver {
    constructor(callback) { notifyShellChange = callback; }
    observe() {}
    disconnect() {}
  };

  const pending = env.readiness.markReady(readyInput());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.readiness.getState().status, 'loading');
  assert.equal(env.marks.length, 0);

  shellLoading = false;
  notifyShellChange();
  assert.equal(await pending, true);
  assert.equal(env.readiness.getState().status, 'ready');
});

test('missing page actions cannot pass the complete-screen contract', async () => {
  const env = createEnvironment({ missingAction: true });
  assert.equal(await env.readiness.markReady(readyInput()), false);
  assert.equal(env.readiness.getState().status, 'loading');
  assert.equal(env.emitted.length, 0);
});

test('Dashboard keeps its boot shell during recoverable partial data and releases after full readiness', async () => {
  const state = { customersHydrated: false, ordersHydrated: false };
  const timers = new Map();
  let nextTimerId = 1;
  let customerReads = 0;
  let orderReads = 0;
  let releases = 0;
  let degraded = 0;
  let unavailable = 0;
  let status = 'loading';
  const root = {
    Date,
    document: {
      hidden: false,
      querySelector() { return { querySelectorAll() { return []; } }; },
      addEventListener() {},
      removeEventListener() {},
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return nextTimerId++; },
    clearInterval() {},
    SoftoraScreenReadiness: {
      getState() { return { status }; },
      markDegraded() { degraded += 1; status = 'degraded'; return false; },
      async markReady(input) {
        assert.deepEqual(input.requiredData, { customers: true, activeOrders: true });
        status = 'ready';
        return true;
      },
    },
    SoftoraPremiumDashboardCore: { releasePremiumDashboardBootShell() { releases += 1; } },
  };
  const refresh = createDashboardRefresh({
    root,
    state,
    async loadOrders() { orderReads += 1; if (orderReads > 1) state.ordersHydrated = true; return orderReads > 1; },
    async loadCustomers() { customerReads += 1; if (customerReads > 1) state.customersHydrated = true; return customerReads > 1; },
    render() {},
    renderPending() {},
    showUnavailable() { unavailable += 1; },
  });

  assert.equal(await refresh.refresh(true, true), false);
  assert.equal(status, 'loading');
  assert.equal(degraded, 0);
  assert.equal(releases, 0);
  assert.equal(unavailable, 1);

  assert.equal(await refresh.refresh(true, true), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status, 'ready');
  assert.equal(degraded, 0);
  assert.equal(releases, 1);
  assert.equal(unavailable, 1);
  refresh.dispose();
});

test('Opdrachten keeps its boot shell until the readiness check settles', async () => {
  let status = 'loading';
  let releaseReadiness;
  let shellReleases = 0;
  const readinessTask = new Promise((resolve) => { releaseReadiness = resolve; });
  const root = {
    SoftoraScreenReadiness: { getState() { return { status }; } },
    SoftoraActiveOrdersReadiness: { publish() { return readinessTask; } },
    SoftoraPremiumBoot: { setShellBooting(isBooting) { if (isBooting === false) shellReleases += 1; } },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  };
  const boot = createActiveOrdersBoot(root);
  const pending = boot.releaseAfterMinimum(0, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shellReleases, 0);

  status = 'ready';
  releaseReadiness(true);
  await pending;
  assert.equal(shellReleases, 1);
});

test('Dashboard and Opdrachten load readiness checks before releasing their boot shells', () => {
  const root = path.resolve(__dirname, '../..');
  const helper = fs.readFileSync(path.join(root, 'assets/premium-screen-readiness.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'premium-personeel-dashboard.html'), 'utf8');
  const dashboardRefresh = fs.readFileSync(path.join(root, 'assets/premium-dashboard-refresh.js'), 'utf8');
  const dashboardCore = fs.readFileSync(path.join(root, 'assets/premium-dashboard-core.js'), 'utf8');
  const ordersPage = fs.readFileSync(path.join(root, 'premium-actieve-opdrachten.html'), 'utf8');
  const ordersBoot = fs.readFileSync(path.join(root, 'assets/premium-active-orders-boot.js'), 'utf8');
  const ordersReadiness = fs.readFileSync(path.join(root, 'assets/premium-active-orders-readiness.js'), 'utf8');
  const orders = fs.readFileSync(path.join(root, 'assets/premium-actieve-opdrachten.js'), 'utf8');
  const guardrails = fs.readFileSync(path.join(root, 'test/contracts/agent-guardrails.test.js'), 'utf8');

  assert.match(helper, /performanceApi\.mark\('softora:screen-ready'\)/);
  assert.match(helper, /waitForDocumentLoad\(win, doc\)/);
  assert.match(dashboard, /premium-screen-readiness\.js\?v=20260922a/);
  assert.match(dashboardRefresh, /customers: state\.customersHydrated,[\s\S]*activeOrders: state\.ordersHydrated/);
  assert.match(dashboardRefresh, /if \(!complete\) \{\s*\/\/ Keep the boot shell up while recovery reads are still running\.\s*return false;/);
  assert.match(dashboardRefresh, /if \(!results\[0\] && results\[1\]\) showUnavailable\(\)/);
  assert.match(guardrails, /premium-screen-readiness\.test\.js/);
  assert.match(dashboardRefresh, /requiredActions: \['#dashboardAiChatToggle', '#aiManagementConfigSave'\]/);
  assert.match(dashboard, /id="dashboardAiChatToggle"/);
  assert.match(dashboard, /id="aiManagementConfigSave"/);
  assert.match(dashboardCore, /if \(!isPremiumDashboardScreenReadyForRelease\(\)\) return false;/);
  assert.match(ordersPage, /premium-screen-readiness\.js\?v=20260922a/);
  assert.match(ordersPage, /premium-active-orders-readiness\.js\?v=20260922a/);
  assert.match(orders, /remoteUiStateLoaded === true\);/);
  assert.match(ordersBoot, /readiness\.publish\(\{ dataComplete: dataComplete === true \}\)/);
  assert.match(ordersReadiness, /await readiness\.markReady\(/);
  assert.match(ordersReadiness, /requiredActions: \['#createOrderBtn', '#onlyMyAssignmentsToggle', '\.orders-filter-bar', '#ordersGrid'\]/);
  assert.match(ordersBoot, /readiness\.status === 'loading'\) return false/);
});

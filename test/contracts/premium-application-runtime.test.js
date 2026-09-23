const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumApplicationRuntime } = require('../../assets/premium-application-runtime');

function createHarness({ modules, dataClient, session = { authenticated: true, scope: 'serve', role: 'admin' }, onSessionChange, onError } = {}) {
  const log = [];
  const visible = { root: null };
  let currentSession = session;
  const runtime = createPremiumApplicationRuntime({
    modules,
    dataClient: { clearSession: async () => {}, ...(dataClient || {}) },
    getSession: () => currentSession,
    onSessionChange,
    onError,
    host: {
      create: async ({ moduleId, route }) => {
        const root = { moduleId, route, mounted: false };
        log.push(`create:${moduleId}`);
        return root;
      },
      activate: async (root, details) => {
        root.mounted = true;
        visible.root = root;
        log.push(`activate:${details.moduleId}`);
      },
      remove: async (root) => {
        if (visible.root === root) visible.root = null;
        log.push(`remove:${root.moduleId}`);
      },
      clear: async () => {
        visible.root = null;
        log.push('clear');
      },
    },
  });
  return { runtime, log, visible, setSession: (value) => { currentSession = value; } };
}

function moduleDefinition(id, overrides = {}) {
  return {
    reads: [],
    prepareBudget: { maxReads: 0, maxBytes: 0, maxMs: 500 },
    prepare: async () => ({ id }),
    mount: async ({ root }) => { root.mounted = true; },
    update: async ({ root, route }) => { root.route = route; },
    dispose: async () => {},
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('application runtime validates lifecycle methods and bounded prepare budgets at registration', () => {
  assert.throws(() => createHarness({ modules: { bad: { ...moduleDefinition('bad'), update: null } } }), /bad: module mist update\(\)/);
  assert.throws(() => createHarness({ modules: { bad: moduleDefinition('bad', { prepareBudget: { maxReads: 1 } }) } }), /maxReads, maxBytes en maxMs/);
});

test('prepare can use only registered reads and failed preparation keeps the current module visible', async () => {
  const errors = [];
  const modules = {
    dashboard: moduleDefinition('dashboard'),
    orders: moduleDefinition('orders', {
      reads: ['orders.list'],
      prepareBudget: { maxReads: 1, maxBytes: 100, maxMs: 500 },
      prepare: ({ read }) => read('customers.list'),
    }),
  };
  const harness = createHarness({ modules, dataClient: { read: async () => [] }, onError: (event) => errors.push(event) });
  assert.equal((await harness.runtime.navigate('dashboard')).status, 'mounted');
  const dashboardRoot = harness.visible.root;
  assert.equal((await harness.runtime.navigate('orders')).status, 'error');
  assert.equal(harness.visible.root, dashboardRoot);
  assert.equal(harness.runtime.getState().activeModuleId, 'dashboard');
  assert.equal(errors[0].stage, 'prepare');
  assert.match(errors[0].error.message, /staat niet geregistreerd/);
});

test('stale preparation is aborted and cannot mount over a newer navigation', async () => {
  const pending = deferred();
  let slowSignal;
  const modules = {
    slow: moduleDefinition('slow', { prepare: ({ signal }) => { slowSignal = signal; return pending.promise; } }),
    fast: moduleDefinition('fast'),
  };
  const harness = createHarness({ modules });
  const slowNavigation = harness.runtime.navigate('slow');
  await Promise.resolve();
  const fastResult = await harness.runtime.navigate('fast');
  const slowResult = await slowNavigation;
  pending.resolve({ done: true });
  assert.equal(fastResult.status, 'mounted');
  assert.equal(slowResult.status, 'superseded');
  assert.equal(slowSignal.aborted, true);
  assert.equal(harness.visible.root.moduleId, 'fast');
  assert.deepEqual(harness.log.filter((entry) => entry.startsWith('activate:')), ['activate:fast']);
});

test('a superseded module mount is aborted and never replaces the newer view', async () => {
  const mountStarted = deferred();
  const mountPending = deferred();
  let mountSignal;
  const modules = {
    slow: moduleDefinition('slow', {
      mount: ({ signal }) => { mountSignal = signal; mountStarted.resolve(); return mountPending.promise; },
    }),
    fast: moduleDefinition('fast'),
  };
  const harness = createHarness({ modules });
  const slowNavigation = harness.runtime.navigate('slow');
  await mountStarted.promise;
  const fastResult = await harness.runtime.navigate('fast');
  mountPending.resolve();
  assert.equal(await slowNavigation.then((result) => result.status), 'superseded');
  assert.equal(fastResult.status, 'mounted');
  assert.equal(mountSignal.aborted, true);
  assert.equal(harness.visible.root.moduleId, 'fast');
  assert.deepEqual(harness.log.filter((entry) => entry.startsWith('activate:')), ['activate:fast']);
});

test('same-module navigation updates in place and dirty modules can block leaving', async () => {
  let allowLeave = true;
  const modules = {
    dashboard: moduleDefinition('dashboard', { canLeave: async () => allowLeave }),
    orders: moduleDefinition('orders'),
  };
  const harness = createHarness({ modules });
  assert.equal((await harness.runtime.navigate('dashboard', { path: '/dashboard' })).status, 'mounted');
  const root = harness.visible.root;
  assert.equal((await harness.runtime.navigate('dashboard', { path: '/dashboard?tab=agenda' })).status, 'updated');
  assert.equal(harness.visible.root, root);
  assert.deepEqual(root.route, { path: '/dashboard?tab=agenda' });
  allowLeave = false;
  assert.equal((await harness.runtime.navigate('orders')).status, 'blocked');
  assert.equal(harness.runtime.getState().activeModuleId, 'dashboard');
  assert.ok(!harness.log.includes('create:orders'));
});

test('session changes clear the shell and session-scoped data before mounting the next view', async () => {
  const events = [];
  const harness = createHarness({
    modules: { dashboard: moduleDefinition('dashboard') },
    dataClient: { clearSession: async (previous, next) => events.push(`cache:${previous}->${next}`) },
    onSessionChange: async ({ previous, current }) => events.push(`session:${previous.scope}->${current.scope}`),
  });
  assert.equal((await harness.runtime.navigate('dashboard')).status, 'mounted');
  harness.setSession({ authenticated: true, scope: 'other-user', role: 'admin', generation: '2' });
  assert.equal((await harness.runtime.navigate('dashboard')).status, 'mounted');
  assert.ok(harness.log.indexOf('clear') < harness.log.lastIndexOf('create:dashboard'));
  assert.deepEqual(events, [
    `cache:${JSON.stringify([true, 'serve', 'admin', ''])}->${JSON.stringify([true, 'other-user', 'admin', '2'])}`,
    'session:serve->other-user',
  ]);
  assert.equal(harness.runtime.getState().sessionKey, JSON.stringify([true, 'other-user', 'admin', '2']));
});

test('a failed session reset fails closed and does not mount another screen', async () => {
  const harness = createHarness({
    modules: { dashboard: moduleDefinition('dashboard') },
    onSessionChange: async () => { throw new Error('session reset failed'); },
  });
  assert.equal((await harness.runtime.navigate('dashboard')).status, 'mounted');
  harness.setSession({ authenticated: true, scope: 'other-user', role: 'admin' });
  const result = await harness.runtime.navigate('dashboard');
  assert.equal(result.status, 'error');
  assert.equal(harness.visible.root, null);
  assert.equal(harness.log.filter((entry) => entry === 'create:dashboard').length, 1);
  assert.match(result.error.message, /session reset failed/);
});

test('read budget limits payload bytes and authenticated access', async () => {
  let readCalls = 0;
  const modules = {
    dashboard: moduleDefinition('dashboard', {
      reads: ['dashboard.summary'],
      prepareBudget: { maxReads: 1, maxBytes: 4, maxMs: 500 },
      prepare: async ({ read }) => ({ summary: await read('dashboard.summary') }),
    }),
  };
  const harness = createHarness({
    modules,
    dataClient: { read: async (_key, _params, options) => { readCalls += 1; assert.equal(options.sessionKey, JSON.stringify([true, 'serve', 'admin', ''])); return { count: 1 }; } },
  });
  assert.equal((await harness.runtime.navigate('dashboard')).status, 'error');
  assert.equal(readCalls, 1);

  const anonymous = createHarness({ modules, session: { authenticated: false } });
  assert.equal((await anonymous.runtime.navigate('dashboard')).status, 'unauthenticated');
  assert.deepEqual(anonymous.log, []);
});

test('mount failure removes the staged root and preserves the previous active module', async () => {
  const modules = {
    dashboard: moduleDefinition('dashboard'),
    orders: moduleDefinition('orders', { mount: async () => { throw new Error('mount failed'); } }),
  };
  const harness = createHarness({ modules });
  assert.equal((await harness.runtime.navigate('dashboard')).status, 'mounted');
  const dashboardRoot = harness.visible.root;
  assert.equal((await harness.runtime.navigate('orders')).status, 'error');
  assert.equal(harness.visible.root, dashboardRoot);
  assert.ok(harness.log.includes('remove:orders'));
  assert.equal(harness.runtime.getState().activeModuleId, 'dashboard');
});

test('dispose aborts the mounted module lifetime and clears the shell', async () => {
  let lifecycleSignal;
  const modules = { dashboard: moduleDefinition('dashboard', { mount: async ({ signal }) => { lifecycleSignal = signal; } }) };
  const harness = createHarness({ modules });
  await harness.runtime.navigate('dashboard');
  await harness.runtime.dispose();
  assert.equal(lifecycleSignal.aborted, true);
  assert.equal(harness.runtime.getState().disposed, true);
  assert.equal(harness.runtime.getState().activeModuleId, '');
  assert.equal(harness.log.at(-1), 'remove:dashboard');
});

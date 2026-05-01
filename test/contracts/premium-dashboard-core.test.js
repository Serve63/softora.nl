const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardCore = require('../../assets/premium-dashboard-core');

test('premium dashboard core exposes stable pure helpers', () => {
  assert.equal(Object.isFrozen(dashboardCore), true);
  assert.equal(dashboardCore.escapeHtml('<span title="x">&'), '&lt;span title=&quot;x&quot;&gt;&amp;');
  assert.equal(dashboardCore.normalizeDashboardString('  Softora  '), 'Softora');
  assert.equal(dashboardCore.normalizeDashboardTime('09:30'), '09:30');
  assert.equal(dashboardCore.normalizeDashboardTime('', '08:00'), '08:00');
  assert.equal(dashboardCore.normalizeDashboardDate('2026-04-28'), '2026-04-28');
  assert.equal(typeof dashboardCore.fetchPremiumDashboardJson, 'function');
  assert.equal(typeof dashboardCore.forcePremiumDashboardBootShellVisible, 'function');
  assert.equal(typeof dashboardCore.releasePremiumDashboardBootShell, 'function');
  assert.equal(typeof dashboardCore.showPremiumDashboardBootShellForMinimum, 'function');
  assert.equal(typeof dashboardCore.hydratePremiumDashboardOrdersFromBootstrap, 'function');
  assert.equal(typeof dashboardCore.startPremiumDashboardBootWatchdog, 'function');
});

test('premium dashboard core reads chunked customer state values safely', () => {
  const values = {
    softora_customers_premium_v1_chunks_v1: JSON.stringify({ count: 2 }),
    softora_customers_premium_v1_chunk_0: '[{"naam":"Sof',
    softora_customers_premium_v1_chunk_1: 'tora"}]',
  };

  assert.equal(
    dashboardCore.readPremiumDashboardChunkedStateValue(values, 'softora_customers_premium_v1'),
    '[{"naam":"Softora"}]'
  );

  assert.equal(
    dashboardCore.readPremiumDashboardChunkedStateValue(
      { softora_customers_premium_v1: 'fallback' },
      'softora_customers_premium_v1'
    ),
    'fallback'
  );
});

test('premium dashboard core formats money and project metadata', () => {
  assert.equal(dashboardCore.formatMoneyEUR(1250), '\u20ac1.250');
  assert.equal(
    dashboardCore.formatProjectMeta({
      location: 'Amsterdam',
      amount: 1250,
      ui: { isBuilt: true, isPaid: false },
    }),
    'Amsterdam \u2022 \u20ac1.250 \u2022 wacht op betaling'
  );
});

test('premium dashboard core hydrates active orders from server bootstrap values', () => {
  const state = { orders: [], ordersHydrated: false };
  const payload = {
    activeOrdersState: {
      values: {
        softora_custom_orders_premium_v1: JSON.stringify([{ id: 11, title: 'Website opdracht' }]),
      },
    },
  };

  const hydrated = dashboardCore.hydratePremiumDashboardOrdersFromBootstrap(state, (values) => {
    return JSON.parse(values.softora_custom_orders_premium_v1 || '[]');
  }, payload);

  assert.equal(hydrated, true);
  assert.equal(state.ordersHydrated, true);
  assert.equal(state.orders[0].id, 11);
});

test('premium dashboard core can force-release the boot shell without theme helpers', () => {
  const makeClassList = (initial = []) => {
    const values = new Set(initial);
    return {
      add: (name) => values.add(name),
      remove: (name) => values.delete(name),
      has: (name) => values.has(name),
    };
  };
  const loader = {
    classList: makeClassList(),
    style: {},
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  const shell = {
    classList: makeClassList(['is-booting']),
    style: {},
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  const oldDocument = global.document;
  const root = {
    removed: [],
    removeAttribute(name) {
      this.removed.push(name);
    },
  };
  global.document = {
    documentElement: root,
    querySelector(selector) {
      if (selector !== 'main.is-premium-boot-host') return null;
      return {
        querySelector(innerSelector) {
          if (innerSelector === '.premium-boot-loader') return loader;
          if (innerSelector === '.premium-boot-shell') return shell;
          return null;
        },
      };
    },
  };

  try {
    dashboardCore.forcePremiumDashboardBootShellVisible();
  } finally {
    global.document = oldDocument;
  }

  assert.equal(loader.classList.has('is-hidden'), true);
  assert.equal(loader.attrs['aria-hidden'], 'true');
  assert.equal(loader.style.visibility, 'hidden');
  assert.deepEqual(root.removed, ['data-dashboard-boot-loading']);
  assert.equal(shell.classList.has('is-booting'), false);
  assert.equal(shell.attrs['aria-busy'], 'false');
});

test('premium dashboard core waits for a real paint before releasing the boot shell minimum', async () => {
  const makeClassList = (initial = []) => {
    const values = new Set(initial);
    return {
      add: (name) => values.add(name),
      remove: (name) => values.delete(name),
      has: (name) => values.has(name),
    };
  };
  const loader = {
    classList: makeClassList(),
    style: {},
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  const shell = {
    classList: makeClassList(['is-booting']),
    style: {},
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  const oldDocument = global.document;
  const oldRequestAnimationFrame = global.requestAnimationFrame;
  const oldSetTimeout = global.setTimeout;
  const oldClearTimeout = global.clearTimeout;
  const rafQueue = [];
  const timeoutQueue = [];

  global.document = {
    querySelector(selector) {
      if (selector !== 'main.is-premium-boot-host') return null;
      return {
        querySelector(innerSelector) {
          if (innerSelector === '.premium-boot-loader') return loader;
          if (innerSelector === '.premium-boot-shell') return shell;
          return null;
        },
      };
    },
  };
  global.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  };
  global.setTimeout = (callback, ms) => {
    timeoutQueue.push({ callback, ms });
    return timeoutQueue.length;
  };
  global.clearTimeout = () => {};

  try {
    dashboardCore.releasePremiumDashboardBootShellAfterMinimum(Date.now() - 5000, 650);
    assert.equal(loader.classList.has('is-hidden'), false);
    assert.equal(rafQueue.length, 1);

    rafQueue.shift()();
    assert.equal(loader.classList.has('is-hidden'), false);
    assert.equal(rafQueue.length, 1);

    rafQueue.shift()();
    await Promise.resolve();
    assert.equal(loader.classList.has('is-hidden'), false);
    assert.equal(timeoutQueue.length, 1);
    assert.ok(timeoutQueue[0].ms > 0);
    assert.ok(timeoutQueue[0].ms <= 650);

    timeoutQueue[0].callback();
    assert.equal(loader.classList.has('is-hidden'), true);
    assert.equal(shell.classList.has('is-booting'), false);
  } finally {
    global.document = oldDocument;
    global.requestAnimationFrame = oldRequestAnimationFrame;
    global.setTimeout = oldSetTimeout;
    global.clearTimeout = oldClearTimeout;
  }
});

test('premium dashboard core can re-show the boot shell after browser restore', () => {
  const oldDocument = global.document;
  const oldSetTimeout = global.setTimeout;
  const oldClearTimeout = global.clearTimeout;
  const attrs = {};
  const removed = [];
  let scheduled = null;

  global.document = {
    documentElement: {
      setAttribute(name, value) {
        attrs[name] = value;
      },
      removeAttribute(name) {
        removed.push(name);
        delete attrs[name];
      },
    },
    querySelector() {
      return null;
    },
  };
  global.setTimeout = (callback, delay) => {
    scheduled = { callback, delay };
    return 7;
  };
  global.clearTimeout = () => {};

  try {
    dashboardCore.showPremiumDashboardBootShellForMinimum(900);
    assert.equal(attrs['data-dashboard-boot-loading'], 'true');
    assert.equal(scheduled.delay, 900);
    scheduled.callback();
    assert.ok(removed.includes('data-dashboard-boot-loading'));
  } finally {
    global.document = oldDocument;
    global.setTimeout = oldSetTimeout;
    global.clearTimeout = oldClearTimeout;
  }
});

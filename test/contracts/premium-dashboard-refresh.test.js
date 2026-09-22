const test = require('node:test');
const assert = require('node:assert/strict');
const createRefresh = require('../../assets/premium-dashboard-refresh');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(overrides = {}) {
    const listeners = new Map(), timers = new Map(), intervals = new Map();
    let next = 0;
    const target = prefix => ({
        addEventListener: (name, fn) => listeners.set(prefix + name, fn),
        removeEventListener: name => listeners.delete(prefix + name),
    });
    const root = {
        ...target('window:'), Date,
        document: { hidden: false, ...target('document:') },
        setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id),
        setInterval: (fn, ms) => { const id = ++next; intervals.set(id, { fn, ms }); return id; },
        clearInterval: id => intervals.delete(id),
    };
    const state = { ordersHydrated: false, customersHydrated: false };
    const events = [];
    const deps = { root, state, render: () => events.push('render'), renderPending: () => events.push('partial'), showUnavailable: () => events.push('unavailable'), ...overrides };
    const controller = createRefresh(deps);
    return { controller, root, state, events, listeners, timers, intervals };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('fast customers do not finish a dashboard refresh while orders are still loading', async () => {
    const orders = deferred(), customers = deferred();
    const env = setup({
        loadOrders: async current => { await orders.promise; if (!current()) return false; env.state.ordersHydrated = true; return true; },
        loadCustomers: async current => { await customers.promise; if (!current()) return false; env.state.customersHydrated = true; return true; },
    });
    let completed = false;
    const refresh = env.controller.refresh(true);
    refresh.then(() => { completed = true; });
    assert.equal(env.controller.refresh(true), refresh);
    customers.resolve();
    await flush();
    assert.equal(completed, false);
    assert.deepEqual(env.events, ['render']);
    orders.resolve();
    assert.equal(await refresh, true);
    assert.deepEqual(env.events, ['render', 'render']);
});

test('fast orders can render a partial view without falsely completing', async () => {
    const customers = deferred();
    const env = setup({
        loadOrders: async () => { env.state.ordersHydrated = true; return true; },
        loadCustomers: async () => { await customers.promise; env.state.customersHydrated = true; return true; },
    });
    const refresh = env.controller.refresh(true);
    await flush();
    assert.deepEqual(env.events, ['partial']);
    customers.resolve();
    assert.equal(await refresh, true);
});

test('a failed refresh retries the failed read even when older data is hydrated', async () => {
    let calls = 0;
    const env = setup({
        loadOrders: async () => { calls++; return calls > 1; },
        loadCustomers: async () => true,
    });
    env.state.ordersHydrated = true;
    env.state.customersHydrated = true;
    assert.equal(await env.controller.refresh(true), false);
    assert.equal(env.timers.size, 1);
    const [id, timer] = [...env.timers][0];
    env.timers.delete(id);
    assert.equal(timer.ms, 1500);
    timer.fn();
    await flush();
    assert.equal(calls, 2);
    assert.equal(env.timers.size, 0);
});

test('dispose removes listeners and timers and rejects late rendering', async () => {
    const read = deferred();
    let accepted = false;
    const env = setup({
        loadOrders: async current => { await read.promise; if (!current()) return false; accepted = true; return true; },
        loadCustomers: async current => { await read.promise; return current(); },
    });
    env.controller.mount();
    env.controller.mount();
    assert.equal(env.intervals.size, 1);
    assert.equal(env.listeners.size, 3);
    const refresh = env.controller.refresh(true);
    await flush();
    env.controller.dispose();
    read.resolve();
    assert.equal(await refresh, false);
    assert.equal(accepted, false);
    assert.deepEqual(env.events, []);
    assert.equal(env.timers.size + env.intervals.size + env.listeners.size, 0);
    assert.equal(await env.controller.refresh(true), false);
});

test('hidden tabs do not poll; mounting again restores exactly one lifecycle', async () => {
    let calls = 0;
    const env = setup({ loadOrders: async () => { calls++; return true; }, loadCustomers: async () => true });
    env.state.ordersHydrated = env.state.customersHydrated = true;
    env.controller.mount();
    env.root.document.hidden = true;
    [...env.intervals.values()][0].fn();
    await flush();
    assert.equal(calls, 0);
    env.controller.dispose();
    env.controller.mount();
    env.root.document.hidden = false;
    [...env.intervals.values()][0].fn();
    await flush();
    assert.equal(calls, 1);
    assert.equal(env.intervals.size, 1);
    assert.equal(env.listeners.size, 3);
});

test('recovery is bounded and stops when disposed', async () => {
    let calls = 0;
    const env = setup({ loadOrders: async () => { calls++; return false; }, loadCustomers: async () => false });
    await env.controller.refresh(true);
    const seen = [];
    while (env.timers.size) {
        const [id, timer] = [...env.timers][0];
        env.timers.delete(id);
        seen.push(timer.ms);
        timer.fn();
        await flush();
    }
    assert.deepEqual(seen, [1500, 4000, 9000, 15000]);
    assert.equal(calls, 5);
    env.controller.dispose();
    assert.equal(env.timers.size, 0);
});

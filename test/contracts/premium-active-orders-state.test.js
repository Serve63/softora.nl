const test = require('node:test');
const assert = require('node:assert/strict');
const createClient = require('../../assets/premium-ui-state-client');
const createBoot = require('../../assets/premium-active-orders-boot');
const key = 'softora_custom_orders_premium_v1';
const scope = 'premium_active_orders';
const snapshot = (orders = []) => ({ ok: true, source: 'supabase', values: { [key]: JSON.stringify(orders) } });
const response = (data) => ({ ok: true, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(fetch) {
    const root = { fetch, Date, setTimeout, clearTimeout, AbortController };
    const client = createClient(root);
    return { root, client, boot: createBoot(root) };
}

test('orders page and editor share one read and wait for a completed write', async () => {
    const read = deferred(), write = deferred();
    const calls = [];
    const { boot } = setup(async (url, options) => {
        calls.push(options.method);
        if (options.method === 'POST') return write.promise;
        if (calls.length === 1) return read.promise;
        return response(snapshot([{ id: 2 }]));
    });
    const pageRead = boot.getState(scope);
    const editorRead = boot.getState(scope);
    assert.deepEqual(calls, ['GET']);
    const saving = boot.setState(scope, { patch: { [key]: '[{"id":2}]' } });
    read.resolve(response(snapshot([{ id: 1 }])));
    await Promise.resolve();
    assert.deepEqual(calls, ['GET', 'POST']);
    write.resolve(response({ ok: true }));
    await saving;
    assert.deepEqual(await pageRead, snapshot([{ id: 2 }]));
    assert.deepEqual(await editorRead, snapshot([{ id: 2 }]));
    assert.deepEqual(calls, ['GET', 'POST', 'GET']);
});

test('an explicit forced refresh bypasses completed cache', async () => {
    let count = 0;
    const { boot } = setup(async () => response(snapshot([{ id: ++count }])));
    assert.equal(JSON.parse((await boot.getState(scope)).values[key])[0].id, 1);
    assert.equal(JSON.parse((await boot.getState(scope)).values[key])[0].id, 1);
    assert.equal(JSON.parse((await boot.getState(scope, { force: true })).values[key])[0].id, 2);
});

test('invalid read and unsuccessful write are failures, not successful empty state', async () => {
    for (const data of [{ ok: false }, { ok: true }, { ok: true, values: [] }, {}]) {
        const { boot } = setup(async () => response(data));
        await assert.rejects(boot.getState(scope), /niet geladen/);
    }
    const { boot } = setup(async () => response({ ok: false }));
    await assert.rejects(boot.setState(scope, { patch: {} }), /niet opgeslagen/);
});

test('a failed backend request is not replayed against another alias', async () => {
    let calls = 0;
    const { boot } = setup(async () => { calls++; return { ok: false, status: 503 }; });
    await assert.rejects(boot.getState(scope), /503/);
    assert.equal(calls, 1);
});

test('bootstrap requires a complete valid order list, including every chunk', () => {
    const { boot } = setup(async () => response(snapshot()));
    assert.equal(boot.hasCompleteOrdersState(snapshot()), true);
    assert.equal(boot.hasCompleteOrdersState({ ...snapshot(), source: 'unavailable' }), false);
    assert.equal(boot.hasCompleteOrdersState({ values: {} }), false);
    assert.equal(boot.hasCompleteOrdersState({ values: { [key]: '{}' } }), false);
    const chunks = { [key]: '[{"id":99}]', [`${key}_chunks_v1`]: '{"count":2}', [`${key}_chunk_0`]: '[{"id":' };
    assert.equal(boot.hasCompleteOrdersState({ values: chunks }), false);
    chunks[`${key}_chunk_1`] = '1}]';
    assert.equal(boot.hasCompleteOrdersState({ values: chunks }), true);
    chunks[`${key}_chunks_v1`] = '{"count":2.5}';
    assert.equal(boot.hasCompleteOrdersState({ values: chunks }), false);
});

test('unavailable bootstrap never overwrites existing cache; valid bootstrap needs no network', () => {
    let payload = { ok: true, activeOrdersState: { source: 'unavailable', values: { [key]: '[]' } } };
    const root = { document: { getElementById: () => ({ textContent: JSON.stringify(payload) }) } };
    const boot = createBoot(root);
    let cache = { retained: 'yes' };
    const update = next => { cache = next; };
    assert.equal(boot.hydrateRemoteUiStateFromBootstrap(cache, update), false);
    assert.deepEqual(cache, { retained: 'yes' });
    payload = { ok: true, activeOrdersState: snapshot([{ id: 4 }]) };
    assert.equal(boot.hydrateRemoteUiStateFromBootstrap(cache, update), true);
    assert.deepEqual(JSON.parse(cache[key]), [{ id: 4 }]);
});


test('a cached timeout bootstrap cannot block the real network recovery', async () => {
    let calls = 0;
    const { boot, client } = setup(async () => { calls++; return response(snapshot([{ id: 3 }])); });
    client.prime(scope, { source: 'unavailable', values: {} }, { bootstrap: true });
    assert.deepEqual(await boot.getState(scope), snapshot([{ id: 3 }]));
    assert.equal(calls, 1);
});

test('orders initialization is read-only and failure remains distinct from an empty list', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    const page = read('assets/premium-actieve-opdrachten.js');
    const filters = read('assets/premium-personal-assignment-pages.js');
    assert.match(page, /setBuildMode\(buildMode, \{ persist: false \}\)/);
    assert.match(page, /reconcileOrdersRuntimeAfterRestore\(\{ persist: false \}\)/);
    assert.match(page, /if \(changed && options.persist !== false\)/);
    assert.match(page, /appendOrderLog\(id, note, true, options\)/);
    assert.match(page, /grid.dataset.ordersState = 'unavailable'/);
    assert.match(filters, /if \(!grid \|\| grid.dataset.ordersState === 'unavailable'\) return/);
    assert.doesNotMatch(page, /catch \(_\) \{\s*remoteUiStateLoaded = true/);
    assert.doesNotMatch(page, /if \(hadBootstrap\) void loadRemoteUiState/);
});


test('complete order rows cannot hide a truncated or malformed runtime', () => {
    const { boot } = setup(async () => response(snapshot()));
    const runtime = 'softora_order_runtime_premium_v1';
    const data = snapshot([{ id: 1 }]);
    data.values[runtime] = '{}';
    data.values[`${runtime}_chunks_v1`] = '{"count":2}';
    data.values[`${runtime}_chunk_0`] = '{';
    assert.equal(boot.hasCompleteOrdersState(data), false);
    data.values[`${runtime}_chunk_1`] = '}';
    assert.equal(boot.hasCompleteOrdersState(data), true);
    data.values[`${runtime}_chunk_1`] = 'broken';
    assert.equal(boot.hasCompleteOrdersState(data), false);
});

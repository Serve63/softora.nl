const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTableVersionRepository } = require('../../server/repositories/table-versions');
const {
  amsterdamDateKey,
  buildReadModelVersion,
  readRequestedReadModelVersion,
} = require('../../server/services/readmodel-version-response');
const { getColdmailStatsResponse } = require('../../server/services/coldmail-sent-register-response');
const { createPremiumDatabaseCustomersDeltaResponder } = require('../../server/services/premium-database-customers-delta');

const repoRoot = path.join(__dirname, '../..');
const recipients = [
  { key: 'email:a@example.com', email: 'a@example.com', company: 'A', senderEmail: 's@example.com', sentAt: '2026-09-24T07:00:00Z' },
  { key: 'email:b@example.com', email: 'b@example.com', company: 'B', senderEmail: 's@example.com', sentAt: '2026-09-20T07:00:00Z' },
];
const NOON = new Date('2026-09-24T10:00:00Z');

function createResponse() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('table version reads require a counter for every requested table', async () => {
  const calls = [];
  let data = [{ table_name: 'softora_customers', version: 12 }, { table_name: 'softora_outbound_recipient_guards', version: '7' }];
  const query = { select(columns) { calls.push(['select', columns]); return this; },
    in(column, values) { calls.push(['in', column, values]); return this; } };
  const repository = createTableVersionRepository({
    readQueryTimeoutMs: 6000,
    run: async (label, operation, options) => {
      assert.equal(label, 'read-table-versions');
      assert.equal(options.timeoutMs, 6000);
      operation({ from: (table) => { calls.push(['from', table]); return query; } });
      return { ok: true, data };
    },
  });

  assert.deepEqual(await repository.readTableVersions(['softora_outbound_recipient_guards', 'softora_customers']),
    { softora_customers: '12', softora_outbound_recipient_guards: '7' });
  assert.deepEqual(calls, [
    ['from', 'softora_table_versions'], ['select', 'table_name,version'],
    ['in', 'table_name', ['softora_customers', 'softora_outbound_recipient_guards']],
  ]);
  data = [{ table_name: 'softora_customers', version: 12 }];
  assert.equal(await repository.readTableVersions(['softora_customers', 'softora_outbound_recipient_guards']), null,
    'a table without trigger counter never gets a version');
  data = [{ table_name: 'softora_customers', version: 'x' }];
  assert.equal(await repository.readTableVersions(['softora_customers']), null);
  assert.equal(await repository.readTableVersions(['drop table']), null);
  assert.equal(await createTableVersionRepository({ run: async () => ({ ok: false }) }).readTableVersions(['softora_customers']), null);
});

test('read model versions are stable, opaque and only accepted in their exact format', () => {
  const version = buildReadModelVersion(['coldmail-sent-register', '7', '2026-09-24']);
  assert.match(version, /^rm1-[a-f0-9]{40}$/);
  assert.equal(buildReadModelVersion(['coldmail-sent-register', '7', '2026-09-24']), version);
  assert.notEqual(buildReadModelVersion(['coldmail-sent-register', '8', '2026-09-24']), version);
  assert.equal(buildReadModelVersion(['coldmail-sent-register', '']), '');
  assert.equal(readRequestedReadModelVersion({ headers: { 'x-softora-readmodel-version': version } }), version);
  assert.equal(readRequestedReadModelVersion({ headers: { 'x-softora-readmodel-version': 'rm1-nope' } }), '');
  assert.equal(amsterdamDateKey(new Date('2026-09-23T22:30:00Z')), '2026-09-24', 'midnight follows Amsterdam, not UTC');
});

function createStatsService(order) {
  return {
    getColdmailLiveStats: async () => { order.push('live'); return { ok: true, stats: { hardBounces: 3, sentToday: 99 } }; },
    getColdmailSentRegister: async () => { order.push('register'); return { available: true, recipients,
      todayRecipientCounts: { 'email:a@example.com': 1 } }; },
  };
}

test('coldmail stats return the full register with its version, read after the version', async () => {
  const order = [];
  const readTableVersions = async (tables) => {
    assert.deepEqual(tables, ['softora_outbound_recipient_guards']);
    order.push('version');
    return { softora_outbound_recipient_guards: '7' };
  };
  const response = await getColdmailStatsResponse(createStatsService(order), true, {}, { readTableVersions, now: () => NOON });

  assert.ok(order.indexOf('version') < order.indexOf('register'), 'the version is proven before the rows are read');
  assert.equal(response.stats.sentToday, 1);
  assert.equal(response.stats.hardBounces, 3);
  assert.equal(response.stats.sentRegister.recipients.length, 2);
  const { fields, ...meta } = response.stats.readModel;
  assert.deepEqual(meta, { key: 'coldmail-sent-register', unchanged: false,
    version: buildReadModelVersion(['coldmail-sent-register', '7', '2026-09-24']) });
  assert.deepEqual([...fields].sort(),
    Object.keys(response.stats).filter((key) => !['hardBounces', 'readModel'].includes(key)).sort(),
    'every register-owned field is declared, live fields are not');
});

test('coldmail stats skip the register build when the browser already holds that version', async () => {
  const order = [];
  const version = buildReadModelVersion(['coldmail-sent-register', '7', '2026-09-24']);
  const timings = {};
  const response = await getColdmailStatsResponse(createStatsService(order), true, timings, {
    readTableVersions: async () => ({ softora_outbound_recipient_guards: '7' }), requestedVersion: version, now: () => NOON,
  });
  assert.deepEqual(order, ['live']);
  assert.equal(timings.register, undefined);
  assert.deepEqual(response.stats.readModel, { key: 'coldmail-sent-register', version, unchanged: true });
  assert.equal(response.stats.sentRegister, undefined);
  assert.equal(response.stats.hardBounces, 3);

  const nextDay = await getColdmailStatsResponse(createStatsService([]), true, {}, {
    readTableVersions: async () => ({ softora_outbound_recipient_guards: '7' }), requestedVersion: version,
    now: () => new Date('2026-09-24T23:30:00Z'),
  });
  assert.equal(nextDay.stats.readModel.unchanged, false, 'today-counts are rebuilt after midnight');
});

test('coldmail stats keep the full response without a version counter', async () => {
  for (const readTableVersions of [null, async () => null, async () => { throw new Error('offline'); }]) {
    const order = [];
    const response = await getColdmailStatsResponse(createStatsService(order), true, {}, { readTableVersions, requestedVersion: 'rm1-' + 'a'.repeat(40) });
    assert.deepEqual(order.sort(), ['live', 'register']);
    assert.equal(response.stats.readModel, undefined);
    assert.equal(response.stats.sentRegister.total, 2);
  }
});

test('customer delta answers unchanged from the table counter without reading rows', async () => {
  const version = buildReadModelVersion(['premium-database-customers', '41']);
  const reads = [];
  const store = {
    readTableVersions: async () => ({ softora_customers: '41' }),
    listCustomersPage: async () => { reads.push('meta'); return { total: 1, snapshotVersion: '1:2026-09-24T09:00:00.000Z' }; },
    listCustomersChangedSince: async () => { reads.push('delta'); return []; },
  };
  const responder = createPremiumDatabaseCustomersDeltaResponder({ dataOpsStore: store, nowMs: () => NOON.getTime(), logger: { info() {}, warn() {} } });

  const unchanged = createResponse();
  await responder({ query: { since: '2026-09-24T09:00:00.000Z' }, headers: { 'x-softora-readmodel-version': version } }, unchanged);
  assert.deepEqual(unchanged.body, { ok: true, source: 'canonical-customers-delta', completeDelta: true, unchanged: true, readModelVersion: version });
  assert.deepEqual(reads, []);

  const changed = createResponse();
  store.readTableVersions = async () => ({ softora_customers: '42' });
  await responder({ query: { since: '2026-09-24T09:00:00.000Z' }, headers: { 'x-softora-readmodel-version': version } }, changed);
  assert.equal(changed.body.unchanged, undefined);
  assert.equal(changed.body.readModelVersion, buildReadModelVersion(['premium-database-customers', '42']));
  assert.deepEqual(reads, ['meta', 'delta', 'meta']);
});

function loadClient() {
  const scriptPath = path.join(repoRoot, 'assets/premium-readmodel-client.js');
  delete require.cache[require.resolve(scriptPath)];
  return require(scriptPath);
}

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => JSON.parse(JSON.stringify(body)) };
}

test('read model client completes an unchanged answer from the local copy', async (t) => {
  globalThis.requestIdleCallback = (callback) => callback();
  t.after(() => { delete globalThis.requestIdleCallback; });
  const client = loadClient();
  const version = 'rm1-' + 'b'.repeat(40);
  const writes = [];
  const store = { read: async (key, identity) => {
    assert.equal(key, 'versioned:register:v1');
    assert.equal(identity, 'serve@softora.nl');
    return { version, fields: { sentToday: 4, sentRegister: { total: 1 } } };
  }, write: async (...args) => { writes.push(args); return true; } };
  const sentHeaders = [];
  const result = await client.fetchJson('/api/stats', { headers: { Accept: 'application/json' } }, {
    key: 'register:v1', path: 'stats', store, session: { authenticated: true, email: 'Serve@Softora.nl' },
    fetchImpl: async (_url, init) => {
      sentHeaders.push(init.headers);
      return jsonResponse({ ok: true, stats: { hardBounces: 2, readModel: { version, unchanged: true } } });
    },
  });
  assert.deepEqual(sentHeaders, [{ Accept: 'application/json', 'X-Softora-Readmodel-Version': version }]);
  assert.equal(result.payload.stats.sentToday, 4);
  assert.equal(result.payload.stats.hardBounces, 2);
  assert.deepEqual(result.payload.stats.sentRegister, { total: 1 });
  assert.equal(writes.length, 0);
});

test('read model client stores exactly the declared fields of a full answer', async (t) => {
  globalThis.requestIdleCallback = (callback) => callback();
  t.after(() => { delete globalThis.requestIdleCallback; });
  const client = loadClient();
  const version = 'rm1-' + 'c'.repeat(40);
  const writes = [];
  const store = { read: async () => null, write: async (...args) => { writes.push(args); return true; } };
  const result = await client.fetchJson('/api/stats', {}, {
    key: 'register:v1', path: 'stats', store, session: { authenticated: true, userId: 'U1' },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['X-Softora-Readmodel-Version'], undefined);
      return jsonResponse({ ok: true, stats: { hardBounces: 2, sentToday: 5,
        readModel: { version, unchanged: false, fields: ['sentToday'] } } });
    },
  });
  assert.equal(result.payload.stats.sentToday, 5);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [['versioned:register:v1', 'u1', { version, fields: { sentToday: 5 } }]]);
});

test('read model client refetches in full when its copy vanished before the unchanged answer', async () => {
  const client = loadClient();
  const version = 'rm1-' + 'd'.repeat(40);
  let reads = 0;
  const store = { read: async () => { reads += 1; return reads === 1 ? { version: 'rm1-' + 'e'.repeat(40), fields: {} } : null; }, write: async () => true };
  const requests = [];
  const result = await client.fetchJson('/api/stats', {}, {
    key: 'register:v1', path: 'stats', store, session: { authenticated: true, email: 'serve@softora.nl' },
    fetchImpl: async (_url, init) => {
      requests.push(init.headers['X-Softora-Readmodel-Version'] || 'none');
      return requests.length === 1
        ? jsonResponse({ ok: true, stats: { readModel: { version, unchanged: true } } })
        : jsonResponse({ ok: true, stats: { sentToday: 1, readModel: { version, unchanged: false, fields: ['sentToday'] } } });
    },
  });
  assert.deepEqual(requests, ['rm1-' + 'e'.repeat(40), 'none']);
  assert.equal(result.payload.stats.sentToday, 1);
});

test('read model client never sends or stores a version without a signed-in identity', async () => {
  const client = loadClient();
  let touched = false;
  const store = { read: async () => { touched = true; return null; }, write: async () => { touched = true; return true; } };
  const result = await client.fetchJson('/api/stats', {}, {
    key: 'register:v1', path: 'stats', store, session: { authenticated: false },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['X-Softora-Readmodel-Version'], undefined);
      return jsonResponse({ ok: true, stats: { readModel: { version: 'rm1-' + 'f'.repeat(40), unchanged: false, fields: [] } } });
    },
  });
  assert.equal(result.response.ok, true);
  assert.equal(touched, false);
});

test('customer loader reuses its local copy when the server proves it unchanged', async () => {
  const scriptPath = path.join(repoRoot, 'assets/premium-database-customers-loader.js');
  delete require.cache[require.resolve(scriptPath)];
  const loader = require(scriptPath);
  const version = buildReadModelVersion(['premium-database-customers', '41']);
  const writes = [];
  const customers = [{ id: 'a' }, { id: 'b' }];
  const store = { read: async () => ({ customers, total: 2, snapshotVersion: '2:2026-09-24T09:00:00.000Z',
    readModelVersion: version, fullSyncedAt: Date.now() }), write: async (...args) => { writes.push(args); return true; } };
  const headers = [];
  const loaded = await loader.load({ validatorSession: { authenticated: true, email: 'serve@softora.nl' }, readModelStore: store,
    fetchJsonWithTimeout: async (_url, options) => {
      headers.push(options.headers);
      return jsonResponse({ ok: true, completeDelta: true, unchanged: true, readModelVersion: version });
    } });
  assert.deepEqual(headers, [{ 'X-Softora-Readmodel-Version': version }]);
  assert.equal(loaded.source, 'unchanged');
  assert.equal(loaded.customers, customers);
  assert.equal(loaded.total, 2);
  assert.equal(writes.length, 0);
});

test('table version migration counts every write on both source tables through a locked-down function', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20260923222655_platform_table_versions.sql'), 'utf8');
  for (const table of ['softora_customers', 'softora_outbound_recipient_guards']) {
    assert.match(sql, new RegExp(`after insert or update or delete on public\\.${table}\\s+for each statement`));
    assert.match(sql, new RegExp(`after truncate on public\\.${table}\\s+for each statement`));
  }
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /revoke all on table public\.softora_table_versions from public, anon, authenticated/);
  assert.match(sql, /-- Rollback:/);
});

test('Mailsysteem loads the read model client before the mail metrics', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-database.html'), 'utf8');
  const store = page.indexOf('assets/premium-readmodel-store.js?v=20260923a');
  const client = page.indexOf('assets/premium-readmodel-client.js?v=20260924a');
  const metrics = page.indexOf('assets/premium-database-system-mail-count.js?v=20260924-readmodel');
  assert.ok(store > 0 && store < client && client < metrics);
  assert.equal(page.split('assets/premium-readmodel-store.js').length, 2, 'the store is loaded once');
});

test('ui-state reads are versioned by content for allow-listed scopes only', () => {
  const { buildUiStateGetBody, uiStateReadModelVersion } = require('../../server/services/ui-state-readmodel');
  const state = { values: { guard: '{"entries":[1,2]}' }, source: 'supabase', updatedAt: '2026-09-24T08:00:00Z' };
  const version = uiStateReadModelVersion('premium_coldmail_send_guard', state);
  assert.match(version, /^rm1-[a-f0-9]{40}$/);

  const full = buildUiStateGetBody({ headers: {} }, 'premium_coldmail_send_guard', state);
  assert.deepEqual(full.values, state.values);
  assert.deepEqual(full.readModel, { key: 'ui-state:premium_coldmail_send_guard', version, unchanged: false,
    fields: ['scope', 'values', 'source', 'updatedAt'] });

  const unchanged = buildUiStateGetBody({ headers: { 'x-softora-readmodel-version': version } }, 'premium_coldmail_send_guard', state);
  assert.deepEqual(unchanged, { ok: true, scope: 'premium_coldmail_send_guard',
    readModel: { key: 'ui-state:premium_coldmail_send_guard', version, unchanged: true } });

  const edited = { ...state, values: { guard: '{"entries":[1,2,3]}' } };
  assert.notEqual(uiStateReadModelVersion('premium_coldmail_send_guard', edited), version, 'any value change is a new version');
  assert.equal(uiStateReadModelVersion('premium_coldmail_send_guard', { ...state, source: 'memory' }), '',
    'an in-memory fallback is never presented as a verified copy');
  for (const scope of ['premium_password_register', 'premium_customers_database', 'premium_active_orders', 'premium_database_photos']) {
    assert.equal(uiStateReadModelVersion(scope, state), '', scope);
    const body = buildUiStateGetBody({ headers: { 'x-softora-readmodel-version': version } }, scope, state, { revision: 3 });
    assert.equal(body.readModel, undefined);
    assert.deepEqual(body.values, state.values);
    assert.equal(body.revision, 3);
  }
});

test('mail-ready archive answers unchanged for the snapshot content the browser already holds', async () => {
  const { createPremiumDatabaseSnapshotArchiveResponder } = require('../../server/services/premium-database-snapshot-archive');
  const snapshot = { ok: true, source: 'structured-mail-ready-snapshot', generatedAt: '2026-09-24T08:00:00Z',
    snapshotVersion: 'sha256:abc', total: 1, customers: [{ id: 'a' }], availableTotal: 1,
    availableCustomers: [{ id: 'b', bedrijf: 'B' }], instantlyReadyTotal: 0, instantlyReadyCustomers: [],
    foundTotal: 1, foundCustomerIds: ['a'], timings: { buildMs: 5 } };
  const responder = createPremiumDatabaseSnapshotArchiveResponder({ buildSnapshot: async () => snapshot,
    nowMs: Date.now, logger: { info() {}, warn() {} }, source: 'structured-mail-ready-snapshot' });
  const full = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, end(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
  await responder({ query: { compact: '1' }, headers: {} }, full);
  const payload = JSON.parse(require('node:zlib').gunzipSync(full.body).toString('utf8'));
  assert.equal(payload.readModel.unchanged, false);
  assert.deepEqual(payload.availableCustomers, [{ id: 'b', availableSnapshot: true }]);
  assert.ok(payload.readModel.fields.includes('availableCustomers'));
  assert.ok(!payload.readModel.fields.includes('timings') && !payload.readModel.fields.includes('ok'));

  const again = { ...full, headers: {}, body: null };
  await responder({ query: { compact: '1' }, headers: { 'x-softora-readmodel-version': payload.readModel.version } }, again);
  assert.deepEqual(again.body, { ok: true, source: 'structured-mail-ready-snapshot',
    readModel: { key: 'mail-ready-snapshot', version: payload.readModel.version, unchanged: true } });

  const otherMode = { ...full, headers: {}, body: null };
  await responder({ query: {}, headers: { 'x-softora-readmodel-version': payload.readModel.version } }, otherMode);
  assert.ok(Buffer.isBuffer(otherMode.body), 'the compact copy never answers for the full archive');
});

test('read model client completes whole-response read models and acts like a fetch response', async () => {
  const client = loadClient();
  const version = 'rm1-' + '1'.repeat(40);
  const store = { read: async () => ({ version, fields: { values: { a: 1 }, scope: 's' } }), write: async () => true };
  const response = await client.fetchResponse('/api/ui-state-get?scope=s', { method: 'GET' }, {
    key: 'ui-state:s', store, session: { authenticated: true, email: 'serve@softora.nl' },
    fetchImpl: async () => jsonResponse({ ok: true, scope: 's', readModel: { version, unchanged: true } }),
  });
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.values, { a: 1 });
  assert.equal(payload.ok, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createKvkApiWorkersService } = require('../../server/services/kvk-api-workers');

const root = path.join(__dirname, '../..');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('KVK dashboard exposes one control for each API worker', () => {
  const page = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  assert.match(page, /id="kvk-api-workers-open"/);
  assert.match(page, /id="kvk-api-searcher-toggle"/);
  assert.match(page, /id="kvk-api-controller-toggle"/);
  assert.match(page, /assets\/kvk-api-workers\.js/);
  for (const role of ['searcher', 'controller']) {
    assert.match(page, new RegExp(`<input id="kvk-api-${role}-count"[^>]+type="text"[^>]+inputmode="numeric"`));
  }
  assert.doesNotMatch(page, /<select id="kvk-api-(searcher|controller)-count"/);
});

test('KVK API budget starts at exactly 100 EUR with both workers off', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260923212844_kvk_sol_api_shared_budget.sql'), 'utf8');
  assert.match(sql, /limit_eur_cents integer not null check \(limit_eur_cents = 10000\)/);
  assert.match(sql, /searcher_enabled boolean not null default false/);
  assert.match(sql, /controller_enabled boolean not null default false/);
  assert.match(sql, /spent_eur_cents \+ reserved_eur_cents \+ p_reserve_eur_cents <= limit_eur_cents/);
  assert.match(sql, /revoke execute on function public\.softora_kvk_api_reserve/);
});

test('missing API key prevents enabling paid workers', async () => {
  const row = { id: true, limit_eur_cents: 10000, spent_eur_cents: 0, reserved_eur_cents: 0,
    searcher_enabled: false, controller_enabled: false };
  const client = { from() { return { select() { return { eq() { return { single: async () => ({ data: row }) }; } }; } }; } };
  const service = createKvkApiWorkersService({ getSupabaseClient: () => client, env: {} });
  const res = response();
  await service.setEnabled({ body: { searcherEnabled: true, controllerEnabled: false } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /API-sleutel ontbreekt/);
});

test('worker research cannot call OpenAI after reservation is denied', async () => {
  let fetchCalls = 0;
  const client = { rpc: async () => ({ data: false, error: null }) };
  const service = createKvkApiWorkersService({
    getSupabaseClient: () => client,
    kvkDatabaseSyncToken: 'test-token',
    env: { OPENAI_API_KEY: 'unprinted-test-value' },
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
    now: () => new Date('2026-09-23T21:30:00Z'),
  });
  const res = response();
  await service.research({
    headers: { authorization: 'Bearer test-token' },
    body: { role: 'searcher', company: { kvk_nummer: '12345678' }, brief: { result_schema: {} } },
  }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(fetchCalls, 0);
});

function settingsFixture(overrides = {}) {
  const row = { id: true, limit_eur_cents: 10000, spent_eur_cents: 0, reserved_eur_cents: 0,
    searcher_enabled: false, controller_enabled: false, searcher_count: 1, controller_count: 1, ...overrides };
  const writes = [];
  const client = { from() { return {
    select() { return { eq() { return { single: async () => ({ data: { ...row } }) }; } }; },
    update(changes) { return { async eq() { writes.push(changes); Object.assign(row, changes); return { error: null }; } }; },
  }; } };
  return { row, writes, service: createKvkApiWorkersService({ getSupabaseClient: () => client, env: {} }) };
}

test('count changes persist independently without enabling either role or requiring an API key', async () => {
  const { service, row, writes } = settingsFixture();
  const res = response();
  await service.setEnabled({ body: { role: 'searcher', count: 4 } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(writes, [{ searcher_count: 4 }]);
  assert.equal(res.body.state.workers.searcher.count, 4);
  assert.equal(row.searcher_enabled, false);
  assert.equal(row.controller_count, 1);
});

test('count rejects fractions, coercion and values outside the supported range before writing', async () => {
  for (const count of [0, 11, 2.5, '3', null]) {
    const { service, writes } = settingsFixture();
    const res = response();
    await service.setEnabled({ body: { role: 'controller', count } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(writes.length, 0);
  }
});

test('stopping one role remains possible with exhausted budget and leaves the other role untouched', async () => {
  const { service, row, writes } = settingsFixture({ searcher_enabled: true, controller_enabled: true, spent_eur_cents: 10000 });
  const res = response();
  await service.setEnabled({ body: { role: 'searcher', enabled: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(row.searcher_enabled, false);
  assert.equal(row.controller_enabled, true);
  assert.equal(Object.hasOwn(writes[0], 'controller_enabled'), false);
});

test('Robot v5 can be enabled without an API key or paid budget reservation', async () => {
  const { service, row, writes } = settingsFixture({ robot_enabled: false, spent_eur_cents: 10000 });
  const res = response();
  await service.setEnabled({ body: { role: 'robot', enabled: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(row.robot_enabled, true);
  assert.equal(row.searcher_enabled, false);
  assert.equal(row.controller_enabled, false);
  assert.equal(writes.length, 1);
  assert.equal(res.body.state.workers.robot.enabled, true);
});

test('robot cannot enter the paid research endpoint', async () => {
  let touched = false;
  const service = createKvkApiWorkersService({ kvkDatabaseSyncToken: 'robot-test', getSupabaseClient() { touched = true; } });
  const res = response();
  await service.research({ headers: { authorization: 'Bearer robot-test' }, body: { role: 'robot', company: { kvk_nummer: '12345678' }, brief: {} } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(touched, false);
});

test('robot control keeps evidence review separate from approved inventory', () => {
  const page = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_robot_v5.py'), 'utf8');
  assert.match(page, /id="kvk-api-robot-toggle"/);
  assert.match(page, /id="kvk-api-workers-title">Database vullen<\/h2>/);
  assert.match(page, /<strong>Robot<\/strong>/);
  assert.doesNotMatch(page, /Zonder AI · resultaten ter controle|Sol 6 Max via API|<strong>Robot v5/);
  assert.match(runner, /planning-next/);
  assert.match(runner, /completed\.json/);
  assert.match(runner, /mode=ro/);
  assert.match(runner, /os\.killpg/);
  assert.doesNotMatch(runner, /contact_validate_apply|\/research|api\.openai/);
});

test('worker dialog shows real spend, separate reservations and halted errors without success notices', () => {
  const js = fs.readFileSync(path.join(root, 'assets/kvk-api-workers.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/kvk-database-redesign.css'), 'utf8');
  assert.doesNotMatch(js, /spentEur \+ state\.budget\.reservedEur/);
  assert.match(js, /reservationLabel\.textContent/);
  assert.match(js, /\^Gestopt:/);
  assert.doesNotMatch(js, /'aangezet' : 'uitgezet'/);
  assert.match(css, /\.latest-treated-panel thead\{display:none\}/);
  assert.match(css, /width:12px;height:12px;padding:0;border:1px solid #d8bdcb/);
});

test('authenticated diagnostics perform only a free model read and redact the key', async () => {
  let calls = 0;
  const service = createKvkApiWorkersService({ kvkDatabaseSyncToken: 'sync-test', env: { OPENAI_API_KEY: 'sk-test-secret' },
    fetchImpl: async (url, options) => { calls++; assert.match(url, /\/models\/gpt-6-sol$/); assert.equal(options.method, undefined);
      return { ok: false, status: 401, json: async () => ({ error: { code: 'invalid_api_key', message: 'Bad key sk-test-secret' } }) }; } });
  const bad = response();
  await service.poll({ headers: {}, body: { diagnose: true } }, bad);
  assert.equal(bad.statusCode, 401); assert.equal(calls, 0);
  const good = response();
  await service.poll({ headers: { authorization: 'Bearer sync-test' }, body: { diagnose: true } }, good);
  assert.equal(good.body.diagnostics.available, false); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(good.body), /sk-test-secret/);
});

test('definite upstream rejection releases the reservation while ambiguous failures retain it', async () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500, 502, 503]) {
    const rpcCalls = [];
    const updates = [];
    const client = { rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: true }; },
      from() { return { update(value) { updates.push(value); return { eq: async () => ({ error: null }) }; } }; } };
    const service = createKvkApiWorkersService({ kvkDatabaseSyncToken: 'sync-test', env: { OPENAI_API_KEY: 'sk-test-secret' },
      now: () => new Date('2026-09-24T12:00:00Z'), getSupabaseClient: () => client,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.tools[0].type, 'web_search');
        assert.equal(body.text, undefined, 'web search must not use incompatible JSON mode');
        assert.equal(body.model, 'gpt-6-sol');
        assert.equal(body.reasoning.effort, 'max');
        return { ok: false, status, json: async () => ({ error: { code: 'rejected', message: 'Failure sk-test-secret' } }) };
      } });
    const res = response();
    await service.research({ headers: { authorization: 'Bearer sync-test' }, body: {
      role: 'searcher', company: { kvk_nummer: '12345678' }, brief: {} } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(rpcCalls.length, status < 500 ? 2 : 1);
    if (status < 500) assert.equal(rpcCalls[1].args.p_actual_eur_cents, 0);
    assert.equal(updates[0].searcher_enabled, false);
    assert.doesNotMatch(res.body.error, /sk-test-secret/);
  }
});

test('expired in-flight slots preserve the shared money reservation', () => {
 const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260924124059_kvk_api_stale_slot_recovery.sql'), 'utf8');
 assert.match(sql, /created_at > now\(\) - interval '15 minutes'/);
 assert.match(sql, /spent_eur_cents \+ reserved_eur_cents \+ p_reserve_eur_cents <= limit_eur_cents/);
 assert.doesNotMatch(sql, /reserved_eur_cents = reserved_eur_cents -/);
});

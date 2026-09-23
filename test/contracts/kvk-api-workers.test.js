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

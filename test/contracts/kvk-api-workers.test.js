const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createKvkApiWorkersService } = require('../../server/services/kvk-api-workers');

const root = path.join(__dirname, '../..');

test('API worker and evidence profile regressions pass without paid requests', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'kvk_api_*test.py'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});

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

test('worker dialog shows real spend and only Aan or Uit for worker status', () => {
  const js = fs.readFileSync(path.join(root, 'assets/kvk-api-workers.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/kvk-database-redesign.css'), 'utf8');
  assert.doesNotMatch(js, /spentEur \+ state\.budget\.reservedEur/);
  assert.doesNotMatch(js, /reservationLabel|gereserveerd`/);
  assert.match(js, /control\.status\.textContent = worker\.enabled \? 'Aan' : 'Uit'/);
  assert.doesNotMatch(js, /worker\.message/);
  const html = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  assert.doesNotMatch(html, /kvk-api-workers-reserved/);
  assert.doesNotMatch(js, /'aangezet' : 'uitgezet'/);
  assert.match(css, /\.latest-treated-panel thead\{display:none\}/);
  assert.match(css, /width:12px;height:12px;padding:0;border:1px solid #d8bdcb/);
});

test('authenticated diagnostics perform only a free model read and redact the key', async () => {
  let calls = 0;
  const service = createKvkApiWorkersService({ kvkDatabaseSyncToken: 'sync-test', env: { OPENAI_API_KEY: 'sk-test-secret' },
    fetchImpl: async (url, options) => { calls++; assert.match(url, /\/models\/gpt-6-luna$/); assert.equal(options.method, undefined);
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
        assert.equal(body.model, 'gpt-6-luna');
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

test('uncertain usage reports metering metadata without company content', () => {
 const source = fs.readFileSync(path.join(root, 'server/services/kvk-api-workers.js'), 'utf8');
 assert.match(source, /uncertain usage/);
 assert.match(source, /responseId: data.id/);
 assert.match(source, /input: data.usage\?\.input_tokens/);
});

test('actual search usage is billed even when the provider exceeds the requested tool count', async () => {
 const calls = [];
 const row = {limit_eur_cents:10000,spent_eur_cents:72,reserved_eur_cents:0};
 const client = {rpc:async(name,args)=>{calls.push({name,args});return {data:true};}, from:()=>({select:()=>({eq:()=>({single:async()=>({data:row})})})})};
 const service = createKvkApiWorkersService({getSupabaseClient:()=>client,kvkDatabaseSyncToken:'test',env:{OPENAI_API_KEY:'test'},now:()=>new Date('2026-09-24'),fetchImpl:async()=>({ok:true,json:async()=>({model:'gpt-6-luna',status:'completed',usage:{input_tokens:42842,output_tokens:3635},output:[...Array.from({length:9},()=>({type:'web_search_call'})),{content:[{type:'output_text',text:'{"kvk_nummer":"12345678"}'}]}]})})});
 const res = response();
 await service.research({headers:{authorization:'Bearer test'},body:{role:'searcher',company:{kvk_nummer:'12345678'},brief:{}}},res);
 assert.equal(res.statusCode,200);
 assert.equal(calls[1].name,'softora_kvk_api_settle');
 // Luna: 42842 in x $0.25/M + 3635 out x $0.75/M + 9 searches x $0.01 = $0.1034.
 assert.equal(calls[1].args.p_actual_eur_cents,11);
});

test('API research uses available web tools and explicit evidence-preserving repair instructions', () => {
 const source=fs.readFileSync(path.join(root,'server/services/kvk-api-workers.js'),'utf8');
 assert.match(source,/geen lokale scripts of bestanden/);
 assert.match(source,/behoud bewezen gegevens uit previous_result/);
 assert.match(source,/zet nooit alleen een voltooiingsvlag om/);
 assert.match(source,/const MAX_TOOL_CALLS = 16/);
 const runner=fs.readFileSync(path.join(root,'scripts/kvk_api_workers.py'),'utf8');
 assert.match(runner,/MAX_REPAIR_ATTEMPTS = 3/);
 assert.match(runner,/if transient_control_failure\(error\):/);
 assert.doesNotMatch(runner,/"bindend": packet.get\("bindend"\)/);
 assert.match(runner,/"contract": PROFILE/);
 const validation=fs.readFileSync(path.join(root,'scripts/kvk_api_validation.py'),'utf8');
 assert.match(validation,/api-basic-v1/);
 assert.match(validation,/validate_api_evidence/);
 assert.match(runner,/telefoonnummer EN email/);
 assert.match(runner,/public_page_evidence/);
 assert.match(runner,/validate_saved_result\(path, result, flags\)/);
 const evidence=fs.readFileSync(path.join(root,'scripts/kvk_api_evidence.py'),'utf8');
 assert.match(evidence,/api\.whatsapp\.com/);
 assert.match(evidence,/require_public_url\(newurl\)/);
 assert.match(evidence,/never copy it automatically/);
});
test('a failing budget status read does not discard settled paid research', async()=>{
 const client={rpc:async()=>({data:true}),from(){throw new Error('temporary status outage');}};
 const service=createKvkApiWorkersService({getSupabaseClient:()=>client,kvkDatabaseSyncToken:'test',env:{OPENAI_API_KEY:'test'},now:()=>new Date('2026-09-24'),fetchImpl:async()=>({ok:true,json:async()=>({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:100},output_text:'{"kvk_nummer":"12345678"}'})})});
 const res=response();await service.research({headers:{authorization:'Bearer test'},body:{role:'searcher',company:{kvk_nummer:'12345678'},brief:{}}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.result.kvk_nummer,'12345678');assert.equal(res.body.budget,null);
});

test('Searcher runs Luna 6 Max once with its own short brief and returns the pages it retrieved', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: true }; },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { limit_eur_cents: 10000, spent_eur_cents: 0, reserved_eur_cents: 0 } }) }) }) }) };
  let body;
  const answer = { kvk_nummer: '12345678', telefoonnummer: '0612345678' };
  const service = createKvkApiWorkersService({ getSupabaseClient: () => client, kvkDatabaseSyncToken: 'test',
    env: { OPENAI_API_KEY: 'test' }, now: () => new Date('2026-09-24'),
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({
      model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 1000, output_tokens: 1000 },
      output: [{ type: 'web_search_call', action: { type: 'open_page', url: 'https://voorbeeld.nl/contact',
        sources: [{ url: 'https://gids.nl/voorbeeld' }, { url: 'javascript:alert(1)' }] } },
      { content: [{ type: 'output_text', text: `Resultaat:\n${JSON.stringify(answer)}` }] }] }) }; } });
  const res = response();
  await service.research({ headers: { authorization: 'Bearer test' }, body: { role: 'searcher',
    company: { kvk_nummer: '12345678', bedrijfsnaam: 'Voorbeeld', adres: 'Straat 1', plaats: 'Tilburg' }, brief: {} } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.reasoning.effort, 'max');
  assert.equal(calls[0].args.p_reserve_eur_cents, 100);
  assert.match(body.input[0].content, /^Je bent de Searcher van Softora/);
  assert.doesNotMatch(body.input[0].content, /previous_result|route_notes/);
  assert.deepEqual(JSON.parse(body.input[1].content), { kvk_nummer: '12345678', bedrijfsnaam: 'Voorbeeld', adres: 'Straat 1', plaats: 'Tilburg' });
  assert.deepEqual(res.body.result, answer);
  assert.deepEqual(res.body.consultedUrls, ['https://voorbeeld.nl/contact', 'https://gids.nl/voorbeeld']);
  // Opening a page carries no search fee: only tokens are charged here.
  assert.equal(res.body.costEurCents, 1);
  assert.deepEqual(res.body.usage, { inputTokens: 1000, outputTokens: 1000, searches: 0, pageOpens: 1 });
  assert.equal(body.tools[0].search_context_size, 'low');
  assert.match(body.input[0].content, /hoogstens 2 zoekacties/);
  assert.match(body.input[0].content, /holding, beheer-bv of vastgoed-bv/);
  assert.match(body.input[0].content, /nooit op alleen het KVK-nummer/);
});

test('dashboard state names the model that actually runs', async () => {
  const { service } = settingsFixture();
  const res = response();
  await service.getStatus({}, res);
  assert.equal(res.body.state.model, 'gpt-6-luna');
  assert.equal(res.body.state.modelLabel, 'Luna 6 Max');
  assert.equal(res.body.state.budget.reservationEur, 1);
});

test('Searcher maps a saved Luna answer before the apply step looks for it', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  const searcher = runner.slice(runner.indexOf('def luna_search_one'), runner.indexOf('def research_one'));
  assert.ok(searcher.indexOf('to_canonical(') > 0);
  assert.ok(searcher.indexOf('to_canonical(') < searcher.indexOf('if not validate:'),
    'apply_ready_prefix skips a queue head whose mapped result does not exist yet');
});

test('only search actions carry the per-call search fee', () => {
  const { toolUsage } = require('../../server/services/kvk-luna-searcher-prompt');
  const call = (type) => ({ type: 'web_search_call', action: type ? { type } : undefined });
  const data = { output: [call('search'), call('search'), call('open_page'), call('find_in_page'), call(undefined), { type: 'message' }] };
  // An item without a recognisable action is charged as a search.
  assert.deepEqual(toolUsage(data), { searches: 3, pageOpens: 2 });
});

test('Luna Searcher records mentioned but unkept contacts as rejected for the canonical validator', () => {
  const mapper = fs.readFileSync(path.join(root, 'scripts/kvk_luna_searcher.py'), 'utf8');
  assert.match(mapper, /def withhold_unaccepted_contacts/);
  assert.match(mapper, /"reason_code": "unverified_candidate"/);
  assert.match(mapper, /withhold_unaccepted_contacts\(result, reference/);
});

test('an incomplete Luna answer is settled and reports why it stopped', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: true }; } };
  const service = createKvkApiWorkersService({ getSupabaseClient: () => client, kvkDatabaseSyncToken: 'test',
    env: { OPENAI_API_KEY: 'test' }, now: () => new Date('2026-09-24'),
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).max_output_tokens, 40000);
      return { ok: true, json: async () => ({ model: 'gpt-6-luna', status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 20000, output_tokens: 40000 },
        output: [{ type: 'web_search_call', action: { type: 'search' } }] }) };
    } });
  const res = response();
  await service.research({ headers: { authorization: 'Bearer test' }, body: { role: 'searcher', company: { kvk_nummer: '12345678' }, brief: {} } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(calls[1].name, 'softora_kvk_api_settle');
  assert.match(res.body.error, /max_output_tokens/);
  assert.match(res.body.error, /"searches":1/);
});

test('Searcher refills a finished worker at once instead of waiting for the slowest of a batch', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  const pipeline = runner.slice(runner.indexOf('def run_searcher_pipeline'), runner.indexOf('def work('));
  assert.match(pipeline, /return_when=FIRST_COMPLETED/);
  assert.match(pipeline, /apply_searcher_head\(packet, flags, apply_lock\)/);
  assert.match(pipeline, /pool\.shutdown\(wait=True\)/);
  assert.match(runner, /if role == "searcher":\n\s+run_searcher_pipeline\(apply_lock\)/);
});

test('Luna Searcher keeps opened search pages and exact field URLs as recorded sources', () => {
  const mapper = fs.readFileSync(path.join(root, 'scripts/kvk_luna_searcher.py'), 'utf8');
  assert.match(mapper, /"Zoekpagina" if SEARCH_URL\.search/);
  assert.match(mapper, /add\(url, "Bron van een gecontroleerd veld\.", exact=True\)/);
});

test('Searcher spends as little time as possible outside Luna', () => {
  const prompt = fs.readFileSync(path.join(root, 'server/services/kvk-luna-searcher-prompt.js'), 'utf8');
  assert.match(prompt, /Schrijf het antwoord kort/);
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  assert.match(runner, /SEARCHER_REFRESH_SECONDS = 30/);
  assert.match(runner, /check_before_precheck=False/);
  const mapper = fs.readFileSync(path.join(root, 'scripts/kvk_luna_searcher.py'), 'utf8');
  assert.match(mapper, /def fetch_page\(url: str, timeout: int = 8\)/);
  assert.match(mapper, /pool\.map\(fetch, wanted\)/);
});

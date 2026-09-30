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

function settingsFixture(overrides = {}) {
  const row = { id: true, limit_eur_cents: 10000, spent_eur_cents: 0, reserved_eur_cents: 0,
    searcher_enabled: false, controller_enabled: false, searcher_count: 1, controller_count: 1, ...overrides };
  const writes = [];
  const client = { from() { return {
    select() { return { eq() { return { single: async () => ({ data: { ...row } }) }; } }; },
    update(changes) { return { async eq() { writes.push(changes); Object.assign(row, changes); return { error: null }; } }; },
  }; } };
  return { row, writes, service: createKvkApiWorkersService({ getSupabaseClient: () => client, kvkDatabaseSyncToken: 'test-worker-token', env: {} }) };
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

test('robot writes only its own usable finds, via the guarded import, never via a paid route', () => {
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
  assert.match(runner, /import_find\(DB, find\)/);
  const importer = fs.readFileSync(path.join(root, 'scripts/kvk_robot_import.py'), 'utf8');
  assert.match(importer, /WHERE kvk_nummer=\? AND lead_status='unresearched'/);
  const workers = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  assert.match(workers, /variants = \["searcher"\] if role == "searcher" else \["controller-unusable"\]/);
});

test('robot and searchers never research the same company twice', () => {
  const robot = fs.readFileSync(path.join(root, 'scripts/kvk_robot_v5.py'), 'utf8');
  const workers = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  assert.match(robot, /skip = completed \| searcher_claims\(\)/);
  // A short dashboard hiccup never switches the Robot off.
  assert.match(robot, /if transient_control_failure\(error\):\n\s+# A short dashboard hiccup[^\n]*\n\s+time\.sleep\(15\)\n\s+continue/);
  assert.match(workers, /if kvk in in_flight or path\.exists\(\) or robot_busy\(kvk\):/);
  assert.match(workers, /if already_researched\(kvk\):\n\s+# The Robot found this company[^\n]*\n\s+discard_superseded\(path, kvk\)\n\s+return True/);
});

test('worker dialog shows worker errors instead of hiding the reason behind Aan or Uit', () => {
  const js = fs.readFileSync(path.join(root, 'assets/kvk-api-workers.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/kvk-database-redesign.css'), 'utf8');
  assert.doesNotMatch(js, /spentEur \+ state\.budget\.reservedEur/);
  assert.doesNotMatch(js, /reservationLabel|gereserveerd`/);
  assert.match(js, /worker\.blocked \? 'Herstel nodig'/);
  assert.match(js, /control\.status\.textContent = detail/);
  assert.match(js, /worker\.message/);
  const html = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  assert.doesNotMatch(html, /kvk-api-workers-reserved/);
  assert.doesNotMatch(js, /'aangezet' : 'uitgezet'/);
  assert.match(css, /\.latest-treated-panel thead\{display:none\}/);
  assert.match(css, /width:12px;height:12px;padding:0;border:1px solid #d8bdcb/);
});

test('expired in-flight slots preserve the shared money reservation', () => {
 const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260924124059_kvk_api_stale_slot_recovery.sql'), 'utf8');
 assert.match(sql, /created_at > now\(\) - interval '15 minutes'/);
 assert.match(sql, /spent_eur_cents \+ reserved_eur_cents \+ p_reserve_eur_cents <= limit_eur_cents/);
 assert.doesNotMatch(sql, /reserved_eur_cents = reserved_eur_cents -/);
});

test('Searcher maps a saved Luna answer before the apply step looks for it', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  const searcher = runner.slice(runner.indexOf('def luna_search_one'), runner.indexOf('def research_one'));
  assert.ok(searcher.indexOf('to_canonical(') > 0);
  assert.ok(searcher.indexOf('to_canonical(') < searcher.indexOf('if not validate:'),
    'apply_ready_prefix skips a queue head whose mapped result does not exist yet');
});

test('Luna Searcher records mentioned but unkept contacts as rejected for the canonical validator', () => {
  const mapper = fs.readFileSync(path.join(root, 'scripts/kvk_luna_searcher.py'), 'utf8');
  assert.match(mapper, /def withhold_unaccepted_contacts/);
  assert.match(mapper, /"reason_code": "unverified_candidate"/);
  assert.match(mapper, /withhold_unaccepted_contacts\(result, reference/);
});

test('Searcher refills a finished worker at once instead of waiting for the slowest of a batch', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  const pipeline = runner.slice(runner.indexOf('def run_searcher_pipeline'), runner.indexOf('def work('));
  assert.match(pipeline, /return_when=FIRST_COMPLETED/);
  assert.match(pipeline, /apply_searcher_head\(\{"bedrijven": window\}, flags, apply_lock\)/);
  assert.match(pipeline, /pool\.shutdown\(wait=True\)/);
  assert.match(runner, /run\(role, sys.modules\[__name__\], apply_lock\)/);
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

test('Luna Searcher fills a missing contact only from this company\'s own structured data', () => {
  const mapper = fs.readFileSync(path.join(root, 'scripts/kvk_luna_searcher.py'), 'utf8');
  assert.match(mapper, /def structured_contacts\(page: str, company_name: str, kvk: str = ""\)/);
  assert.match(mapper, /own = kvk in identifiers if identifiers else/);
  assert.match(mapper, /if len\(matches\) != 1:/);
});

test('workers dialog has no API budget or API choice; every worker runs via Codex', () => {
  const page = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  assert.doesNotMatch(page, /kvk-api-workers-budget|Besteed bedrag|kvk-api-searcher-engine/);
  const script = fs.readFileSync(path.join(root, 'assets/kvk-api-workers.js'), 'utf8');
  assert.doesNotMatch(script, /budget|apiKeyConfigured|engine/);
  assert.match(script, /control\.button\.disabled = busy;/);
});

test('searchers and controllers start without an API key, even with the old budget used up', async () => {
  const { service, row } = settingsFixture({ spent_eur_cents: 10000, reserved_eur_cents: 3600 });
  for (const role of ['searcher', 'controller']) {
    const res = response();
    await service.setEnabled({ body: { role, enabled: true } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(row[`${role}_enabled`], true);
  }
  const state = response();
  await service.getStatus({}, state);
  assert.equal(state.body.state.workers.searcher.model, 'gpt-6-sol');
  assert.equal(state.body.state.workers.searcher.reasoningEffort, 'xhigh');
  assert.equal(state.body.state.workers.controller.model, 'gpt-6-luna');
  assert.equal(state.body.state.workers.controller.reasoningEffort, 'xhigh');
  assert.equal(state.body.state.budget, undefined);
  assert.equal(state.body.state.apiKeyConfigured, undefined);
});

test('the paid research endpoint never calls OpenAI anymore', async () => {
  let fetchCalls = 0;
  const service = createKvkApiWorkersService({ kvkDatabaseSyncToken: 'token',
    env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl: async () => { fetchCalls += 1; return {}; },
    getSupabaseClient: () => { throw new Error('no database access expected'); } });
  const denied = response();
  await service.research({ headers: {}, body: {} }, denied);
  assert.equal(denied.statusCode, 401);
  const res = response();
  await service.research({ headers: { authorization: 'Bearer token' },
    body: { role: 'searcher', company: { kvk_nummer: '12345678' }, brief: {} } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(fetchCalls, 0);
  const source = fs.readFileSync(path.join(root, 'server/services/kvk-api-workers.js'), 'utf8');
  assert.doesNotMatch(source, /api\.openai\.com|OPENAI_API_KEY|softora_kvk_api_reserve/);
});

test('the local Codex workers receive searcher and controller instructions from the server', async () => {
  const { SEARCHER_INSTRUCTIONS, CONTROLLER_INSTRUCTIONS } = require('../../server/services/kvk-luna-searcher-prompt');
  assert.match(CONTROLLER_INSTRUCTIONS, /Controleer via gratis openbare bronnen/);
  assert.match(CONTROLLER_INSTRUCTIONS, /Bepaal zelf je controleaanpak/);
  assert.match(CONTROLLER_INSTRUCTIONS, /bevestigde telefoon én e-mail; website is optioneel/);
  assert.match(CONTROLLER_INSTRUCTIONS, /Naam of kapotte website alleen is geen afwijsreden/);
  assert.match(CONTROLLER_INSTRUCTIONS, /ketenfilialen.*holdings/);
  assert.match(CONTROLLER_INSTRUCTIONS, /previous_result/);
  assert.match(CONTROLLER_INSTRUCTIONS, /result_schema/);
  assert.match(CONTROLLER_INSTRUCTIONS, /luna_claim/);
  assert.match(CONTROLLER_INSTRUCTIONS, /prior_evidence/);
  assert.match(CONTROLLER_INSTRUCTIONS, /negative_claim/);
  assert.doesNotMatch(CONTROLLER_INSTRUCTIONS, /hoogstens|Werkwijze|Doe dan geen zoekacties|Open eerst/);
  const { row } = settingsFixture();
  const polled = response();
  await createKvkApiWorkersService({ kvkDatabaseSyncToken: 'token', getSupabaseClient: () => ({ from() { return {
    select() { return { eq() { return { single: async () => ({ data: { ...row } }) }; } }; },
  }; } }) }).poll({ headers: { authorization: 'Bearer token' }, body: {} }, polled);
  assert.equal(polled.body.searcherInstructions, SEARCHER_INSTRUCTIONS);
  assert.equal(polled.body.controllerInstructions, CONTROLLER_INSTRUCTIONS);
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  assert.doesNotMatch(runner, /call\("\/research"/);
  assert.match(runner, /"--ignore-user-config", "--ephemeral"/);
});

for (const [role, failure] of [
  ['searcher', 'Gestopt: 12345678: na 2 nieuwe Codex-pogingen weigert de database het antwoord nog'],
  ['controller', 'Gestopt: 87654321: na 3 herstelpogingen nog onvolledig; bewijs bewaard.'],
]) {
  test(`${role} validation exhaustion preserves the switch but blocks further worker requests`, async () => {
    const { service, row } = settingsFixture({ [`${role}_enabled`]: true });
    const headers = { authorization: 'Bearer test-worker-token' };
    await service.report({ headers, body: { role, message: failure, halt: true } }, response());
    assert.equal(row[`${role}_enabled`], true);
    const status = response();
    await service.getStatus({}, status);
    assert.equal(status.body.state.workers[role].enabled, true);
    assert.equal(status.body.state.workers[role].blocked, true);
    assert.equal(status.body.state.workers[role].active, false);
    assert.match(status.body.state.workers[role].message, /^Herstel nodig:/);
    const poll = response();
    await service.poll({ headers }, poll);
    assert.equal(poll.body.state.workers[role].enabled, false);
    assert.equal(row[`${role}_enabled`], true);
    await service.setEnabled({ body: { role, enabled: false } }, response());
    assert.equal(row[`${role}_enabled`], false);
    await service.setEnabled({ body: { role, enabled: true } }, response());
    const restarted = response();
    await service.poll({ headers }, restarted);
    assert.equal(restarted.body.state.workers[role].enabled, true);
    assert.equal(restarted.body.state.workers[role].blocked, false);
  });
}

test('ordinary worker halts and manual stops still turn the switch off', async () => {
  const { service, row } = settingsFixture({ searcher_enabled: true });
  await service.report({ headers: { authorization: 'Bearer test-worker-token' },
    body: { role: 'searcher', halt: true, message: 'Lokale werker gereed; wacht op handmatige start.' } }, response());
  assert.equal(row.searcher_enabled, false);
});


test('worker status retains the validation cause beyond the old 180 character cutoff', async () => {
  const detail = 'Herstel nodig: ' + 'context '.repeat(30) + 'telefoonveld leeg';
  const { service } = settingsFixture({ controller_message: detail });
  const res = response();
  await service.getStatus({}, res);
  assert.equal(res.body.state.workers.controller.message, detail);
  assert.equal(res.body.state.workers.controller.blocked, true);
});

test('report persists a complete validation failure and poll keeps the worker paused', async () => {
  const { service, row } = settingsFixture({ controller_enabled: true });
  const message = 'Herstel nodig: ' + 'context '.repeat(30) + 'telefoonveld leeg';
  await service.report({ headers: { authorization: 'Bearer test-worker-token' },
    body: { role: 'controller', message, halt: true } }, response());
  assert.equal(row.controller_message, message);
  const res = response();
  await service.poll({ headers: { authorization: 'Bearer test-worker-token' } }, res);
  assert.equal(res.body.state.workers.controller.enabled, false);
  assert.equal(res.body.state.workers.controller.blocked, true);
});

test('dialog renders a single error prefix and distinguishes stale workers from running workers', async (t) => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', value: '', events: {},
      addEventListener(name, action) { this.events[name] = action; },
      setAttribute() {}, showModal() { this.open = true; } });
    return elements.get(id);
  };
  const workers = {
    searcher: { enabled: true, blocked: true, message: 'Herstel nodig: Bewijs ontbreekt' },
    controller: { enabled: true, active: false, message: '' },
    robot: { enabled: true, active: true, message: 'Onderzoekt bedrijf' },
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: element } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
    delete require.cache[require.resolve('../../assets/kvk-api-workers.js')];
  });
  t.mock.method(globalThis, 'setInterval', () => {});
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ ok: true, state: { workers } }) }));
  require('../../assets/kvk-api-workers.js');
  element('kvk-api-workers-open').events.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element('kvk-api-searcher-status').textContent, 'Herstel nodig · Bewijs ontbreekt');
  assert.equal(element('kvk-api-controller-status').textContent, 'Wacht op lokale werker');
  assert.equal(element('kvk-api-robot-status').textContent, 'Aan · Onderzoekt bedrijf');
});

test('Searcher uses the agreed goal without a prescribed search route', () => {
  const { SEARCHER_INSTRUCTIONS } = require('../../server/services/kvk-luna-searcher-prompt');
  assert.match(SEARCHER_INSTRUCTIONS, /Bepaal zelf je zoekaanpak/);
  assert.match(SEARCHER_INSTRUCTIONS, /ketenfilialen\/formules/);
  assert.match(SEARCHER_INSTRUCTIONS, /Naam of kapotte website alleen is geen afwijsreden/);
  assert.match(SEARCHER_INSTRUCTIONS, /telefoon én e-mail; website is optioneel/);
  assert.doesNotMatch(SEARCHER_INSTRUCTIONS, /hoogstens|Werkwijze|site:|zoekacties/);
  assert.ok(SEARCHER_INSTRUCTIONS.length < 1600);
});


test('startup isolates results from other prompts before launching any worker', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  const startup = runner.slice(runner.indexOf('def main()'));
  assert.ok(startup.indexOf('quarantine_stale(') < startup.indexOf('threading.Thread('));
  assert.match(runner, /stamp\(path, contract\(\*CODEX_MODELS/);
  assert.match(runner, /"\.recovery\.json", "\.contract\.json"/);
});


test('both worker roles use per-result streaming with guarded completion order', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/kvk_api_workers.py'), 'utf8');
  const work = runner.slice(runner.indexOf('def work('), runner.indexOf('def main('));
  assert.match(work, /from kvk_worker_stream import run/);
  assert.doesNotMatch(work, /research_batch/);
  assert.match(runner, /child_env\["SOFTORA_KVK_COMPLETION_ORDER"\] = "1"/);
});

test('validated drafts carry producer metadata before canonical apply', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/contact_validate_apply.py'), 'utf8');
  assert.ok(source.indexOf('copy_execution_metadata(args.source, draft)') < source.indexOf('research.command_apply(apply_args)'));
  assert.match(source, /precheck\.validated_draft_path\(args\.source\)/);
});


test('single-company failures do not reach the group halt handler', () => {
  const stream = fs.readFileSync(path.join(root, 'scripts/kvk_worker_stream.py'), 'utf8');
  assert.match(stream, /except failures.CompanyFailure as error/);
  assert.match(stream, /failures.record\(path, error\)/);
  assert.doesNotMatch(stream, /halt=True/);
});

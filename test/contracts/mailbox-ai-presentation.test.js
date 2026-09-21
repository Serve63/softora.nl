const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const contract = require('../../assets/premium-mailbox-ai-presentation');
const { buildSource, buildRequest, createMailboxAiClassifier } = require('../../server/services/mailbox-ai-classifier');
const { createMailboxAiPresentations } = require('../../server/services/mailbox-ai-presentations');
const { createMailboxMessageResponse } = require('../../server/services/mailbox-message-response');
const { create: createRefresh } = require('../../assets/premium-mailbox-ai-refresh');
const body = 'Goedemorgen,\nDe offerte bedraagt EUR 1.250. Zie https://example.nl/offerte\nMet vriendelijke groet, cordiali saluti,\nRobin Voorbeeld | Voorbeeldbedrijf\nT +31 6 12345678 <tel:+31612345678>\nScheepersdijk 48\n5062 ED Oisterwijk\nPrint deze mail alleen indien nodig.\nMorgen om 10 uur past voor mij.\n> Vorige reactie';
const decision = { labels: ['authored','authored','signature','signature','signature','signature','signature','signature','authored','quote'],
  contacts: [{ line: 4, kind: 'phone', text: '+31 6 12345678' }, { line: 5, kind: 'address', text: 'Scheepersdijk 48' }, { line: 6, kind: 'address', text: '5062 ED Oisterwijk' }] };
const message = { id: 'inbox:1', messageKey: 'account:inbox:1', body, accountEmail: 'owner@example.nl', email: 'robin@example.nl', from: 'Robin', folder: 'inbox' };
const ready = { ...message, aiPresentation: { version: contract.VERSION, model: contract.MODEL, reasoningEffort: 'max', status: 'ready', sourceBody: body, decision } };
test('offline decision fixture keeps original authored text and only literal sender contacts; root/thread agree', () => {
  const original = structuredClone(ready);
  const presentation = require('../../assets/premium-mailbox-message-presentation').create({ isSentMessageByProvenance: () => false,
    display: { normalizePresentationText: () => { throw new Error('second filtering forbidden'); } } });
  const root = presentation.getRootPresentation(body, ready), thread = presentation.getThreadPresentation(ready, ready);
  assert.equal(root.body, thread.body);
  assert.match(root.body, /EUR 1.250/); assert.match(root.body, /Morgen om 10 uur/);
  assert.doesNotMatch(root.body, /Robin|Print deze|Vorige reactie/);
  const html = []; root.appendContact(html); root.appendContact(html);
  assert.equal(html.join(''), thread.contactHtml);
  assert.match(html[0], /<div>5062 ED Oisterwijk<\/div>/);
  assert.match(html[0], /\+31 6 12345678/);
  assert.deepEqual(ready, original);
});
test('incomplete, stale, incompatible and invalid decisions display the complete source', () => {
  for (const patch of [{ status: 'pending' }, { status: 'unavailable' }, { version: 'future' }, { sourceBody: 'old' }, { model: 'other' },
    { reasoningEffort: 'low' }, { decision: { labels: ['signature'], contacts: [] } }]) {
    assert.equal(contract.read({ ...ready, aiPresentation: { ...ready.aiPresentation, ...patch } }).body, body);
  }
  assert.equal(contract.validate(body, { ...decision, labels: decision.labels.map(() => 'signature') }), false);
  for (const contact of [{ line: 9, kind: 'address', text: 'Vorige reactie' }, { line: 5, kind: 'address', text: 'Noord Brabant' },
    { line: 4, kind: 'phone', text: '      ' }]) assert.equal(contract.validate(body, { ...decision, contacts: [contact] }), false);
});
test('selected source renders safely and body links remain clickable without legacy cleaning', () => {
  const html = contract.renderBody(['<img src=x onerror=alert(1)>', 'https://example.nl/x', 'Print deze e-mail is mijn verzoek']);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/); assert.match(html, /href="https:\/\/example.nl\/x"/);
  assert.match(html, /Print deze e-mail is mijn verzoek/);
});
test('provider contract pins Luna/max, strict structured output and refuses unbounded sources', async () => {
  const source = buildSource(message), request = buildRequest(source);
  assert.equal(request.model, 'gpt-5.6-luna'); assert.equal(request.reasoning.effort, 'max'); assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true); assert.equal(request.tools, undefined);
  assert.notEqual(source.id, buildSource({ ...message, accountEmail: 'other@example.nl' }).id);
  assert.notEqual(source.id, buildSource({ ...message, body: body + '\nnew' }).id);
  assert.equal(buildSource({ ...message, direction: 'sent' }), null);
  assert.equal(buildSource({ ...message, body: 'x\n'.repeat(601) }), null);
  assert.equal(buildSource({ ...message, bodyTruncated: true }), null);
  let calls = 0;
  const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', fetchImpl: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.deepEqual(JSON.parse(init.body), request);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }] }) };
  } });
  assert.deepEqual((await classifier.classify(source)).decision, decision); assert.equal(calls, 1);
});
test('provider timeout, refusal, malformed JSON and incomplete output never retry', async () => {
  for (const result of [null, { status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'bad' }] }] }]) {
    let calls = 0;
    const classifier = createMailboxAiClassifier({ getApiKey: () => 'secret', fetchImpl: async () => { calls++; if (!result) throw new Error('timeout'); return { ok: true, json: async () => result }; } });
    await assert.rejects(classifier.classify(buildSource(message))); assert.equal(calls, 1);
  }
});
test('feature is dormant by default; reads never call model; nested current messages share source-safe result', async () => {
  const no = () => { throw new Error('must not call'); };
  const disabled = createMailboxAiPresentations({ repository: { enqueue: no }, classifier: { classify: no } });
  const messages = [message]; assert.equal(await disabled.enrich(messages), messages); assert.equal(await disabled.enrichTree(messages), messages);
  assert.deepEqual(await disabled.processQueue(), { skipped: true, processed: 0 });
  let calls = 0;
  const enabled = createMailboxAiPresentations({ env: { MAILBOX_AI_PRESENTATION_ENABLED: 'true' }, classifier: { classify: no },
    repository: { enqueue: async (sources) => { calls++; return sources.map((s) => ({ id: s.id, status: 'ready', decision })); } } });
  const tree = await enabled.enrichTree([{ ...message, threadMessages: [{ ...message, accountEmail: undefined }] }]);
  assert.equal(calls, 1); assert.equal(tree[0].threadMessages[0].aiPresentation.status, 'ready');
  assert.equal(message.aiPresentation, undefined); assert.equal(tree[0].body, body);
});
test('storage failures and oversized inputs preserve original rather than falling into old stripping', async () => {
  const service = createMailboxAiPresentations({ env: { MAILBOX_AI_PRESENTATION_ENABLED: 'true' }, logger: { warn() {} },
    repository: { enqueue: async () => { throw new Error('db down'); } } });
  const result = await service.enrich([message, { ...message, body: 'x'.repeat(60001) }]);
  for (const mail of result) assert.equal(contract.read(mail).body, mail.body);
});
test('worker never calls model without durable budget claim and does not retry a failed call', async () => {
  let calls = 0, claims = 0, finished = 0;
  const service = createMailboxAiPresentations({ env: { MAILBOX_AI_PRESENTATION_ENABLED: 'true' }, getOpenAiApiKey: () => 'secret', logger: { warn() {} },
    repository: { candidates: async () => [], enqueue: async () => [], claim: async () => ++claims === 1 ? { source: buildSource(message) } : null,
      finish: async (_job, result) => { finished++; assert.equal(result, null); } }, classifier: { classify: async () => { calls++; throw new Error('timeout'); } } });
  assert.deepEqual(await service.processQueue(), { processed: 1 }); assert.equal(calls, 1); assert.equal(finished, 1);
  await service.processQueue(); assert.equal(calls, 1);
});
test('detail handler preserves canonical body, applies account scope and excludes source HTML', async () => {
  let payload;
  const handler = createMailboxMessageResponse({ getMessage: async () => ({ ...message, sourceHtml: '<b>private evidence</b>' }),
    enrich: async (rows) => rows.map((row) => ({ ...row, aiPresentation: ready.aiPresentation })), logger: console });
  await handler({ query: { account: message.accountEmail } }, { status: () => ({ json: (value) => { payload = value; } }) });
  assert.equal(payload.message.body, body); assert.equal(payload.message.sourceHtml, undefined); assert.equal(payload.message.aiPresentation.status, 'ready');
});
test('pending cache becomes ready without body loading and never updates a switched owner', async () => {
  for (const switchOwner of [false, true]) {
    const mail = { ...message, aiPresentation: { status: 'pending' } }; let owner = 'serve', callback, opens = 0;
    const refresh = createRefresh({ getMail: () => mail, getActiveId: () => mail.id, getOwner: () => owner,
      schedule: (fn) => { callback = fn; return 1; }, cancel() {}, openMail: async (_id, options) => { opens++; assert.equal(options.skipBodyFetch, true); },
      fetchImpl: async () => { if (switchOwner) owner = 'martijn'; return { ok: true, json: async () => ({ ok: true, messages: [ready] }) }; } });
    refresh.watch(mail); await callback(); assert.equal(opens, switchOwner ? 0 : 1); assert.equal(mail.body, body); assert.equal(mail.bodyLoading, undefined); refresh.stop();
  }
});
test('SQL migration actually fences access, reserves budget before claims and prevents duplicate spending', async () => {
  const { PGlite } = require('@electric-sql/pglite'); const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.softora_mailbox_messages (folder text, has_body boolean, body_truncated boolean, deleted_at timestamptz,
        generation_superseded_at timestamptz, body_text text, sender_email text, account_email text, payload jsonb,
        message_key text, message_id text, sender_name text, date timestamptz);`);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260921093527_mailbox_luna_presentations.sql'), 'utf8'));
    await db.query("insert into softora_mailbox_ai_presentations (id,version,account_email,message_key,source) values ('a','mailbox-luna-v1','a','a','{}'),('b','mailbox-luna-v1','a','b','{}')");
    const claim = "select * from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')";
    assert.equal((await db.query(claim)).rows.length, 0);
    await db.exec("set role anon"); await assert.rejects(db.query(claim), /permission denied/); await assert.rejects(db.query('select * from softora_mailbox_ai_presentations'), /permission denied/);
    await db.exec("reset role; update softora_mailbox_ai_budget set approved_micro_usd=50000; set role service_role");
    const results = await Promise.all([db.query(claim), db.query(claim)]); assert.equal(results.reduce((n,r) => n+r.rows.length,0), 1);
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd), 50000);
    assert.equal((await db.query(claim)).rows.length, 0);
  } finally { await db.close(); }
});
test('processing route rejects missing and incorrect cron credentials before any worker call', async () => {
  const { registerMailboxRoutes } = require('../../server/routes/mailbox');
  for (const secret of ['', 'test-secret']) {
    const routes = new Map(); let calls = 0;
    registerMailboxRoutes({ get: (path, ...handlers) => routes.set(path, handlers), post() {} }, {
      cronSecret: secret, coordinator: { processAiPresentations: async () => { calls++; return { skipped: true, processed: 0 }; } },
    });
    const [guard, handler] = routes.get('/api/mailbox/presentation/process'); let status;
    const res = { status: (code) => { status = code; return res; }, json: () => {} };
    guard({ headers: { authorization: 'Bearer wrong' } }, res, () => { throw new Error('unauthorized worker'); });
    assert.equal(calls, 0); assert.equal(status, secret ? 401 : 503);
    if (secret) { await guard({ headers: { authorization: `Bearer ${secret}` } }, res, () => handler({}, res)); assert.equal(calls, 1); }
  }
});
test('cached reads do not rewrite source or fetch full source payload; inserts are idempotent and bounded', async () => {
  const { createMailboxAiRepository } = require('../../server/repositories/mailbox-ai-presentations');
  const rows = new Map(); let writes = 0, maxBatch = 0;
  const repository = createMailboxAiRepository({ getClient: () => ({ from: () => ({
    select: (columns) => { assert.equal(columns.includes('source'), false); return { in: (_key, ids) => {
      maxBatch = Math.max(maxBatch, ids.length); return Promise.resolve({ data: ids.filter((id) => rows.has(id)).map((id) => rows.get(id)) });
    } }; },
    upsert: async (items, options) => { writes++; assert.equal(options.ignoreDuplicates, true);
      for (const item of items) if (!rows.has(item.id)) rows.set(item.id, item); return { data: null }; },
  }) }) });
  const sources = Array.from({ length: 85 }, (_, i) => ({ ...buildSource({ ...message, id: String(i), messageKey: String(i) }), messageKey: String(i) }));
  assert.equal((await repository.enqueue(sources)).length, 85); assert.equal(writes, 3); assert.equal(maxBatch, 40);
  await repository.enqueue(sources); assert.equal(writes, 3);
});

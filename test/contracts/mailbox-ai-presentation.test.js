const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const contract = require('../../assets/premium-mailbox-ai-presentation');
const { buildSource, buildRequest, createMailboxAiClassifier, CLASSIFICATION_TIMEOUT_MS, RESERVATION_MICRO_USD } = require('../../server/services/mailbox-ai-classifier');
const { createMailboxAiPresentations } = require('../../server/services/mailbox-ai-presentations');
const { createMailboxMessageResponse } = require('../../server/services/mailbox-message-response');
const { create: createRefresh } = require('../../assets/premium-mailbox-ai-refresh');
const body = 'Goedemorgen,\nDe offerte bedraagt EUR 1.250. Zie https://example.nl/offerte\nMet vriendelijke groet, cordiali saluti,\nRobin Voorbeeld | Voorbeeldbedrijf\nT +31 6 12345678 <tel:+31612345678>\nScheepersdijk 48\n5062 ED Oisterwijk\nPrint deze mail alleen indien nodig.\nMorgen om 10 uur past voor mij.\n> Vorige reactie';
const decision = { labels: ['authored','authored','signature','signature','signature','signature','signature','signature','authored','quote'],
  contacts: [{ line: 4, kind: 'phone', text: '+31 6 12345678' }, { line: 5, kind: 'address', text: 'Scheepersdijk 48' }, { line: 6, kind: 'address', text: '5062 ED Oisterwijk' }] };
const selection = (value) => ({ signatureLines: value.labels.flatMap((label, i) => label === 'signature' ? [i] : []), contacts: value.contacts });
const message = { id: 'inbox:1', messageKey: 'account:inbox:1', body, accountEmail: 'owner@example.nl', email: 'robin@example.nl', from: 'Robin', folder: 'inbox' };
const ready = { ...message, aiPresentation: { version: contract.VERSION, model: contract.MODEL, reasoningEffort: 'max', status: 'ready', sourceBody: body, decision } };
test('offline decision fixture keeps original authored text and only literal sender contacts; root/thread agree', () => {
  const original = structuredClone(ready);
  const presentation = require('../../assets/premium-mailbox-message-presentation').create({ isSentMessageByProvenance: () => false,
    display: { normalizePresentationText: () => { throw new Error('second filtering forbidden'); } } });
  const root = presentation.getRootPresentation(body, ready), thread = presentation.getThreadPresentation(ready, ready);
  assert.equal(root.body, thread.body);
  assert.match(root.body, /EUR 1.250/); assert.match(root.body, /Morgen om 10 uur/);
  assert.doesNotMatch(root.body, /Robin|Print deze/); assert.match(root.body, /> Vorige reactie/);
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
  assert.equal(request.max_output_tokens, 16384);
  assert.ok(2 * (100000 * 0.25 + request.max_output_tokens * 1.2) < RESERVATION_MICRO_USD);
  assert.notEqual(source.id, buildSource({ ...message, accountEmail: 'other@example.nl' }).id);
  assert.notEqual(source.id, buildSource({ ...message, body: body + '\nnew' }).id);
  assert.equal(buildSource({ ...message, direction: 'sent' }), null);
  assert.equal(buildSource({ ...message, body: 'x\n'.repeat(601) }), null);
  assert.equal(buildSource({ ...message, bodyTruncated: true }), null);
  let calls = 0;
  const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', fetchImpl: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); if (calls === 1) assert.deepEqual(JSON.parse(init.body), request);
    const value = calls === 1 ? selection(decision) : { safeToRemove: decision.labels.flatMap((label, i) => label === 'signature' ? [i] : []) };
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) };
  } });
  assert.deepEqual((await classifier.classify(source)).decision, { ...decision, labels: decision.labels.map((label) => label === 'quote' ? 'authored' : label) }); assert.equal(calls, 2);
});
test('provider timeout, refusal, malformed JSON and incomplete output never retry', async () => {
  for (const result of [null, { status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'bad' }] }] }]) {
    let calls = 0;
    const classifier = createMailboxAiClassifier({ getApiKey: () => 'secret', fetchImpl: async () => { calls++; if (!result) throw new Error('timeout'); return { ok: true, json: async () => result }; } });
    await assert.rejects(classifier.classify(buildSource(message))); assert.equal(calls, 1);
  }
});
test('background classification allows slow max reasoning within the worker runtime without retrying', async (t) => {
  let calls = 0; const noFooter = { labels: decision.labels.map(() => 'authored'), contacts: [] };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    assert.equal(ms, 120000); const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('deadline')), ms); return controller.signal;
  });
  const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.signal.aborted, false);
    await new Promise((resolve, reject) => {
      setTimeout(resolve, 60000); init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(selection(noFooter)) }] }] }) };
  } });
  const pending = classifier.classify(buildSource(message)); t.mock.timers.tick(60000);
  assert.deepEqual((await pending).decision, noFooter); assert.equal(calls, 1);
  const config = JSON.parse(fs.readFileSync(require.resolve('../../vercel.json'), 'utf8'));
  assert.ok(4 * CLASSIFICATION_TIMEOUT_MS + 30000 < config.functions['api/[...path].js'].maxDuration * 1000);
});
test('aborting a pending provider request preserves source through the worker fallback and never retries', async () => {
  let calls = 0;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', timeoutMs: 5,
      fetchImpl: async (_url, init) => { calls++; return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }); } });
    await assert.rejects(classifier.classify(buildSource(message)), { name: 'TimeoutError' });
    assert.equal(calls, 1); assert.equal(contract.read({ ...message, aiPresentation: { status: 'unavailable' } }).body, body);
  } finally { clearTimeout(keepAlive); }
});
test('forwarded signature removal retains provenance and substantive quotes, without third-party contact cards', () => {
  const source = 'Please use these requirements.\nFrom: Alex <alex@example.org>\n> Deliver on Friday.\n> Best regards,\n> Alex\n> Tel: 06 98 76 54 32';
  const classified = { labels: ['authored', 'uncertain', 'quote', 'signature', 'signature', 'signature'], contacts: [] };
  const result = contract.read({ body: source, aiPresentation: { ...ready.aiPresentation, sourceBody: source, decision: classified } });
  assert.equal(result.body, source.split('\n').slice(0, 3).join('\n'));
  assert.deepEqual(result.contact, { beforeLines: [], addressLines: [] });
});
test('removal review can only restore candidate text; it cannot delete additional lines or duplicate restored contacts', async () => {
  const sample = 'Gebruik deze voorbeeldhandtekening:\nGroeten,\nSam\nTel: 06 12 34 56 78\nDit hele blok hoort bij mijn verzoek.\nGroet,\nRobin';
  const proposed = { labels: ['authored','signature','signature','signature','authored','signature','signature'], contacts: [{ line: 3, kind: 'phone', text: '06 12 34 56 78' }] };
  let calls = 0;
  const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', fetchImpl: async (_url, init) => {
    calls++; const request = JSON.parse(init.body);
    assert.equal(request.model, contract.MODEL); assert.equal(request.reasoning.effort, 'max'); assert.equal(request.store, false);
    if (calls === 2) assert.deepEqual(JSON.parse(request.input).candidates, [1,2,3,5,6]);
    return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 10, output_tokens: 20 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(calls === 1 ? selection(proposed) : { safeToRemove: [5,6] }) }] }] }) };
  } });
  const result = await classifier.classify(buildSource({ ...message, body: sample }));
  assert.equal(calls, 2); assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 40 });
  assert.equal(contract.read({ body: sample, aiPresentation: { ...ready.aiPresentation, sourceBody: sample, decision: result.decision } }).body, sample.split('\n').slice(0,5).join('\n'));
  assert.deepEqual(result.decision.contacts, []); assert.deepEqual(proposed.contacts, [{ line: 3, kind: 'phone', text: '06 12 34 56 78' }]);
  const { applyRemovalReview } = require('../../server/services/mailbox-ai-removal-review');
  for (const safeToRemove of [[0], [99], [-1], [1,1], ['1'], null]) assert.throws(() => applyRemovalReview(proposed, { safeToRemove }), /INVALID_REVIEW/);
});
test('failed second review never releases an unreviewed first selection or starts a third paid request', async () => {
  let calls = 0;
  const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', fetchImpl: async () => {
    calls++; if (calls === 2) throw new Error('review unavailable');
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(selection(decision)) }] }] }) };
  } });
  await assert.rejects(classifier.classify(buildSource(message)), /review unavailable/); assert.equal(calls, 2);
});
test('selection indices retain original positions across blank lines and reject invalid removals before review', async () => {
  const source = buildSource({ ...message, body: 'Hoi,\n\nEen inhoudelijk verzoek.\n\nRobin' });
  assert.deepEqual(JSON.parse(buildRequest(source).input).lines.map((row) => row.line), [0,2,4]);
  for (const signatureLines of [[1], [5], [-1], [4,4], ['4']]) {
    let calls = 0;
    const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-secret', fetchImpl: async () => {
      calls++; return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ signatureLines, contacts: [] }) }] }] }) };
    } });
    await assert.rejects(classifier.classify(source), /MAILBOX_AI_INVALID_RESULT/); assert.equal(calls, 1);
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
  let calls = 0, claims = 0, finished = 0; const warnings = [];
  const service = createMailboxAiPresentations({ env: { MAILBOX_AI_PRESENTATION_ENABLED: 'true' }, getOpenAiApiKey: () => 'secret', logger: { warn(...args) { warnings.push(args); } },
    repository: { candidates: async () => [], enqueue: async () => [], claim: async () => ++claims === 1 ? { source: buildSource(message) } : null,
      finish: async (_job, result) => { finished++; assert.equal(result, null); } }, classifier: { classify: async () => { calls++; throw new Error('private provider content'); } } });
  assert.deepEqual(await service.processQueue(), { processed: 1 }); assert.equal(calls, 1); assert.equal(finished, 1);
  assert.equal(warnings[0][1].code, 'MAILBOX_AI_REQUEST_FAILED'); assert.doesNotMatch(JSON.stringify(warnings), /private provider content/);
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
    await db.exec("reset role; update softora_mailbox_ai_budget set approved_micro_usd=100000; set role service_role");
    const results = await Promise.all([db.query(claim), db.query(claim)]); assert.equal(results.reduce((n,r) => n+r.rows.length,0), 1);
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd), 100000);
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
test('phone validation accepts Unicode spacing/dashes without changing source contact text', () => {
  for (const phone of ['06\u00a012\u00a034\u00a056\u00a078', '+31\u202f6\u201112345678', '０６ １２ ３４ ５６ ７８']) {
    const body = `Ja, dat is akkoord.\n${phone}`;
    const decision = { labels: ['authored','signature'], contacts: [{ line: 1, kind: 'phone', text: phone }] };
    assert.equal(contract.validate(body, decision), true);
    const view = contract.read({ body, aiPresentation: { ...ready.aiPresentation, sourceBody: body, decision } });
    assert.equal(view.contact.beforeLines[0], `Tel: ${phone}`);
  }
  const long = '1234567890123456';
  assert.equal(contract.validate(`Akkoord\n${long}`, { labels: ['authored','signature'], contacts: [{ line: 1, kind: 'phone', text: long }] }), false);
});

test('real Luna quote misclassification cannot remove forwarded requirements from root or thread', () => {
  const source = 'Servé, hieronder staan de eisen van onze klant; verwerk deze allemaal.\n--- Doorgestuurd bericht van Alex ---\nVoor de nieuwe website hebben we drie talen nodig.\nDe eerste oplevering moet uiterlijk 15 oktober plaatsvinden.\nHet formulier moet een veld voor het ordernummer hebben.\nMet vriendelijke groet,\nRobin Voorbeeld';
  const observed = { labels: ['authored','uncertain','quote','quote','quote','signature','signature'], contacts: [] };
  const message = { body: source, aiPresentation: { ...ready.aiPresentation, sourceBody: source, decision: observed } };
  const presentation = require('../../assets/premium-mailbox-message-presentation').create({ isSentMessageByProvenance: () => false });
  for (const result of [presentation.getRootPresentation(source, message), presentation.getThreadPresentation(message, message)]) {
    assert.equal(result.body, source.split('\n').slice(0, 5).join('\n'));
    assert.equal(result.aiManaged, true);
  }
  assert.equal(message.body, source);
});

test('isolated internal signature labels cannot hide contextual attribution between kept paragraphs', () => {
  const body = 'Hieronder staan de eisen; verwerk ze allemaal.\n--- Bericht van Alex ---\nLever op 15 oktober.\nGroet,\nRobin';
  const decision = { labels: ['authored','signature','authored','signature','signature'], contacts: [] };
  const result = contract.read({ body, aiPresentation: { ...ready.aiPresentation, sourceBody: body, decision } });
  assert.equal(result.body, body.split('\n').slice(0,3).join('\n'));
});

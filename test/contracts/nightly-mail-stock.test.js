const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { localNight, inventory, OWNER_KEY, budgetChargeCents, assertApprovedImageRequest, createNightlyMailStockService } = require('../../server/services/nightly-mail-stock');
const { runPremiumDatabaseWebdesignBatchWorker, sendBatchWorkerResponse } = require('../../server/services/premium-database-webdesign-batch-worker');

const customer = (id, provider = 'softora') => ({ id, bedrijf: `Company ${id}`, email: `${id}@${id}.example`, dom: `${id}.example`, webdesignMailProvider: provider });
const snapshot = (ready = [], available = [], instantlyReady = []) => ({ ok: true, customers: ready, availableCustomers: available, instantlyReadyCustomers: instantlyReady });
const silent = { info() {}, warn() {}, error() {} };
async function approvedRequest() {
  const png = await require('sharp')({ create: { width: 12, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return { imageModel: 'gpt-image-2.5-sunburst', imageSize: '1024x1536', imageQuality: 'medium', prompt: 'Test preview',
    referenceImages: [{ dataUrl: `data:image/png;base64,${png.toString('base64')}` }] };
}

test('midnight uses Amsterdam local time in summer and winter, including the DST change', () => {
  assert.deepEqual(localNight('2026-10-01T22:00:00Z'), { day: '2026-10-02', hour: 0 });
  assert.deepEqual(localNight('2026-12-01T23:00:00Z'), { day: '2026-12-02', hour: 0 });
  assert.deepEqual(localNight('2026-10-25T22:59:59Z'), { day: '2026-10-25', hour: 23 });
  assert.deepEqual(localNight('2026-10-25T23:00:00Z'), { day: '2026-10-26', hour: 0 });
});

test('inventory deduplicates identities across providers and counts running designs without an email in the job', () => {
  const one = customer('one'), pending = customer('pending', 'instantly');
  const stock = inventory(snapshot([one], [pending], [{ ...one, id: 'alias', webdesignMailProvider: 'instantly' }]), [
    { payload: { customer: { id: 'pending', bedrijf: pending.bedrijf, dom: pending.dom, webdesignMailProvider: 'instantly' } } },
    { payload: { kind: 'bulk_webdesign_chunk', targets: [{ customer: pending, status: 'pending' }] } },
  ]);
  assert.deepEqual(stock.ready, { softora: 1, instantly: 0 });
  assert.deepEqual(stock.pending, { softora: 0, instantly: 1 });
});

function fixture(stock, time = '2026-10-01T22:00:00Z') {
  const control = { enabled: true, softora_target: 200, instantly_target: 200, approved_cents: 100000, held_cents: 0, charged_cents: 0 };
  const plans = [], batches = [], chunks = [];
  const store = {
    readControl: async () => control, readActiveJobs: async () => [], readPlan: async () => plans,
    reconcile: async () => ({ ok: true }),
    allocate: async (row, provider, keys) => { if (plans.some(p => p.customer.id === row.id)) return { allocated: false }; plans.push({ customer: row, provider, identity_keys: keys, status: 'planned' }); return { allocated: true }; },
    recordCheck: async (day, result) => { control.last_check_day = day; control.last_result = result; },
    reserve: async () => ({ reserved: true }), settle: async () => ({ settled: true }),
  };
  const dataOpsStore = {
    getWebdesignBatch: async () => batches.at(-1) || null,
    listWebdesignBatchChunks: async () => chunks,
    upsertWebdesignBatch: async (value) => { batches.push(value); return { ok: true }; },
    upsertWebdesignBatchChunk: async (value) => { const at = chunks.findIndex(c => c.index === value.index); if (at >= 0) chunks[at] = value; else chunks.push(value); return { ok: true }; },
    listOutboundRecipientGuardKeys: async () => [],
  };
  const service = createNightlyMailStockService({ store, dataOpsStore, snapshotService: { invalidate() {}, buildMailReadySnapshot: async () => stock },
    now: () => Date.parse(control.testTime || time), logger: silent, imageModel: 'gpt-image-2.5-sunburst' });
  return { service, control, plans, batches, chunks, store, dataOpsStore };
}

test('midnight divides unassigned companies between both deficits and cannot create another batch', async () => {
  const ready = Array.from({ length: 198 }, (_, i) => customer(`s${i}`));
  const instantly = Array.from({ length: 199 }, (_, i) => customer(`i${i}`, 'instantly'));
  const f = fixture(snapshot(ready, [customer('sa'), customer('sb'), customer('sc'), customer('ia', 'instantly'), customer('ib', 'instantly')], instantly));
  const result = await f.service.runDueCheck();
  assert.deepEqual(result.added, { softora: 2, instantly: 1 });
  assert.deepEqual(result.missing, { softora: 0, instantly: 0 });
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].ownerKey, OWNER_KEY);
  assert.equal(f.batches[0].total, 3);
  assert.equal(f.chunks[0].targets[2].customer.webdesignMailProvider, 'instantly');
  assert.equal(f.plans[2].customer.id, 'sc');
  assert.equal((await f.service.runDueCheck()).reason, 'check_cooldown');
  assert.equal(f.plans.length, 3);
});

test('a full pool never generates extra work and a source shortage remains an explicit shortage', async () => {
  const f = fixture(snapshot(Array.from({ length: 205 }, (_, i) => customer(`s${i}`)), [{ ...customer('sa'), hasPhoto: true }, customer('ia', 'instantly')]));
  const result = await f.service.runDueCheck();
  assert.deepEqual(result.added, { softora: 0, instantly: 1 });
  assert.deepEqual(result.missing, { softora: 0, instantly: 199 });
});

test('outside midnight, disabled automation, or unavailable inventory never creates a batch', async () => {
  const f = fixture(snapshot([], [customer('sa')]), '2026-10-01T21:59:59Z');
  assert.equal((await f.service.runDueCheck()).reason, 'outside_midnight_hour');
  assert.equal(f.plans.length, 0);
  const disabled = fixture(snapshot([], [customer('sa')]));
  disabled.control.enabled = false;
  assert.equal((await disabled.service.runDueCheck()).reason, 'disabled');
  const broken = fixture({ ok: false });
  assert.equal((await broken.service.runDueCheck()).ok, false);
  assert.equal(broken.plans.length, 0);
  assert.equal(broken.control.last_check_day, undefined);
});

test('a completed night starts again the next Amsterdam midnight after stock is consumed', async () => {
  const stock = snapshot(Array.from({ length: 200 }, (_, i) => customer(`s${i}`)), [],
    Array.from({ length: 200 }, (_, i) => customer(`i${i}`, 'instantly')));
  const f = fixture(stock);
  assert.equal((await f.service.runDueCheck()).status, 'complete');
  assert.equal((await f.service.runDueCheck()).reason, 'already_checked');
  stock.customers.pop();
  stock.availableCustomers.push(customer('next-night'));
  f.control.testTime = '2026-10-02T22:00:00Z';
  const next = await f.service.runDueCheck();
  assert.equal(next.day, '2026-10-03');
  assert.equal(next.batchId, 'mail_stock_20261003');
  assert.deepEqual(next.added, { softora: 1, instantly: 0 });
  assert.equal(next.status, 'replenishing');
  assert.equal((await f.service.runDueCheck()).reason, 'check_cooldown');
  assert.equal(f.plans.length, 1);
});

test('an outage spanning midnight is caught up after recovery without duplicate plans', async () => {
  const stock = snapshot([], [customer('catch-up')]);
  const f = fixture(stock);
  f.control.softora_target = 1; f.control.instantly_target = 0;
  f.control.last_check_day = '2026-10-01';
  f.control.last_result = { status: 'complete', checkedAt: '2026-09-30T22:00:00Z' };
  let outage = true;
  f.store.reconcile = async () => { if (outage) throw new Error('database unavailable'); return { ok: true }; };
  assert.equal((await f.service.runDueCheck()).reason, 'stock_check_unavailable');
  assert.equal(f.control.last_check_day, '2026-10-01');
  outage = false;
  f.control.testTime = '2026-10-02T05:15:00Z'; // 07:15 Amsterdam; the whole midnight hour was missed.
  const recovered = await f.service.runDueCheck();
  assert.equal(recovered.status, 'replenishing');
  assert.equal(recovered.day, '2026-10-02');
  assert.equal(recovered.added.softora, 1);
  assert.equal(f.plans.length, 1);
  assert.equal((await f.service.runDueCheck()).reason, 'check_cooldown');
  stock.customers.push(stock.availableCustomers.pop());
  f.plans[0].status = 'charged';
  f.chunks[0].targets[0].status = 'done';
  f.control.testTime = '2026-10-02T05:25:00Z';
  assert.equal((await f.service.runDueCheck()).status, 'complete');
  assert.equal((await f.service.runDueCheck()).reason, 'already_checked');
  assert.equal(f.plans.length, 1);
});

test('seven nights survive scheduler restarts and the switch from summer to winter time', async () => {
  const nights = ['2026-10-22T22:00:00Z', '2026-10-23T22:00:00Z', '2026-10-24T22:00:00Z',
    '2026-10-25T23:00:00Z', '2026-10-26T23:00:00Z', '2026-10-27T23:00:00Z', '2026-10-28T23:00:00Z'];
  let checkpoint = {};
  const batchIds = new Set();
  for (let index = 0; index < nights.length; index++) {
    const stock = snapshot([customer('base')], [customer(`night-${index}`)]);
    const f = fixture(stock, nights[index]); // Recreate the service; restore its durable day checkpoint.
    Object.assign(f.control, checkpoint, { softora_target: 2, instantly_target: 0 });
    const start = await f.service.runDueCheck();
    assert.equal(start.day, `2026-10-${23 + index}`);
    assert.equal(start.added.softora, 1);
    assert.equal(batchIds.has(start.batchId), false);
    batchIds.add(start.batchId);
    assert.equal((await f.service.runDueCheck()).reason, 'check_cooldown');
    stock.customers.push(stock.availableCustomers.pop());
    f.plans[0].status = 'charged'; f.chunks[0].targets[0].status = 'done';
    f.control.testTime = new Date(Date.parse(nights[index]) + 10 * 60000).toISOString();
    assert.equal((await f.service.runDueCheck()).status, 'complete');
    assert.equal((await f.service.runDueCheck()).reason, 'already_checked');
    assert.equal(f.plans.length, 1);
    checkpoint = { last_check_day: f.control.last_check_day, last_result: f.control.last_result };
  }
  assert.equal(batchIds.size, 7);
});

test('an interrupted plan is resumed before marking the day checked', async () => {
  const f = fixture(snapshot([], [customer('sa')]));
  let failing = true;
  f.dataOpsStore.upsertWebdesignBatchChunk = async (chunk) => { if (failing) return { ok: false }; f.chunks.push(chunk); return { ok: true }; };
  assert.equal((await f.service.runDueCheck()).ok, false);
  assert.equal(f.plans.length, 1);
  assert.equal(f.control.last_check_day, undefined);
  failing = false;
  assert.equal((await f.service.runDueCheck()).ok, true);
  assert.equal(f.plans.length, 1);
  assert.equal(f.batches.length, 1);
});

test('budget and outbound guard failures prevent the image provider call', async () => {
  for (const failure of ['budget', 'outbound', 'guard-unavailable']) {
    const f = fixture(snapshot([], [customer('sa')]));
    if (failure === 'budget') f.store.reserve = async () => ({ reserved: false });
    else f.dataOpsStore.listOutboundRecipientGuardKeys = async () => failure === 'outbound' ? ['id:sa'] : null;
    let calls = 0;
    await assert.rejects(f.service.generate({ id: 'job', customer: customer('sa') }, async (beforeRequest) => { await beforeRequest(await approvedRequest()); calls++; }), (error) => error.noAutomaticWebdesignRetry === true);
    assert.equal(calls, 0);
  }
});

test('a provider error keeps its monetary reservation and prohibits another paid attempt', async () => {
  const f = fixture(snapshot([], [customer('sa')]));
  const settlements = [];
  f.store.settle = async (...args) => { settlements.push(args); return { settled: false }; };
  const request = await approvedRequest();
  await assert.rejects(f.service.generate({ id: 'job', customer: customer('sa') }, async (beforeRequest) => { await beforeRequest(request); throw new Error('provider disconnected'); }),
    (error) => error.noAutomaticWebdesignRetry === true);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0][2], null);
});

test('unusable websites fail without reserving budget and cannot automatically retry', async () => {
  const f = fixture(snapshot([], [customer('sa')]));
  const settlements = [];
  let reservations = 0;
  f.store.reserve = async () => { reservations++; return { reserved: true }; };
  f.store.settle = async (...args) => { settlements.push(args); return { settled: true }; };
  await assert.rejects(f.service.generate({ id: 'job', customer: customer('sa') }, async () => { throw new Error('website unreachable'); }),
    (error) => error.noAutomaticWebdesignRetry === true);
  assert.equal(reservations, 0);
  assert.equal(settlements.length, 0);
});

test('request policy bounds the actual model, quality, prompt, number and dimensions before the paid call', async () => {
  const request = await approvedRequest();
  await assertApprovedImageRequest(request);
  for (const change of [{ imageModel: 'unpriced-model' }, { imageQuality: 'max' }, { imageSize: '2160x3840' },
    { prompt: 'a'.repeat(32769) }, { referenceImages: [request.referenceImages[0], request.referenceImages[0]] }]) {
    await assert.rejects(assertApprovedImageRequest({ ...request, ...change }), /aanvraagbudget/);
  }
  const wide = await require('sharp')({ create: { width: 1201, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(assertApprovedImageRequest({ ...request, referenceImages: [{ dataUrl: `data:image/png;base64,${wide.toString('base64')}` }] }), /afmetingen/);
});

test('successful paid usage is settled and the same image survives an unavailable cost write', async () => {
  const request = await approvedRequest();
  const payload = { model: request.imageModel, quality: 'medium', size: '1024x1536', image: { dataUrl: 'data:image/png;base64,test' },
    usage: { input_tokens: 3000, input_tokens_details: { text_tokens: 1000, image_tokens: 2000 }, output_tokens: 3000 } };
  for (const broken of [false, true]) {
    const f = fixture(snapshot([], [customer('sa')]));
    const settlements = [];
    f.store.settle = async (...args) => { settlements.push(args); if (broken) throw new Error('db disconnected'); return { settled: true }; };
    let calls = 0;
    const result = await f.service.generate({ id: 'job', customer: customer('sa', 'instantly') }, async (beforeRequest) => {
      calls++; await beforeRequest(request); return payload;
    });
    assert.equal(result, payload);
    assert.equal(calls, 1);
    assert.equal(settlements[0][2], 23);
    assert.equal(settlements[0][3].model, request.imageModel);
    if (broken) assert.equal(settlements[1][2], null);
  }
});

test('image usage accounting does not discount cached tokens on direct Image API requests', () => {
  const charge = budgetChargeCents({ model: 'gpt-image-2.5-sunburst', usage: {
    input_tokens_details: { text_tokens: 1000, image_tokens: 2000 }, output_tokens: 3000,
  } });
  assert.equal(charge, 23);
  assert.equal(budgetChargeCents({ model: 'unpriced-model', usage: {} }), null);
  assert.equal(budgetChargeCents(null), null);
  assert.equal(budgetChargeCents({ model: 'gpt-image-2.5-sunburst', usage: {} }), null);
});

test('overlapping worker invocations cannot run the midnight planner before claiming the durable lease', async () => {
  let planned = 0;
  const result = await runPremiumDatabaseWebdesignBatchWorker({}, {
    pruneJobs() {}, requiresPersistentBatchStorage: () => true,
    createBatchStorageUnavailableResult: () => ({ ok: false }),
    backgroundWorkerLeaseStore: { claimBackgroundWorkerLease: async () => ({ ok: true, acquired: false }), releaseBackgroundWorkerLease: async () => ({ ok: true }) },
    nightlyMailStockService: { runDueCheck: async () => { planned++; } },
  });
  assert.equal(result.reason, 'coalesced');
  assert.equal(planned, 0);
});

test('the authenticated stock status branch only reads status and never invokes the worker', async () => {
  const res = { status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
  await sendBatchWorkerResponse({ query: { mailStockStatus: '1' } }, res, async () => { throw new Error('worker must not run'); },
    { getStatus: async () => ({ ok: true, enabled: true }) });
  assert.equal(res.code, 200);
  assert.equal(res.value.enabled, true);
});

test('SQL budget, capacity, cross-provider identity locks and permissions survive restarts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.softora_outbound_recipient_guards (guard_key text primary key, permanent boolean, expires_at timestamptz);
      create table public.softora_webdesign_jobs (job_id text primary key, owner_key text, customer_id text, status text, payload jsonb, created_at timestamptz default now());`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261001165857_nightly_mail_stock.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261002133349_nightly_mail_stock_recovery.sql'), 'utf8'));
    const call = async (sql, args) => (await db.query(sql, args)).rows[0].result;
    const allocate = (row, keys) => call("select public.softora_mail_stock_allocate($1::jsonb,$2,$3,'mail_stock_20261002') result", [JSON.stringify(row), row.webdesignMailProvider, keys]);
    const addJob = (row, jobId) => db.query('insert into public.softora_webdesign_jobs(job_id,owner_key,customer_id,status,payload) values($1,$2,$3,\'running\',$4::jsonb)', [jobId, OWNER_KEY, row.id, JSON.stringify({ customer: row })]);
    const reserve = (id, jobId, readyIds = []) => call('select public.softora_mail_stock_reserve($1,$2,$3) result', [id, jobId, readyIds]);
    const settle = (id, jobId, cents) => call('select public.softora_mail_stock_settle($1,$2,$3,$4::jsonb) result', [id, jobId, cents, cents === null ? null : JSON.stringify({ model: 'gpt-image-2.5-sunburst' })]);
    const a = customer('a'), b = customer('b'), c = customer('c', 'instantly');
    assert.equal((await allocate(a, ['id:a','email:shared@example.test'])).allocated, false);
    await db.exec("update public.softora_mail_stock_control set enabled=true,softora_target=1,approved_cents=1000;");
    assert.equal((await allocate(a, ['id:a','email:shared@example.test'])).allocated, true);
    assert.equal((await allocate(c, ['id:c','email:shared@example.test'])).allocated, false);
    assert.equal((await allocate(b, ['id:b','email:b@example.test'])).allocated, true);
    await addJob(a, 'job-a'); await addJob(b, 'job-b');
    assert.equal((await reserve(a.id, 'wrong-job')).reserved, false);
    assert.equal((await reserve(a.id, 'job-a')).reserved, true);
    assert.equal((await reserve(a.id, 'job-a')).reserved, false);
    assert.equal((await reserve(b.id, 'job-b')).reserved, false);
    assert.equal((await settle(a.id, 'job-a', 20)).settled, true);
    assert.equal((await settle(a.id, 'job-a', 20)).existing, true);
    await db.exec('update public.softora_mail_stock_control set approved_cents=2000;');
    assert.equal((await reserve(b.id, 'job-b')).reason, 'target_full');
    await db.exec('update public.softora_mail_stock_control set softora_target=2,approved_cents=1000;');
    assert.equal((await reserve(b.id, 'job-b', ['a'])).reserved, false); // Only EUR 9.80 remains.
    await db.exec('update public.softora_mail_stock_control set approved_cents=2000;');
    assert.equal((await reserve(b.id, 'job-b', ['a'])).reserved, true);
    assert.equal((await settle(b.id, 'job-b', null)).settled, true);
    const control = (await db.query('select * from public.softora_mail_stock_control')).rows[0];
    assert.equal(Number(control.charged_cents), 1020);
    assert.equal(Number(control.held_cents), 0);
    assert.equal(control.enabled, true);
    assert.equal((await reserve(b.id, 'job-b')).reserved, false); // Unknown paid outcomes are never replayed.
    assert.equal((await db.query("select accounted_at_maximum from public.softora_mail_stock_generations where customer_id='b'")).rows[0].accounted_at_maximum, true);
    const permissions = (await db.query(`select has_table_privilege('anon','public.softora_mail_stock_control','SELECT') anon_read,
      has_function_privilege('authenticated','public.softora_mail_stock_reserve(text,text,text[])','EXECUTE') member_execute`)).rows[0];
    assert.equal(permissions.anon_read, false); assert.equal(permissions.member_execute, false);
  } finally { await db.close(); }
});


test('the night continues after midnight and replaces failed websites until actual ready targets are reached', async () => {
  const available = [customer('a'), customer('b'), customer('replacement')];
  const stock = snapshot([], available, []);
  const f = fixture(stock);
  f.control.softora_target = 2; f.control.instantly_target = 0;
  await f.service.runDueCheck();
  assert.equal(f.plans.length, 2);
  f.plans[0].status = 'failed';
  f.chunks[0].targets[0].status = 'error';
  f.store.readActiveJobs = async () => f.chunks.map(chunk => ({ payload: { kind: 'bulk_webdesign_chunk', targets: chunk.targets } }));
  f.control.testTime = '2026-10-02T00:10:00Z'; // 02:10 Amsterdam
  const resumed = await f.service.runDueCheck();
  assert.equal(resumed.added.softora, 1);
  assert.equal(f.chunks.length, 2);
  assert.equal(f.chunks[0].targets[0].status, 'error'); // History is preserved.
  assert.equal(f.chunks[1].targets[0].customer.id, 'replacement');
  stock.customers = [customer('b'), customer('replacement')];
  f.chunks.forEach(chunk => chunk.targets.forEach(target => { if (target.status !== 'error') target.status = 'done'; }));
  f.control.testTime = '2026-10-02T00:20:00Z';
  assert.equal((await f.service.runDueCheck()).status, 'complete');
  assert.equal((await f.service.runDueCheck()).reason, 'already_checked');
});

test('a provider boundary cannot pay after the job deadline or a failed durable marker', async () => {
  const f = fixture(snapshot([], [customer('a')]));
  const settlements = [];
  f.store.settle = async (...args) => { settlements.push(args); return { settled: true }; };
  let paid = 0;
  await assert.rejects(f.service.generate({ id: 'job-a', customer: customer('a') }, async before => {
    await before(await approvedRequest()); paid++;
  }, async () => { throw new Error('job expired'); }), /job expired/);
  assert.equal(paid, 0);
  assert.equal(settlements[0][2], 0);
});

test('worker clamps all configured jobs and batches to one concurrent wave per invocation', async () => {
  const waves = [];
  const result = await runPremiumDatabaseWebdesignBatchWorker({ batchLimit: 8, jobLimit: 24, concurrency: 1 }, {
    pruneJobs() {}, requiresPersistentBatchStorage: () => true,
    backgroundWorkerLeaseStore: { claimBackgroundWorkerLease: async () => ({ ok: true, acquired: true }), releaseBackgroundWorkerLease: async () => ({ ok: true }) },
    listRunnableBatches: async () => [{ id: 'one', ownerKey: 'owner' }, { id: 'two', ownerKey: 'owner' }],
    loadBatchChunks: async () => ({ chunks: [] }), driveBatch: async batch => ({ batch, chunks: [] }),
    processBatchJobsForWorker: async (batch, chunks, options) => { waves.push(options); return { processedJobs: 1, loadedJobs: 1, missingJobs: 0, completedTargets: 1, changedChunks: 0 }; },
    serializeBatch: batch => batch, bulkWorkerBatchLimit: 8, bulkWorkerConcurrency: 2,
  });
  assert.equal(result.batchCount, 1);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].jobLimit, 1);
  assert.equal(waves[0].concurrency, 1);
});


test('stale paid reservations consume their maximum once and cannot block replacement capacity', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.softora_outbound_recipient_guards (guard_key text primary key, permanent boolean, expires_at timestamptz);
      create table public.softora_webdesign_jobs (job_id text primary key, owner_key text, customer_id text, status text, payload jsonb, created_at timestamptz default now());`);
    for (const migration of ['20261001165857_nightly_mail_stock.sql', '20261002133349_nightly_mail_stock_recovery.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations', migration), 'utf8'));
    await db.exec("update public.softora_mail_stock_control set enabled=true,softora_target=1;");
    for (const id of ['lost', 'replacement']) {
      await db.query("select public.softora_mail_stock_allocate($1::jsonb,'softora',$2,'mail_stock_20261002')", [JSON.stringify(customer(id)), [`id:${id}`, `email:${id}@example.test`]]);
      await db.query("insert into public.softora_webdesign_jobs(job_id,owner_key,customer_id,status,payload) values($1,$2,$3,'running',$4::jsonb)", [`job-${id}`, OWNER_KEY, id, JSON.stringify({ customer: customer(id) })]);
    }
    const reserve = async id => (await db.query("select public.softora_mail_stock_reserve($1,$2,'{}'::text[]) result", [id, `job-${id}`])).rows[0].result;
    assert.equal((await reserve('lost')).reserved, true);
    await db.exec("update public.softora_mail_stock_generations set updated_at=now()-interval '16 minutes' where customer_id='lost'; update public.softora_webdesign_jobs set status='error' where customer_id='lost';");
    assert.equal((await db.query('select public.softora_mail_stock_reconcile() result')).rows[0].result.reconciled, 1);
    assert.equal((await db.query('select public.softora_mail_stock_reconcile() result')).rows[0].result.reconciled, 0);
    assert.equal((await reserve('lost')).reserved, false);
    assert.equal((await reserve('replacement')).reserved, true);
    const control = (await db.query('select * from public.softora_mail_stock_control')).rows[0];
    assert.equal(Number(control.charged_cents), 1000);
    assert.equal(Number(control.held_cents), 1000);
    assert.equal(control.enabled, true);
    assert.equal((await db.query("select has_function_privilege('anon','public.softora_mail_stock_reconcile()','EXECUTE') allowed")).rows[0].allowed, false);
  } finally { await db.close(); }
});

test('durable automatic job marker distinguishes unpaid preparation from the paid request', async () => {
  const { deliverWebdesignImage } = require('../../server/services/premium-database-webdesign-delivery');
  const f = fixture(snapshot([], [customer('a')]));
  const job = { id: 'job-a', ownerKey: OWNER_KEY, customer: customer('a'), websiteUrl: 'https://a.example' };
  const markers = [];
  let images = 0;
  const request = await approvedRequest();
  await deliverWebdesignImage(job, {
    nightlyMailStockService: f.service,
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async (url, options) => {
      assert.equal(markers.at(-1), false); // Website scan is safely repeatable after a restart.
      await options.beforeImageRequest(request);
      assert.equal(markers.at(-1), true); // Durable before the external paid effect.
      return { model: request.imageModel, image: {}, usage: { input_tokens: 20, input_tokens_details: { text_tokens: 20, image_tokens: 0 }, output_tokens: 20 } };
    } },
    persistJob: async value => { markers.push(value.generationAttempted === true); return true; },
    requiresPersistentJobStorage: () => true, persistGeneratedPhoto: async () => { images++; }, assertActive() {},
  });
  assert.equal(images, 1);
  await assert.rejects(deliverWebdesignImage(job, {}), /onderbroken/); // A restarted worker cannot pay again.
});


test('nightly replenishment uses four parallel jobs while preserving manual batch concurrency', () => {
  const { resolveWorkerConcurrency } = require('../../server/services/premium-database-webdesign-batch-worker');
  assert.equal(resolveWorkerConcurrency({ ownerKey: OWNER_KEY }), 4);
  assert.equal(resolveWorkerConcurrency({ ownerKey: 'owner' }), 2);
  assert.equal(resolveWorkerConcurrency({ ownerKey: OWNER_KEY }, {}, { processingConcurrency: 1 }), 1);
  assert.equal(resolveWorkerConcurrency({ ownerKey: OWNER_KEY }, { concurrency: 100 }), 4);
});


test('an already-ready company cannot pay again while the channel still has a deficit', async () => {
  const row = customer('ready');
  const f = fixture(snapshot([row], [row]));
  let reservations = 0;
  f.store.reserve = async () => { reservations++; return { reserved: true }; };
  await assert.rejects(f.service.generate({ id: 'job', customer: row }, async before => { await before(await approvedRequest()); }), /niet meer nodig/);
  assert.equal(reservations, 0);
});

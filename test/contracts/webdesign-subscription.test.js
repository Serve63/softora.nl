const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPremiumDatabaseWebdesignJobsCoordinator } = require('../../server/services/premium-database-webdesign-jobs');
const { createWebdesignSubscriptionService, isExpiredWebdesignJob } = require('../../server/services/webdesign-subscription');
const { createKvkApiWorkersService } = require('../../server/services/kvk-api-workers');
const { buildWebdesignJobPayload, normalizeWebdesignJobRow } = require('../../server/services/webdesign-job-payload');
const { buildWebsiteImageGenerationMetadata } = require('../../server/services/website-image-generation-cost');
const auth = { email: 'serve@softora.nl', userId: 'serve' };
const claim = '11111111-1111-1111-1111-111111111111';
const res = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });

function fixture() {
  const rows = new Map(), batches = new Map(), chunks = new Map();
  let apiCalls = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({ processJobsInline: true,
    logger: { error() {}, warn() {} },
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async () => { apiCalls++; throw new Error('Must not call API'); } },
    dataOpsStore: { assignWebdesignOwner: async () => auth.email,
      upsertWebdesignJob: async (job) => { rows.set(job.id, structuredClone(job)); return { ok: true }; },
      getWebdesignJob: async (id) => structuredClone(rows.get(id)),
      findRunningWebdesignJob: async () => null,
      upsertWebdesignBatch: async (batch) => { batches.set(batch.id, structuredClone(batch)); return { ok: true }; },
      getWebdesignBatch: async (_owner, id) => structuredClone(batches.get(id)),
      upsertWebdesignBatchChunk: async (chunk) => { chunks.set(chunk.id, structuredClone(chunk)); return { ok: true }; },
      listWebdesignBatchChunks: async (_owner, id) => [...chunks.values()].filter((c) => c.batchId === id).map((c) => structuredClone(c)),
    },
  });
  return { coordinator, rows, batches, chunks, apiCalls: () => apiCalls };
}

test('manual job cannot select API, stays off the API on polling and reads remote completion', async () => {
  const f = fixture(), started = res();
  await f.coordinator.startJobResponse({ premiumAuth: auth, body: { executionProvider: 'api',
    customer: { id: 'customer-1', bedrijf: 'Bedrijf' }, websiteUrl: 'https://example.nl' } }, started);
  assert.equal(started.statusCode, 202);
  const id = started.body.job.id;
  assert.equal(f.rows.get(id).executionProvider, 'codex-subscription');
  await f.coordinator.getJobResponse({ premiumAuth: auth, params: { jobId: id } }, res());
  assert.equal(f.apiCalls(), 0);
  f.rows.get(id).status = 'running'; f.rows.get(id).startedAt = Date.now() - 20 * 60000;
  await f.coordinator.getJobResponse({ premiumAuth: auth, params: { jobId: id } }, res());
  assert.equal(f.rows.get(id).status, 'running');
  assert.equal(f.apiCalls(), 0);
  f.rows.get(id).status = 'done';
  const done = res();
  await f.coordinator.getJobResponse({ premiumAuth: auth, params: { jobId: id } }, done);
  assert.equal(done.body.job.status, 'done');
});

test('manual bulk carries the subscription lane into every durable target job', async () => {
  const f = fixture(), started = res();
  await f.coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 1, executionProvider: 'api' } }, started);
  const batchId = started.body.batch.id;
  assert.equal(f.batches.get(batchId).executionProvider, 'codex-subscription');
  const appended = res();
  await f.coordinator.appendBatchChunkResponse({ premiumAuth: auth, params: { batchId }, body: { index: 0,
    targets: [{ customer: { id: 'bulk-customer', bedrijf: 'Bulk Bedrijf' }, websiteUrl: 'https://example.nl' }] } }, appended);
  assert.equal(appended.statusCode, 202);
  await f.coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 1, expectedChunks: 1 } }, res());
  assert.equal(f.rows.size, 1);
  assert.equal([...f.rows.values()][0].executionProvider, 'codex-subscription');
  assert.equal(f.apiCalls(), 0);
});

test('subscription batch reconciles a recovered result after its target was marked failed', async () => {
  const f = fixture(), started = res();
  await f.coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 2 } }, started);
  const batchId = started.body.batch.id;
  await f.coordinator.appendBatchChunkResponse({ premiumAuth: auth, params: { batchId }, body: { index: 0,
    targets: ['recovered', 'peer'].map((id) => ({ customer: { id, bedrijf: id }, websiteUrl: 'https://example.nl' })) } }, res());
  await f.coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 2, expectedChunks: 1 } }, res());
  const [job, peer] = [...f.rows.values()];
  job.status = 'error'; peer.status = 'error';
  const read = async () => {
    const response = res();
    await f.coordinator.getBatchResponse({ premiumAuth: auth, params: { batchId } }, response);
    return response.body.batch;
  };
  assert.equal((await read()).failed, 2);
  // The result RPC reopens the parent after a late saved result arrives.
  job.status = 'done'; job.finishedAt = Date.now();
  f.batches.get(batchId).status = 'running';
  const recovered = await read();
  assert.equal(recovered.made, 1); assert.equal(recovered.failed, 1);
  assert.equal([...f.chunks.values()][0].targets[0].status, 'done');
  assert.equal(f.apiCalls(), 0);
});

test('a retried manual batch creation restores the same durable batch', async () => {
  const f = fixture();
  const request = { premiumAuth: auth, body: { total: 50, requestId: 'batch-retry-1234567890123456' } };
  const first = res(), retry = res();
  await f.coordinator.startBatchResponse(request, first);
  const stored = f.batches.get(first.body.batch.id);
  stored.status = 'running'; stored.summary = { total: 50, made: 2, done: 2 };
  await f.coordinator.startBatchResponse(request, retry);
  assert.equal(retry.body.batch.id, first.body.batch.id);
  assert.equal(retry.body.batch.status, 'running');
  assert.equal(retry.body.batch.made, 2);
  assert.equal(f.batches.size, 1);
});

test('long subscription waits and newly delivered old jobs never expire from creation time', async () => {
  const f = fixture(), started = res();
  await f.coordinator.startJobResponse({ premiumAuth: auth, body: {
    customer: { id: 'old-subscription', bedrijf: 'Bedrijf' }, websiteUrl: 'https://example.nl',
  } }, started);
  const id = started.body.job.id;
  const stored = f.rows.get(id);
  stored.createdAt = Date.now() - 48 * 3600000;
  for (const status of ['queued', 'running', 'done']) {
    stored.status = status;
    stored.finishedAt = status === 'done' ? Date.now() : null;
    const response = res();
    await f.coordinator.getJobResponse({ premiumAuth: auth, params: { jobId: id } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.job.status, status);
  }
  assert.equal(isExpiredWebdesignJob({ executionProvider: 'api', createdAt: stored.createdAt }, Date.now(), 6 * 3600000), true);
  assert.equal(f.apiCalls(), 0);
});

test('pre-generation heartbeat checks the existing claim without claiming another job', async () => {
  const service = createWebdesignSubscriptionService({ repository: {
    heartbeat: async (id, token) => { assert.equal(id, 'job-1234567890123456'); assert.equal(token, claim); return { ok: true, allowed: true }; },
    claim: () => assert.fail('Heartbeat must not claim another job'),
  } });
  const response = res();
  await service.poll({ body: { claim, heartbeatJobId: 'job-1234567890123456' } }, response);
  assert.equal(response.body.allowed, true);
});

test('manual requests cannot reuse an older API job as a subscription job', async () => {
  const f = fixture();
  const existing = { id: 'older-api-job-1234567890', ownerKey: `${auth.email}::${auth.userId}`, customer: { id: 'older-customer', bedrijf: 'Bedrijf' },
    websiteUrl: 'https://example.nl', status: 'running', createdAt: Date.now(), startedAt: Date.now(), executionProvider: 'api' };
  f.coordinator._jobs.set(existing.id, existing);
  const rejected = res();
  await f.coordinator.startJobResponse({ premiumAuth: auth, body: { customer: existing.customer, websiteUrl: existing.websiteUrl } }, rejected);
  assert.equal(rejected.statusCode, 409);
  assert.equal(f.apiCalls(), 0);
  assert.equal(existing.executionProvider, 'api');
  const byId = res();
  await f.coordinator.startJobResponse({ premiumAuth: auth, body: { jobId: existing.id,
    customer: { id: 'another-customer', bedrijf: 'Ander bedrijf' }, websiteUrl: existing.websiteUrl } }, byId);
  assert.equal(byId.statusCode, 409);
  assert.equal(f.apiCalls(), 0);
});

test('subscription payload restores dispatch, claim and subscription billing without API prices', () => {
  const generation = buildWebsiteImageGenerationMetadata({ model: 'gpt-image-2', billingMode: 'subscription' });
  const payload = buildWebdesignJobPayload({ customer: { id: 'a' }, executionProvider: 'codex-subscription', subscriptionClaim: claim, generation });
  const restored = normalizeWebdesignJobRow({ job_id: 'a', payload });
  assert.equal(restored.executionProvider, 'codex-subscription');
  assert.equal(restored.subscriptionClaim, claim);
  assert.equal(restored.generation.billingMode, 'subscription');
  assert.equal(restored.generation.cost, null);
});

test('worker authentication remains mandatory for the image lane', async () => {
  let called = 0;
  const service = createKvkApiWorkersService({ kvkDatabaseSyncToken: 'test-worker-token',
    subscriptionPhotos: { poll: async () => called++, complete: async () => called++ } });
  for (const method of ['poll', 'report']) {
    const denied = res();
    await service[method]({ headers: {}, body: { lane: 'webdesign-photo' } }, denied);
    assert.equal(denied.statusCode, 401);
    await service[method]({ headers: { authorization: 'Bearer test-worker-token' }, body: { lane: 'webdesign-photo' } }, res());
  }
  assert.equal(called, 2);
});

test('subscription delivery uses the existing photo pipeline and retries only stored results', async () => {
  let saves = 0, finishes = 0, stored = false;
  const service = createWebdesignSubscriptionService({ repository: {
    begin: async () => stored ? { ok: true, done: true } : { ok: true, job: { id: 'job-1234567890123456', customer: { id: 'customer' } } },
    finish: async () => { stored = true; finishes++; return { ok: true }; },
  }, coordinator: { saveSubscriptionPhoto: async (job, image) => {
    saves++;
    assert.equal(job.generation.billingMode, 'subscription');
    assert.match(image.dataUrl, /^data:image\/jpeg;base64,/);
  } } });
  const request = { body: { jobId: 'job-1234567890123456', claim, dataUrl: 'data:image/jpeg;base64,/9j/AA==' } };
  await service.complete(request, res());
  await service.complete(request, res());
  assert.equal(saves, 1); assert.equal(finishes, 1);
});

test('subscription failure and a cancelled job never save an image or call the provider', async () => {
  let finished = 0;
  const repository = { begin: async () => ({ ok: true, job: {} }), finish: async () => { finished++; return { ok: true }; } };
  const service = createWebdesignSubscriptionService({ repository, coordinator: { saveSubscriptionPhoto: () => assert.fail('No image expected') } });
  await service.complete({ body: { jobId: 'job-1234567890123456', claim, error: 'limit' } }, res());
  assert.equal(finished, 1);
  repository.begin = async () => ({ ok: false, reason: 'stopped' });
  const stopped = res();
  await service.complete({ body: { jobId: 'job-1234567890123456', claim } }, stopped);
  assert.equal(stopped.statusCode, 409); assert.equal(stopped.body.code, 'WEBDESIGN_STOPPED');
});

test('SQL claims atomically and restricts the image lane to service-role execution', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261003010627_manual_webdesign_subscription.sql'), 'utf8');
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /executionProvider' = 'codex-subscription'/);
  assert.match(sql, /generationAttempted/);
  assert.match(sql, /security invoker set search_path = ''/i);
  assert.match(sql, /from public, anon, authenticated/i);
});

test('Mac worker restart delivers an existing image and never replays an uncertain generation', () => {
  const script = `
import importlib.util, pathlib, tempfile, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('worker', 'scripts/webdesign_subscription_worker.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
w.BASE = pathlib.Path(tempfile.mkdtemp())
w.codex_binary = lambda: '/fixture/codex'
job = {'id': 'restart-job-1234567890123456', 'claim': '${claim}'}
folder = w.BASE / job['id']; folder.mkdir(); (folder / 'design.jpg').write_bytes(b'image')
w.write_state({'phase': 'generating', 'job': job})
calls = []
def forbidden(*a): raise AssertionError('Image generation must not repeat')
w.generate = forbidden
def fail_save(route, payload):
 calls.append((route, payload)); raise OSError('network')
w.call = fail_save
try: w.step()
except OSError: pass
assert (folder / 'design.jpg').exists()
assert __import__('json').loads((w.BASE / 'state.json').read_text())['phase'] == 'deliver'
w.call = lambda route, payload: (calls.append((route, payload)) or {'ok': True, 'done': True})
w.step()
assert len(calls) == 2 and all(c[0] == '/report' for c in calls)
assert all(c[1]['dataUrl'].startswith('data:image/jpeg;base64,') for c in calls)
(folder / 'design.jpg').unlink()
w.write_state({'phase': 'generating', 'job': job}); w.step()
assert calls[-1][1].get('error')
env = w.subscription_environment()
assert 'OPENAI_API_KEY' not in env and 'CODEX_API_KEY' not in env and 'OPENAI_BASE_URL' not in env
print('restart and delivery recovery OK')
`;
  const result = spawnSync('python3', ['-c', script], { cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /restart and delivery recovery OK/);
});

test('parallel Mac slots recover PNGs, orphan children and reversible preparation without repeated generation', () => {
  const script = `
import importlib.util, pathlib, tempfile, json, sys, types, fcntl
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('worker', 'scripts/webdesign_subscription_worker.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
w.BASE = pathlib.Path(tempfile.mkdtemp())
job = {'id': 'png-restart-job-123456789012', 'claim': '${claim}'}
folder = w.BASE / job['id']; folder.mkdir(); (folder / 'design.png').write_bytes(b'native-png')
w.write_state({'phase': 'generating', 'job': job})
w.generate = lambda *args: (_ for _ in ()).throw(AssertionError('must not regenerate'))
w.generation_running = lambda folder: True
w.call = lambda *args: (_ for _ in ()).throw(AssertionError('live child must finish first'))
w.step()
assert json.loads(w.state_file().read_text())['phase'] == 'generating'
w.generation_running = lambda folder: False
encoded = []
def encode(folder):
 encoded.append(folder); (folder / 'design.jpg').write_bytes(b'jpg')
w.encode_result = encode
reports = []
w.call = lambda path, payload: (reports.append((path,payload)) or {'ok': True, 'done': True})
w.step()
assert len(encoded) == 1 and reports[0][0] == '/report' and 'dataUrl' in reports[0][1]
assert json.loads(w.state_file().read_text()) == {}
# A reversible auth/network preparation failure stays retryable before the image boundary.
job2 = dict(job, id='slot-two-12345678901234567890')
w.write_state({'phase': 'prepare', 'job': job2}, 1)
w.generate = lambda *args: (_ for _ in ()).throw(OSError('reference offline'))
try: w.step(1)
except OSError: pass
assert json.loads(w.state_file(1).read_text())['phase'] == 'prepare'
assert json.loads(w.state_file(0).read_text()) == {}
# Both slot checkpoint files remain separate; a quota pause prevents further claims.
for event in [{'type':'error','message':"You've hit your usage limit"}, {'type':'turn.failed','error':{'message':'usage_limit_reached'}}]:
 (folder/'codex-events.jsonl').write_text(json.dumps(event))
 assert w.subscription_limit(folder)
(folder/'codex-events.jsonl').write_text(json.dumps({'type':'item.completed','item':{'type':'command_execution','aggregated_output':'instructions: usage_limit_reached'}}))
assert not w.subscription_limit(folder)
w.write_state({'phase': 'cooldown', 'retryAt': w.time.time()+600}, 0)
w.call = lambda *args: (_ for _ in ()).throw(AssertionError('quota must pause other slot'))
w.step(1)
assert json.loads(w.state_file(1).read_text())['phase'] == 'prepare'
# Existing supervisor ownership makes the watchdog a no-op, without opening more terminals.
with (w.BASE/'supervisor.lock').open('w') as held:
 fcntl.flock(held, fcntl.LOCK_EX|fcntl.LOCK_NB)
 w.subprocess.run = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('watchdog must not relaunch a live supervisor'))
 w.watchdog()
print('parallel checkpoints, PNG recovery, quota and watchdog OK')
`;
  const result = spawnSync('python3', ['-c', script], { cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /parallel checkpoints, PNG recovery, quota and watchdog OK/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumDatabaseWebdesignJobsCoordinator } = require('../../server/services/premium-database-webdesign-jobs');
const { createWebdesignJobStartRepository } = require('../../server/repositories/webdesign-job-start');
const input = { ownerKey: 'serve@softora.nl::serve', executionProvider: 'codex-subscription',
  batchId: 'webdesign_batch_idempotency_contract', batchTargetIndex: 3,
  customer: { id: 'customer-contract', bedrijf: 'Voorbeeld' }, websiteUrl: 'https://example.nl/' };
const copy = (value) => value && structuredClone(value);

function fixture() {
  const rows = new Map();
  let inserts = 0;
  let apiCalls = 0;
  const store = {
    assignWebdesignOwner: async () => 'serve@softora.nl',
    upsertWebdesignJob: async (job) => { rows.set(job.id, copy(job)); return { ok: true }; },
    getWebdesignJob: async (id) => copy(rows.get(id)),
    findRunningWebdesignJob: async () => null,
    findWebdesignBatchTargetJob: async (owner, batch, index) => copy([...rows.values()].find((j) =>
      j.ownerKey === owner && j.batchId === batch && j.batchTargetIndex === index)),
    createWebdesignJobIfAbsent: async (job) => {
      inserts++;
      if (!rows.has(job.id)) rows.set(job.id, copy(job));
      return { ok: true, job: copy(rows.get(job.id)) };
    },
  };
  const coordinator = () => createPremiumDatabaseWebdesignJobsCoordinator({ processJobsInline: true,
    logger: { error() {}, warn() {} }, dataOpsStore: store,
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async () => { apiCalls++; } } });
  return { rows, store, coordinator, inserts: () => inserts, apiCalls: () => apiCalls };
}

test('a stale batch target reuses its original terminal job, including legacy random IDs', async () => {
  for (const status of ['done', 'error']) {
    const f = fixture();
    const prior = { ...copy(input), id: 'legacy-job-000000000', status, createdAt: Date.now() - 24 * 3600000,
      finishedAt: Date.now() - 7 * 3600000, generationAttempted: true, subscriptionClaim: 'original-claim' };
    f.rows.set(prior.id, prior);
    const result = await f.coordinator().startJob(input);
    assert.equal(result.job.id, prior.id);
    assert.equal(result.job.status, status);
    assert.equal(result.existing, true);
    assert.equal(f.inserts(), 0);
    assert.equal(f.rows.size, 1);
    assert.equal(f.apiCalls(), 0);
  }
});

test('concurrent batch readers on separate servers create the same durable job only once', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.coordinator().startJob(input), f.coordinator().startJob(input)]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(a.job.id, b.job.id);
  assert.equal(f.rows.size, 1);
  assert.equal(f.apiCalls(), 0);
});

test('a losing starter reads a claimed job without resetting its claim or generation marker', async () => {
  const f = fixture();
  const insert = f.store.createWebdesignJobIfAbsent;
  f.store.createWebdesignJobIfAbsent = async (job) => {
    f.rows.set(job.id, { ...copy(job), status: 'running', generationAttempted: true, subscriptionClaim: 'winning-claim' });
    return insert(job);
  };
  const result = await f.coordinator().startJob(input);
  assert.equal(result.job.status, 'running');
  const saved = f.rows.get(result.job.id);
  assert.equal(saved.subscriptionClaim, 'winning-claim');
  assert.equal(saved.generationAttempted, true);
});

test('batch lookup and atomic insert failures leave the queue untouched', async () => {
  for (const operation of ['findWebdesignBatchTargetJob', 'createWebdesignJobIfAbsent']) {
    const f = fixture();
    f.store[operation] = async () => { throw new Error('Database temporarily unavailable'); };
    const result = await f.coordinator().startJob(input);
    assert.equal(result.statusCode, 503);
    assert.equal(f.rows.size, 0);
    assert.equal(f.apiCalls(), 0);
  }
  const f = fixture();
  f.store.createWebdesignJobIfAbsent = async () => ({ ok: false });
  assert.equal((await f.coordinator().startJob(input)).statusCode, 503);
});

test('repository insertion preserves the existing row and reads its durable outcome', async () => {
  let options;
  const winner = { id: 'batch-job', status: 'done', generationAttempted: true };
  const repository = createWebdesignJobStartRepository({
    run: async (_action, perform) => perform({ from: () => ({ upsert: async (_row, value) => { options = value; return { ok: true }; } }) }),
    TABLES: { webdesignJobs: 'softora_webdesign_jobs' },
    buildWebdesignJobRow: (value) => value, getWriteOperationOptions: () => ({}),
    getWebdesignJob: async () => winner, forgetReads() {},
  });
  const result = await repository.createWebdesignJobIfAbsent({ id: 'batch-job', status: 'queued' });
  assert.equal(options.ignoreDuplicates, true);
  assert.equal(options.onConflict, 'job_id');
  assert.equal(result.job.status, 'done');
});

test('an API starter winning the atomic insert cannot switch a subscription request to API', async () => {
  const f = fixture();
  f.store.createWebdesignJobIfAbsent = async (job) => ({ ok: true,
    job: { ...copy(job), executionProvider: 'api', status: 'running' } });
  const result = await f.coordinator().startJob(input);
  assert.equal(result.statusCode, 409);
  assert.equal(result.ok, false);
  assert.equal(f.apiCalls(), 0);
});

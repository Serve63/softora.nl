const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumDatabaseWebdesignJobsCoordinator } = require('../../server/services/premium-database-webdesign-jobs');
const { deliverWebdesignImage } = require('../../server/services/premium-database-webdesign-delivery');
const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');

const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', fileName: 'preview.png' };
const auth = { email: 'owner@example.test', userId: 'owner' };
const jobId = 'webdesign_storage_test_123';
function response() { return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function fixture(overrides = {}) {
  let saved;
  let calls = 0;
  let uploads = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    processJobsInline: true,
    logger: { warn() {}, error() {} },
    storageRetrySleep: async () => {},
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async () => { calls += 1; return { image }; } },
    dataOpsStore: {
      upsertWebdesignJob: async (job) => { saved = structuredClone(job); return { ok: true }; },
      uploadDesignPhoto: async () => { uploads += 1; return { ok: false, error: new Error('storage timeout') }; },
    },
    ...overrides,
  });
  return { coordinator, calls: () => calls, uploads: () => uploads, saved: () => saved };
}
async function start(coordinator) {
  const res = response();
  await coordinator.startJobResponse({ premiumAuth: auth, body: {
    jobId, websiteUrl: 'https://example.test', customer: { id: 'test-customer', bedrijf: 'Test' },
  } }, res);
  assert.equal(res.statusCode, 202);
}
async function poll(coordinator) {
  const res = response();
  await coordinator.getJobResponse({ premiumAuth: auth, params: { jobId } }, res);
  return res;
}

test('exhausted photo storage retries terminate without another AI generation', async () => {
  const f = fixture();
  await start(f.coordinator);
  const res = await poll(f.coordinator);
  assert.equal(res.body.job.status, 'error');
  assert.match(res.body.job.error, /ontwerp is gemaakt.*opslaan kon niet worden bevestigd/i);
  assert.equal(res.body.job.nextAttemptAt, null);
  assert.equal(f.calls(), 1);
  assert.equal(f.uploads(), 4);
  assert.equal(f.saved().generationAttempted, true);
  await poll(f.coordinator);
  assert.equal(f.calls(), 1);
});

test('a restarted worker cannot regenerate an interrupted job', async () => {
  const f = fixture({ dataOpsStore: {
    getWebdesignJob: async () => ({ id: jobId, ownerKey: 'owner@example.test::owner',
      websiteUrl: 'https://example.test', customer: { id: 'test-customer', bedrijf: 'Test' },
      status: 'running', createdAt: Date.now() - 1000000, startedAt: Date.now() - 800000,
      generationAttempted: true,
    }),
    upsertWebdesignJob: async () => ({ ok: true }),
  } });
  const res = await poll(f.coordinator);
  assert.equal(res.body.job.status, 'error');
  assert.match(res.body.job.error, /niet automatisch opnieuw/);
  assert.equal(f.calls(), 0);
});

test('a deadline during storage terminates the job and blocks later retries', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let attempts = 0;
  const f = fixture({ jobProcessTimeoutMs: 2000, storageRetrySleep: () => { attempts += 1; return waiting; } });
  await start(f.coordinator);
  const res = await poll(f.coordinator);
  assert.equal(res.body.job.status, 'error');
  assert.equal(res.body.job.nextAttemptAt, null);
  assert.equal(f.calls(), 1);
  release();
  await new Promise(resolve => setImmediate(resolve));
  await poll(f.coordinator);
  assert.equal(attempts, 1);
  assert.equal(f.uploads(), 1);
  assert.equal(f.calls(), 1);
});

test('delivery never calls the provider when its durable marker cannot be saved', async () => {
  let called = false;
  const job = { customer: {} };
  await assert.rejects(deliverWebdesignImage(job, {
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async () => { called = true; } },
    persistJob: async () => null,
    requiresPersistentJobStorage: () => true,
    assertActive() {},
  }), error => error.retryableWebdesignStorage === true);
  assert.equal(called, false);
  assert.equal(job.generationAttempted, false);
});

test('cancellation between storage attempts stops delivery without regenerating', async () => {
  const job = { customer: {} };
  let attempts = 0;
  let calls = 0;
  await assert.rejects(deliverWebdesignImage(job, {
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async () => { calls += 1; return { image }; } },
    persistJob: async () => ({ ok: true }), requiresPersistentJobStorage: () => true,
    persistGeneratedPhoto: async () => { attempts += 1; throw Object.assign(new Error('storage'), { retryableWebdesignStorage: true }); },
    storageRetrySleep: async () => { job.cancelled = true; },
    assertActive() { if (job.cancelled) throw new Error('cancelled'); }, logger: { warn() {} },
  }), /cancelled/);
  assert.equal(attempts, 1);
  assert.equal(calls, 1);
});

test('generation marker round trips through the existing job table without image bytes', async () => {
  let stored;
  const client = { from() { return {
    upsert: async (row) => { stored = row; return { data: row }; },
    select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: stored }),
  }; } };
  const store = createSoftoraDataOpsStore({ isSupabaseConfigured: () => true, getSupabaseClient: () => client });
  const result = await store.upsertWebdesignJob({ id: jobId, ownerKey: 'owner', customer: { id: 'test-customer' },
    generationAttempted: true, processingTimedOut: true, image, status: 'running', variant: 'v2-visual-dna',
  });
  assert.equal(result.ok, true);
  assert.equal(stored.payload.generationAttempted, true);
  assert.doesNotMatch(JSON.stringify(stored), /iVBORw0|processingTimedOut/);
  assert.equal((await store.getWebdesignJob(jobId)).generationAttempted, true);
});

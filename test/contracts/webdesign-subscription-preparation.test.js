const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubscriptionPreparationRepository } = require('../../server/repositories/webdesign-subscription-preparation');
const { createWebdesignSubscriptionService } = require('../../server/services/webdesign-subscription');
const { buildWebdesignJobPayload, normalizeWebdesignJobRow } = require('../../server/services/webdesign-job-payload');
const claim = '11111111-1111-1111-1111-111111111111';
const job = { id: 'prepare-job-1234567890123456', subscriptionClaim: claim, websiteUrl: 'https://example.nl/', customer: { bedrijf: 'Example' } };
const scan = { generationScan: { title: 'Example', referenceImageUrls: ['https://image.thum.io/get/https://example.nl/'] } };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function fixture(options = {}) {
  let time = 1700000000000, active = true, scans = 0;
  let row = { job_id: job.id, status: 'running', updated_at: new Date(time).toISOString(),
    payload: { customer: job.customer, executionProvider: 'codex-subscription', subscriptionClaim: claim, retained: 'keep' } };
  const matches = (key, value) => {
    const actual = key.split(/->>?/).reduce((value, part) => value?.[part], row);
    return value === null ? actual == null : actual === value;
  };
  const client = { from(table) {
    assert.equal(table, 'softora_webdesign_jobs');
    const filters = []; let patch;
    return {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      is(key, value) { filters.push([key, value]); return this; },
      update(value) { patch = value; return this; },
      async maybeSingle() {
        if (patch) await options.beforeWrite?.(patch, row);
        if (!filters.every(([key, value]) => matches(key, value))) return { data: null };
        if (patch) row = { ...row, ...structuredClone(patch) };
        return { data: structuredClone(row) };
      },
    };
  } };
  const finished = [];
  const repository = { ...createSubscriptionPreparationRepository({ getClient: () => client,
    heartbeat: async (_id, token) => {
      const allowed = active && row.status === 'running' && token === row.payload.subscriptionClaim;
      if (allowed) row.updated_at = new Date(++time).toISOString();
      return { ok: allowed, allowed };
    }, now: () => time }),
    claim: async () => ({ ok: true, job: row.status === 'running' ? job : null }),
    finish: async (_id, _claim, error) => { finished.push(error); row.status = 'error'; return { ok: true }; },
  };
  const aiToolsCoordinator = {
    prepareWebsitePreviewImage: async () => { scans++; return options.prepare ? options.prepare(scans) : scan; },
    fetchWebsitePreviewReferenceImages: options.references || (async () => []),
  };
  function service() { return createWebdesignSubscriptionService({ repository, aiToolsCoordinator,
    preparationTimeoutMs: options.timeout || 1000, now: () => time, logger: { warn() {} } }); }
  async function poll(target = service()) {
    const response = { json(body) { this.body = body; return this; } };
    await target.poll({ body: { claim } }, response);
    return response.body;
  }
  return { repository, poll, service, finished, row: () => row, scans: () => scans,
    advance: (ms = 16000) => { time += ms; }, stop: () => { active = false; row.status = 'error'; row.payload.cancelled = true; } };
}

test('concurrent claim polls share one scan and a lost response reuses durable preparation after service restart', async () => {
  const pending = deferred(), started = deferred();
  const f = fixture({ prepare: () => { started.resolve(); return pending.promise; } });
  const first = f.poll();
  await started.promise;
  assert.equal((await f.poll()).waiting, true);
  pending.resolve(scan);
  const result = await first;
  assert.deepEqual((await f.poll(f.service())).job, result.job);
  assert.equal(f.scans(), 1);
  assert.equal(f.row().payload.retained, 'keep');
  assert.equal(f.row().payload.subscriptionPreparation.phase, 'ready');
});

test('temporary fetch failures keep the same claim and recover within three attempts', async () => {
  const f = fixture({ prepare: (attempt) => {
    if (attempt < 3) throw Object.assign(new Error('Origin timeout'), { retryableWebsiteFetch: true });
    return scan;
  } });
  assert.equal((await f.poll()).waiting, true);
  assert.equal((await f.poll()).waiting, true);
  assert.equal(f.scans(), 1);
  f.advance(); assert.equal((await f.poll()).waiting, true);
  f.advance(); assert.equal((await f.poll()).job.claim, claim);
  assert.equal(f.scans(), 3);
  assert.equal(f.finished.length, 0);
});

test('three failed fetch attempts terminate once while permanent errors never retry', async () => {
  const temporary = fixture({ prepare: () => { throw Object.assign(new Error('Timeout'), { retryableWebsiteFetch: true }); } });
  await temporary.poll(); temporary.advance(); await temporary.poll(); temporary.advance();
  await assert.rejects(temporary.poll(), /Timeout/);
  assert.equal(temporary.scans(), 3); assert.equal(temporary.finished.length, 1);
  assert.equal((await temporary.poll()).job, null);
  for (const message of ['Website in onderhoud', 'Website blokkeert verzoeken', 'Bedrijf is gestopt']) {
    const permanent = fixture({ prepare: () => { throw new Error(message); } });
    await assert.rejects(permanent.poll(), new RegExp(message));
    assert.equal(permanent.scans(), 1); assert.equal(permanent.finished.length, 1);
  }
});

test('preparation deadline releases the poll and ignores late scan output', async () => {
  const pending = deferred();
  const f = fixture({ prepare: () => pending.promise, timeout: 5 });
  assert.equal((await f.poll()).waiting, true);
  const checkpoint = structuredClone(f.row().payload.subscriptionPreparation);
  assert.equal(checkpoint.phase, 'retry');
  pending.resolve(scan);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.row().payload.subscriptionPreparation, checkpoint);
  assert.equal(f.finished.length, 0);
});

test('source failure classification survives persistence for later bulk eligibility checks', async () => {
  const f = fixture({ prepare: () => { throw Object.assign(new Error('DNS adres niet gevonden'), {
    code: 'WEBDESIGN_WEBSITE_DNS_MISSING', retryableWebsiteFetch: false,
  }); } });
  await assert.rejects(f.poll(), /DNS adres niet gevonden/);
  const saved = f.row().payload.subscriptionPreparation;
  assert.equal(saved.phase, 'failed');
  assert.equal(saved.errorCode, 'WEBDESIGN_WEBSITE_DNS_MISSING');
  assert.equal(saved.retryableWebsiteFetch, false);
  assert.equal(f.row().status, 'error');
});

test('cancellation during preparation rejects its late response without overwriting job state', async () => {
  const pending = deferred(), started = deferred();
  const f = fixture({ prepare: () => { started.resolve(); return pending.promise; } });
  const response = f.poll(); await started.promise;
  f.stop(); const cancelled = structuredClone(f.row());
  pending.resolve(scan);
  assert.equal((await response).job, null);
  assert.deepEqual(f.row(), cancelled);
  assert.equal(f.finished.length, 0);
});

test('a slow optional colour reference does not fail a usable source website or preserve an old palette', async () => {
  const pending = deferred();
  const f = fixture({ references: () => pending.promise, timeout: 40 });
  f.row().payload.subscriptionBrandGuard = { palette: [{ hex: '#ff0000' }] };
  assert.equal((await f.poll()).job.id, job.id);
  assert.equal(f.scans(), 1);
  assert.equal(f.row().payload.subscriptionBrandGuard, null);
  assert.equal(f.finished.length, 0);
  pending.resolve([]);
});

test('repository CAS gives one preparation lease and rejects an expired owner', async () => {
  const f = fixture();
  const starts = await Promise.all([f.repository.beginPreparation(job.id, claim), f.repository.beginPreparation(job.id, claim)]);
  assert.equal(starts.filter((value) => value.preparation).length, 1);
  assert.equal(starts.filter((value) => value.waiting).length, 1);
  const first = starts.find((value) => value.preparation).preparation;
  f.advance(300001);
  const next = (await f.repository.beginPreparation(job.id, claim)).preparation;
  assert.notEqual(next.token, first.token);
  const stale = await f.repository.savePreparation(job.id, claim, first, { phase: 'ready', workerJob: job });
  assert.equal(stale.waiting, true);
  assert.equal(f.row().payload.subscriptionPreparation.token, next.token);
});

test('concurrent waiting heartbeats cannot discard a prepared response or spend extra scan attempts', async () => {
  let collisions = 0;
  const f = fixture({ beforeWrite: async (patch, row) => {
    if (patch.payload.subscriptionPreparation.phase === 'ready' && collisions < 2) {
      collisions++;
      row.payload.concurrentMetadata = 'preserved';
      assert.equal((await f.poll()).waiting, true);
    }
  } });
  const response = await f.poll();
  assert.equal(response.job.id, job.id);
  assert.equal(collisions, 2);
  assert.equal(f.scans(), 1);
  assert.equal(f.row().payload.subscriptionPreparation.attempts, 1);
  assert.equal(f.row().payload.concurrentMetadata, 'preserved');
  assert.deepEqual((await f.poll()).job, response.job);
});

test('save retries never overwrite a result finalized under the same preparation token', async () => {
  let collisions = 0;
  const f = fixture({ beforeWrite: async (patch, row) => {
    if (patch.payload.subscriptionPreparation.phase === 'failed') {
      collisions++;
      row.payload.subscriptionPreparation = { ...row.payload.subscriptionPreparation, phase: 'ready', workerJob: { id: job.id, claim } };
      f.advance(1); row.updated_at = new Date(Date.parse(row.updated_at) + 1).toISOString();
    }
  } });
  const expected = (await f.repository.beginPreparation(job.id, claim)).preparation;
  const result = await f.repository.savePreparation(job.id, claim, expected, { phase: 'failed', error: 'old failure' });
  assert.equal(result.waiting, true);
  assert.equal(collisions, 1);
  assert.equal(f.row().payload.subscriptionPreparation.phase, 'ready');
  assert.equal(f.row().payload.subscriptionPreparation.attempts, 1);
});

test('preparation survives ordinary job normalization and remains bound to its claim', async () => {
  const preparation = { phase: 'ready', attempts: 1, token: 'fixture', workerJob: { id: job.id, claim } };
  const payload = buildWebdesignJobPayload({ ...job, subscriptionPreparation: preparation });
  const normalized = normalizeWebdesignJobRow({ job_id: job.id, payload });
  assert.deepEqual(normalized.subscriptionPreparation, preparation);
  const f = fixture();
  assert.equal((await f.repository.beginPreparation(job.id, '22222222-2222-2222-2222-222222222222')).stopped, true);
  assert.equal(f.row().payload.subscriptionPreparation, undefined);
});

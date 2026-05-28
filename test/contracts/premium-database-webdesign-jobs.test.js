const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildDeviceMockupSvg,
  createPremiumDatabaseWebdesignJobsCoordinator,
  diagnoseWebdesignMockupRecord,
  getDeviceMockupRendererSpec,
  isSuspectWebdesignMockupRenderer,
} = require('../../server/services/premium-database-webdesign-jobs');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('premium database webdesign jobs do not break app bootstrap when sharp is unavailable', () => {
  const repoRoot = path.join(__dirname, '../..');
  const script = `
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request) {
      if (request === 'sharp') throw new Error('sharp linux binary missing');
      return originalLoad.apply(this, arguments);
    };
    require('./server/services/premium-database-webdesign-jobs');
    process.stdout.write('loaded');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'loaded');
});

test('premium database webdesign jobs keep Vercel sharp linux arm64 install explicit', () => {
  const repoRoot = path.join(__dirname, '../..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

  assert.equal(packageJson.optionalDependencies['@img/sharp-linux-arm64'], '^0.34.5');
  assert.equal(packageJson.optionalDependencies['@img/sharp-libvips-linux-arm64'], '^1.2.4');
  assert.equal(vercelConfig.installCommand, 'npm ci --include=optional');
});

test('premium database server mockup renderer matches the browser layout and embeds readable title fonts', async () => {
  const spec = getDeviceMockupRendererSpec();
  const laptop = spec.devices.find((device) => device.id === 'laptop');
  const tablet = spec.devices.find((device) => device.id === 'tablet');
  const phone = spec.devices.find((device) => device.id === 'phone');

  assert.equal(spec.renderer, 'softora-server-device-v7');
  assert.equal(spec.fileVersion, 'v7');
  assert.equal(spec.title.text, 'WEBDESIGN PREVIEW');
  assert.equal(spec.subtitle.text, 'Laptop - iPad - iPhone');
  assert.equal(laptop.screen.frame.left, 18);
  assert.equal(laptop.screen.frame.right, 18);
  assert.equal(laptop.screen.frame.top, 18);
  assert.equal(laptop.screen.frame.bottom, 28);
  assert.equal(laptop.fitMode, 'viewport-width');
  assert.equal(tablet.screen.frame.left, 14);
  assert.equal(phone.screen.frame.left, 10);

  const svg = await buildDeviceMockupSvg(TINY_PNG_DATA_URL, { bedrijf: 'Softora' });
  assert.match(svg, /WEBDESIGN PREVIEW/);
  assert.match(svg, /Laptop - iPad - iPhone/);
  assert.match(svg, /SoftoraMockupOswald/);
  assert.match(svg, /SoftoraMockupInter/);
  assert.match(svg, /data:font\/woff2;base64,/);
  assert.match(svg, /x="155" y="260" width="930" height="560"/);
  assert.match(svg, /x="173" y="278" width="894" height="514"/);
  assert.doesNotMatch(svg, /x="290" y="335" width="964" height="520"/);
  assert.doesNotMatch(svg, /x="332" y="375" width="880" height="430"/);
});

test('premium database mockup diagnostics flag old server-rendered checked mockups for repair', () => {
  const suspect = diagnoseWebdesignMockupRecord({
    customerId: 'customer-bad',
    fileName: 'Bergman Transport B.V. webdesign.png',
    websiteMockupName: 'Bergman Transport B.V.-device-mockup-v6.jpg',
    websiteMockupUrl: 'https://example.test/mockup.jpg',
    mockupRenderer: 'softora-server-device-v6',
    mockupOrientation: 'upright',
    mockupQualityStatus: 'checked',
    mockupQualityCheckedAt: '2026-05-28T16:02:12.000Z',
    updatedAt: '2026-05-28T16:02:12.000Z',
  });
  const fixed = diagnoseWebdesignMockupRecord({
    customerId: 'customer-good',
    fileName: 'PLUS Ammerlaan webdesign.png',
    websiteMockupName: 'PLUS Ammerlaan-device-mockup-v7.jpg',
    websiteMockupUrl: 'https://example.test/mockup-good.jpg',
    mockupRenderer: 'softora-server-device-v7',
    mockupOrientation: 'upright',
    mockupQualityStatus: 'checked',
    mockupQualityCheckedAt: '2026-05-28T16:02:17.000Z',
  });

  assert.equal(isSuspectWebdesignMockupRenderer('softora-server-device-v6'), true);
  assert.equal(isSuspectWebdesignMockupRenderer('softora-server-device-v7'), false);
  assert.equal(suspect.status, 'needs_review');
  assert.deepEqual(suspect.reasons, ['suspect_server_renderer_v6', 'checked_before_visual_renderer_gate']);
  assert.equal(suspect.websitePhotoName, 'Bergman Transport B.V. webdesign.png');
  assert.equal(suspect.websiteMockupName, 'Bergman Transport B.V.-device-mockup-v6.jpg');
  assert.equal(fixed.status, 'ok');
  assert.deepEqual(fixed.reasons, []);
});

async function waitForJobDone(coordinator, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = coordinator._jobs.get(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) return job;
    await wait(20);
  }
  return coordinator._jobs.get(jobId);
}

test('premium database webdesign jobs generate and persist a customer photo in the background', async () => {
  let values = {
    softora_database_photos_removed_v1: JSON.stringify(['customer-1']),
  };
  const pipelineCalls = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async (url, options) => {
        pipelineCalls.push({ url, options });
        return {
          ok: true,
          site: { host: new URL(url).hostname },
          image: {
            dataUrl: TINY_PNG_DATA_URL,
            fileName: `${options.body.company}-webdesign.png`,
          },
        };
      },
    },
    getUiStateValues: async () => ({ values }),
    setUiStateValues: async (_scope, nextValues) => {
      values = nextValues;
      return { values };
    },
  });

  const res = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'serve@softora.nl', userId: 'user-1' },
      body: {
        jobId: 'job_1234567890123',
        websiteUrl: 'softora.nl',
        customer: {
          id: 'customer-1',
          bedrijf: 'Softora',
          naam: 'Serve',
          tel: '+31612345678',
          dom: 'softora.nl',
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.job.status, 'queued');

  const job = await waitForJobDone(coordinator, 'job_1234567890123');
  assert.equal(job.status, 'done');

  const photoMap = JSON.parse(values.softora_database_photos_v1);
  assert.equal(photoMap['customer-1'].id, 'customer-1');
  assert.equal(photoMap['customer-1'].identityKey, 'softora|serve|31612345678');
  assert.equal(values['softora_database_photo_data_v1_customer-1_0'], TINY_PNG_DATA_URL);
  assert.match(values['softora_database_photo_data_v1_customer-1_mockup_0'], /^data:image\/jpeg;base64,/);
  assert.equal(photoMap['customer-1'].websiteMockupName, 'Softora-webdesign-device-mockup-v7.jpg');
  assert.equal(photoMap['customer-1'].mockupRenderer, 'softora-server-device-v7');
  assert.equal(photoMap['customer-1'].mockupOrientation, 'upright');
  assert.equal(photoMap['customer-1'].mockupQualityStatus, 'checked');
  assert.deepEqual(JSON.parse(values.softora_database_photos_removed_v1), []);
  assert.equal(pipelineCalls[0].options.imageSize, '1024x1536');
  assert.equal(pipelineCalls[0].options.disableReferenceImages, true);
  assert.equal(pipelineCalls[0].options.referenceImageMode, 'prompt-only');
  assert.equal(pipelineCalls[0].options.body.source, 'premium-database');
});

test('premium database webdesign jobs keep status access scoped to the logged in user', async () => {
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({
        image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' },
      }),
    },
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ values: {} }),
  });

  const startRes = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_abcdef123456789',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-2', bedrijf: 'Softora' },
      },
    },
    startRes
  );

  const statusRes = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'other@softora.nl', userId: 'other' },
      params: { jobId: 'job_abcdef123456789' },
    },
    statusRes
  );

  assert.equal(statusRes.statusCode, 403);
  assert.equal(statusRes.body.ok, false);
});

test('premium database webdesign jobs persist status and generated photos through data ops storage', async () => {
  const persistedJobs = [];
  const uploadedPhotos = [];
  let latestJob = null;
  const dataOpsStore = {
    upsertWebdesignJob: async (job) => {
      latestJob = {
        ...job,
        customer: { ...job.customer },
      };
      persistedJobs.push(latestJob.status);
      return { ok: true };
    },
    getWebdesignJob: async (jobId) => (latestJob && latestJob.id === jobId ? latestJob : null),
    uploadDesignPhoto: async (entry, meta) => {
      uploadedPhotos.push({ entry, meta });
      return { ok: true };
    },
  };
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({
        image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' },
      }),
    },
    getUiStateValues: async () => {
      throw new Error('legacy photo storage should not be needed');
    },
    setUiStateValues: async () => {
      throw new Error('legacy photo storage should not be needed');
    },
  });

  const startRes = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_persist123456',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-persist', bedrijf: 'Softora' },
      },
    },
    startRes
  );

  assert.equal(startRes.statusCode, 202);
  assert.equal(startRes.body.job.status, 'queued');
  assert.deepEqual(persistedJobs, ['queued']);
  assert.equal(uploadedPhotos.length, 0);

  const statusRes = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_persist123456' },
    },
    statusRes
  );

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.job.status, 'done');
  assert.deepEqual(persistedJobs, ['queued', 'running', 'done']);
  assert.equal(uploadedPhotos[0].entry.customerId, 'customer-persist');
  assert.match(uploadedPhotos[0].entry.websiteMockup, /^data:image\/jpeg;base64,/);
  assert.equal(uploadedPhotos[0].entry.websiteMockupName, 'preview-device-mockup-v7.jpg');
  assert.equal(uploadedPhotos[0].entry.mockupRenderer, 'softora-server-device-v7');
  assert.equal(uploadedPhotos[0].entry.mockupOrientation, 'upright');
  assert.equal(uploadedPhotos[0].entry.mockupQualityStatus, 'checked');
  assert.equal(uploadedPhotos[0].meta.source, 'premium-database-webdesign-jobs');

  const resumedCoordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    dataOpsStore,
  });
  const getRes = createResponseRecorder();
  await resumedCoordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_persist123456' },
    },
    getRes
  );

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.job.status, 'done');
});

test('premium database webdesign jobs list running jobs for the current user', async () => {
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        await wait(50);
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } };
      },
    },
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ values: {} }),
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_list123456789',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-list', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  const res = createResponseRecorder();
  await coordinator.listJobsResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.jobs.length, 1);
  assert.equal(res.body.jobs[0].customerId, 'customer-list');
});

test('premium database webdesign jobs requeue retryable OpenAI rate limits and resume after the wait', async () => {
  let nowMs = 1760000000000;
  let pipelineCalls = 0;
  const persistedJobs = [];
  const uploadedPhotos = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    now: () => nowMs,
    retryJitter: false,
    dataOpsStore: {
      upsertWebdesignJob: async (job) => {
        persistedJobs.push({
          status: job.status,
          retry: job.retry ? { ...job.retry } : null,
        });
        return { ok: true };
      },
      uploadDesignPhoto: async (entry) => {
        uploadedPhotos.push(entry);
        return { ok: true };
      },
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        if (pipelineCalls === 1) {
          const error = new Error(
            'OpenAI websitegenerator mislukt (429): Rate limit reached for gpt-image-2. Please try again in 3s.'
          );
          error.status = 429;
          error.retryableOpenAiImage = true;
          throw error;
        }
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'retry-preview.png' } };
      },
    },
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_retry1234567',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-retry', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  const firstPoll = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_retry1234567' },
    },
    firstPoll
  );

  assert.equal(firstPoll.statusCode, 200);
  assert.equal(firstPoll.body.job.status, 'queued');
  assert.equal(firstPoll.body.job.retryAttempts, 1);
  assert.equal(firstPoll.body.job.nextAttemptAt, nowMs + 3000);
  assert.equal(pipelineCalls, 1);

  const earlyPoll = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_retry1234567' },
    },
    earlyPoll
  );

  assert.equal(earlyPoll.body.job.status, 'queued');
  assert.equal(pipelineCalls, 1);

  nowMs = firstPoll.body.job.nextAttemptAt + 1;
  const retryPoll = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_retry1234567' },
    },
    retryPoll
  );

  assert.equal(retryPoll.body.job.status, 'done');
  assert.equal(retryPoll.body.job.nextAttemptAt, null);
  assert.equal(pipelineCalls, 2);
  assert.equal(uploadedPhotos[0].customerId, 'customer-retry');
  assert.ok(persistedJobs.some((job) => job.status === 'queued' && job.retry?.nextAttemptAt === 1760000003000));
});

test('premium database webdesign jobs keep non-retryable OpenAI errors as hard errors', async () => {
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        const error = new Error('Your organization must be verified to use the model `gpt-image-2`.');
        error.status = 403;
        throw error;
      },
    },
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ values: {} }),
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_harderror123',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-hard-error', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  const statusRes = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_harderror123' },
    },
    statusRes
  );

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.job.status, 'error');
  assert.match(statusRes.body.job.error, /organization must be verified/i);
});

test('premium database webdesign inline processing runs at most one OpenAI image job at once', async () => {
  let active = 0;
  let maxActive = 0;
  let pipelineCalls = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: {
      upsertWebdesignJob: async () => ({ ok: true }),
      uploadDesignPhoto: async () => ({ ok: true }),
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await wait(30);
        active -= 1;
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } };
      },
    },
  });

  for (const [jobId, customerId] of [
    ['job_inlineone123', 'customer-inline-1'],
    ['job_inlinetwo123', 'customer-inline-2'],
  ]) {
    await coordinator.startJobResponse(
      {
        premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
        body: {
          jobId,
          websiteUrl: 'https://softora.nl',
          customer: { id: customerId, bedrijf: 'Softora' },
        },
      },
      createResponseRecorder()
    );
  }

  const firstPoll = createResponseRecorder();
  const secondPoll = createResponseRecorder();
  await Promise.all([
    coordinator.getJobResponse(
      {
        premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
        params: { jobId: 'job_inlineone123' },
      },
      firstPoll
    ),
    coordinator.getJobResponse(
      {
        premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
        params: { jobId: 'job_inlinetwo123' },
      },
      secondPoll
    ),
  ]);

  assert.equal(maxActive, 1);
  assert.equal(pipelineCalls, 1);
  assert.equal(firstPoll.body.job.status, 'done');
  assert.equal(secondPoll.body.job.status, 'queued');

  const finalPoll = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_inlinetwo123' },
    },
    finalPoll
  );

  assert.equal(finalPoll.body.job.status, 'done');
  assert.equal(pipelineCalls, 2);
});

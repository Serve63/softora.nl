const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPremiumDatabaseWebdesignJobsCoordinator,
} = require('../../server/services/premium-database-webdesign-jobs');

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

async function waitForJobDone(coordinator, jobId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = coordinator._jobs.get(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) return job;
    await wait(10);
  }
  return coordinator._jobs.get(jobId);
}

test('premium database webdesign jobs generate and persist a customer photo in the background', async () => {
  let values = {};
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async (url, options) => ({
        ok: true,
        site: { host: new URL(url).hostname },
        image: {
          dataUrl: 'data:image/png;base64,AAAA',
          fileName: `${options.body.company}-webdesign.png`,
        },
      }),
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
  assert.equal(values['softora_database_photo_data_v1_customer-1_0'], 'data:image/png;base64,AAAA');
});

test('premium database webdesign jobs retry OpenAI rate limits before failing the job', async () => {
  let values = {};
  let attempts = 0;
  const retryWaits = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    waitForRetry: async (ms) => {
      retryWaits.push(ms);
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('OpenAI websitegenerator mislukt (429): Rate limit reached. Please try again in 12s.');
          error.status = 429;
          throw error;
        }
        return {
          image: { dataUrl: 'data:image/png;base64,AAAA', fileName: 'preview.png' },
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
        jobId: 'job_ratelimit12345',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-rate-limit', bedrijf: 'Softora' },
      },
    },
    res
  );

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.job.status, 'done');
  assert.equal(attempts, 2);
  assert.deepEqual(retryWaits, [13000]);
  assert.match(values['softora_database_photo_data_v1_customer-rate-limit_0'], /^data:image\/png;base64,AAAA$/);
});

test('premium database webdesign jobs keep status access scoped to the logged in user', async () => {
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({
        image: { dataUrl: 'data:image/png;base64,AAAA', fileName: 'preview.png' },
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

test('premium database webdesign jobs share status access between admin personeel accounts', async () => {
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        await wait(50);
        return { image: { dataUrl: 'data:image/png;base64,AAAA', fileName: 'preview.png' } };
      },
    },
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ values: {} }),
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: {
        authenticated: true,
        email: 'serve@softora.nl',
        userId: 'usr_serve',
        role: 'admin',
        isAdmin: true,
      },
      body: {
        jobId: 'job_adminshared123',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-admin-share', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  const getRes = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: {
        authenticated: true,
        email: 'martijn@softora.nl',
        userId: 'usr_martijn',
        role: 'admin',
        isAdmin: true,
      },
      params: { jobId: 'job_adminshared123' },
    },
    getRes
  );

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.ok, true);
  assert.equal(getRes.body.job.customerId, 'customer-admin-share');

  const listRes = createResponseRecorder();
  await coordinator.listJobsResponse(
    {
      premiumAuth: {
        authenticated: true,
        email: 'martijn@softora.nl',
        userId: 'usr_martijn',
        role: 'admin',
        isAdmin: true,
      },
    },
    listRes
  );

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.jobs.some((job) => job.customerId === 'customer-admin-share'), true);
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
        image: { dataUrl: 'data:image/png;base64,AAAA', fileName: 'preview.png' },
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
  assert.equal(startRes.body.job.status, 'done');
  assert.deepEqual(persistedJobs, ['queued', 'running', 'done']);
  assert.equal(uploadedPhotos[0].entry.customerId, 'customer-persist');
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
        return { image: { dataUrl: 'data:image/png;base64,AAAA', fileName: 'preview.png' } };
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

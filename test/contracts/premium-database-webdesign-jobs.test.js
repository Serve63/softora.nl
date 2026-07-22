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
  trimUniformWebdesignSideGuttersDataUrl,
} = require('../../server/services/premium-database-webdesign-jobs');
const {
  registerPremiumDatabaseWebdesignJobRoutes,
} = require('../../server/routes/premium-database-webdesign-jobs');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==';

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

async function callRouteHandlers(handlers, req = {}) {
  const res = createResponseRecorder();
  let index = 0;
  async function next() {
    const handler = handlers[index];
    index += 1;
    if (typeof handler === 'function') {
      await handler(req, res, next);
    }
  }
  await next();
  return res;
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRetryableOpenAi500Error() {
  const error = new Error(
    'OpenAI websitegenerator mislukt (500): The server had an error while processing your request. Sorry about that! You can retry your request, or contact us through our help center at help.openai.com if the error persists. (Please include the request ID req_7d9c53460a9f4c5a8ec43e369fb1caa7 in your message.)'
  );
  error.status = 500;
  error.retryableOpenAiImage = true;
  return error;
}

function createRetryableV2ReferenceError() {
  const error = new Error(
    'De homepage-screenshot voor V2 was nog niet beschikbaar. De opdracht probeert het automatisch opnieuw.'
  );
  error.status = 503;
  error.retryableWebdesignReference = true;
  return error;
}

async function createSideGutterWebdesignDataUrl(options = {}) {
  const sharp = require('sharp');
  const width = Number(options.width) || 1024;
  const height = Number(options.height) || 1536;
  const left = Number(options.left) || 184;
  const right = Number(options.right) || 185;
  const contentWidth = width - left - right;
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#ffffff"/>
      <rect x="${left}" y="0" width="${contentWidth}" height="${height}" fill="#123456"/>
      <rect x="${left + 48}" y="72" width="${contentWidth - 96}" height="180" rx="18" fill="#f97316"/>
      <rect x="${left + 48}" y="320" width="${contentWidth - 96}" height="72" rx="14" fill="#ffffff" opacity="0.96"/>
    </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function getDataUrlMetadata(dataUrl) {
  const sharp = require('sharp');
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return sharp(Buffer.from(base64, 'base64')).metadata();
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

test('premium database webdesign jobs keep Vercel sharp linux installs explicit', () => {
  const repoRoot = path.join(__dirname, '../..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

  assert.equal(packageJson.optionalDependencies['@img/sharp-linux-arm64'], '^0.35.3');
  assert.equal(packageJson.optionalDependencies['@img/sharp-libvips-linux-arm64'], '^1.3.2');
  assert.equal(packageJson.optionalDependencies['@img/sharp-linux-x64'], '^0.35.3');
  assert.equal(packageJson.optionalDependencies['@img/sharp-libvips-linux-x64'], '^1.3.2');
  assert.equal(
    vercelConfig.installCommand,
    'npm ci --include=optional && npm install --os=linux --cpu=arm64 --libc=glibc --include=optional --no-save sharp@0.35.3 @img/sharp-linux-arm64@0.35.3 @img/sharp-libvips-linux-arm64@1.3.2'
  );
  Object.values(vercelConfig.functions).forEach((functionConfig) => {
    assert.equal(
      functionConfig.includeFiles,
      '{*.html,assets/fonts/**,assets/premium-sidebar-profile-prefill.js,node_modules/sharp/**,node_modules/@img/sharp-linux-x64/**,node_modules/@img/sharp-libvips-linux-x64/**,node_modules/@img/sharp-linux-arm64/**,node_modules/@img/sharp-libvips-linux-arm64/**}'
    );
  });
});

test('premium database webdesign job routes expose persistent bulk endpoints', () => {
  const routes = [];
  const app = {
    post(pathname) { routes.push(['POST', pathname]); },
    get(pathname) { routes.push(['GET', pathname]); },
  };
  registerPremiumDatabaseWebdesignJobRoutes(app, { coordinator: {} });

  assert.deepEqual(routes, [
    ['POST', '/api/premium-database/webdesign-photo-jobs'],
    ['GET', '/api/premium-database/webdesign-photo-jobs'],
    ['GET', '/api/premium-database/webdesign-photo-jobs/:jobId'],
    ['POST', '/api/premium-database/webdesign-photo-batches'],
    ['GET', '/api/premium-database/webdesign-photo-batches'],
    ['POST', '/api/premium-database/webdesign-photo-batches/run'],
    ['GET', '/api/premium-database/webdesign-photo-batches/run'],
    ['POST', '/api/premium-database/webdesign-photo-batches/:batchId/chunks'],
    ['POST', '/api/premium-database/webdesign-photo-batches/:batchId/commit'],
    ['POST', '/api/premium-database/webdesign-photo-batches/:batchId/cancel'],
    ['GET', '/api/premium-database/webdesign-photo-batches/:batchId'],
  ]);
});

test('premium database webdesign bulk runner cron route requires CRON_SECRET bearer access', async () => {
  let cronRunHandlers = null;
  let adminRunHandlers = null;
  let workerCalls = 0;
  const app = {
    post(pathname, ...handlers) {
      if (pathname === '/api/premium-database/webdesign-photo-batches/run') adminRunHandlers = handlers;
    },
    get(pathname, ...handlers) {
      if (pathname === '/api/premium-database/webdesign-photo-batches/run') cronRunHandlers = handlers;
    },
  };
  registerPremiumDatabaseWebdesignJobRoutes(app, {
    cronSecret: 'cron-secret',
    requirePremiumApiAccess: (_req, _res, next) => next(),
    coordinator: {
      runBatchWorkerResponse: async (_req, res) => {
        workerCalls += 1;
        return res.status(200).json({ ok: true });
      },
    },
  });

  const denied = await callRouteHandlers(cronRunHandlers, { headers: { authorization: 'Bearer wrong' } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.code, 'WEBDESIGN_BULK_CRON_UNAUTHORIZED');
  assert.equal(workerCalls, 0);

  const allowed = await callRouteHandlers(cronRunHandlers, { headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(workerCalls, 1);

  const admin = await callRouteHandlers(adminRunHandlers, { headers: {}, body: {} });
  assert.equal(admin.statusCode, 200);
  assert.equal(workerCalls, 2);
});

test('premium database webdesign bulk cancel route requires premium access', async () => {
  let cancelHandlers = null;
  let accessCalls = 0;
  let cancelCalls = 0;
  const app = {
    post(pathname, ...handlers) {
      if (pathname === '/api/premium-database/webdesign-photo-batches/:batchId/cancel') cancelHandlers = handlers;
    },
    get() {},
  };
  registerPremiumDatabaseWebdesignJobRoutes(app, {
    requirePremiumApiAccess: (_req, _res, next) => {
      accessCalls += 1;
      return next();
    },
    coordinator: {
      cancelBatchResponse: async (_req, res) => {
        cancelCalls += 1;
        return res.status(200).json({ ok: true });
      },
    },
  });

  const res = await callRouteHandlers(cancelHandlers, { headers: {}, body: {}, params: { batchId: 'webdesign_batch_123' } });

  assert.equal(res.statusCode, 200);
  assert.equal(accessCalls, 1);
  assert.equal(cancelCalls, 1);
});

test('premium database webdesign bulk runner is registered as a Vercel cron', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  const workerCron = vercelConfig.crons.find((cron) => cron.path === '/api/premium-database/webdesign-photo-batches/run');

  assert.equal(workerCron.schedule, '* * * * *');
});

test('premium database server mockup renderer matches the browser layout without fragile text labels', async () => {
  const spec = getDeviceMockupRendererSpec();
  const laptop = spec.devices.find((device) => device.id === 'laptop');
  const tablet = spec.devices.find((device) => device.id === 'tablet');
  const phone = spec.devices.find((device) => device.id === 'phone');

  assert.equal(spec.renderer, 'softora-server-device-v8');
  assert.equal(spec.fileVersion, 'v8');
  assert.equal(laptop.screen.frame.left, 18);
  assert.equal(laptop.screen.frame.right, 18);
  assert.equal(laptop.screen.frame.top, 18);
  assert.equal(laptop.screen.frame.bottom, 28);
  assert.equal(laptop.fitMode, 'viewport-width');
  assert.equal(tablet.screen.frame.left, 14);
  assert.equal(phone.screen.frame.left, 10);

  const svg = await buildDeviceMockupSvg(TINY_PNG_DATA_URL, { bedrijf: 'Softora' });
  assert.doesNotMatch(svg, /WEBDESIGN PREVIEW/);
  assert.doesNotMatch(svg, /Laptop - iPad - iPhone/);
  assert.doesNotMatch(svg, /<text\b/);
  assert.doesNotMatch(svg, /data:font\/woff2;base64,/);
  assert.match(svg, /x="155" y="200" width="930" height="560"/);
  assert.match(svg, /x="173" y="218" width="894" height="514"/);
  assert.doesNotMatch(svg, /x="290" y="335" width="964" height="520"/);
  assert.doesNotMatch(svg, /x="332" y="375" width="880" height="430"/);
});

test('premium database trims AI side gutters without stretching the webdesign image', async () => {
  const dataUrl = await createSideGutterWebdesignDataUrl();
  const trimmed = await trimUniformWebdesignSideGuttersDataUrl(dataUrl);
  const metadata = await getDataUrlMetadata(trimmed.dataUrl);

  assert.equal(trimmed.cropped, true);
  assert.equal(trimmed.reason, 'trimmed_uniform_side_gutters');
  assert.equal(trimmed.original.width, 1024);
  assert.equal(trimmed.original.height, 1536);
  assert.equal(metadata.height, 1536);
  assert.equal(metadata.width, 691);
});

test('premium database mockup diagnostics flag text-label renderers for repair', () => {
  const suspect = diagnoseWebdesignMockupRecord({
    customerId: 'customer-bad',
    fileName: 'Bergman Transport B.V. webdesign.png',
    websiteMockupName: 'Bergman Transport B.V.-device-mockup-v7.jpg',
    websiteMockupUrl: 'https://example.test/mockup.jpg',
    mockupRenderer: 'softora-server-device-v7',
    mockupOrientation: 'upright',
    mockupQualityStatus: 'checked',
    mockupQualityCheckedAt: '2026-05-28T16:02:12.000Z',
    updatedAt: '2026-05-28T16:02:12.000Z',
  });
  const fixed = diagnoseWebdesignMockupRecord({
    customerId: 'customer-good',
    fileName: 'PLUS Ammerlaan webdesign.png',
    websiteMockupName: 'PLUS Ammerlaan-device-mockup-v8.jpg',
    websiteMockupUrl: 'https://example.test/mockup-good.jpg',
    mockupRenderer: 'softora-server-device-v8',
    mockupOrientation: 'upright',
    mockupQualityStatus: 'checked',
    mockupQualityCheckedAt: '2026-05-28T16:02:17.000Z',
  });

  assert.equal(isSuspectWebdesignMockupRenderer('softora-browser-device-v6'), true);
  assert.equal(isSuspectWebdesignMockupRenderer('softora-server-device-v6'), true);
  assert.equal(isSuspectWebdesignMockupRenderer('softora-server-device-v7'), true);
  assert.equal(isSuspectWebdesignMockupRenderer('softora-server-device-v8'), false);
  assert.equal(suspect.status, 'needs_review');
  assert.deepEqual(suspect.reasons, ['suspect_softora_server_device_v7', 'checked_before_visual_renderer_gate']);
  assert.equal(suspect.websitePhotoName, 'Bergman Transport B.V. webdesign.png');
  assert.equal(suspect.websiteMockupName, 'Bergman Transport B.V.-device-mockup-v7.jpg');
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInMemoryWebdesignBatchStore() {
  const jobs = new Map();
  const batches = new Map();
  const chunks = new Map();
  function clone(value) {
    return value ? cloneJson(value) : value;
  }
  return {
    jobs,
    batches,
    chunks,
    async upsertWebdesignJob(job) {
      jobs.set(job.id, clone(job));
      return { ok: true };
    },
    async getWebdesignJob(jobId) {
      return clone(jobs.get(jobId) || null);
    },
    async findRunningWebdesignJob(ownerKey, customerId) {
      for (const job of jobs.values()) {
        if (job.ownerKey === ownerKey && job.customer?.id === customerId && ['queued', 'running'].includes(job.status)) {
          return clone(job);
        }
      }
      return null;
    },
    async listVisibleWebdesignJobs(ownerKey) {
      return Array.from(jobs.values())
        .filter((job) => job.ownerKey === ownerKey && ['queued', 'running'].includes(job.status))
        .map(clone);
    },
    async upsertWebdesignBatch(batch) {
      batches.set(batch.id, clone(batch));
      return { ok: true };
    },
    async getWebdesignBatch(ownerKey, batchId) {
      const batch = batches.get(batchId);
      return batch && batch.ownerKey === ownerKey ? clone(batch) : null;
    },
    async listVisibleWebdesignBatches(ownerKey) {
      return Array.from(batches.values()).filter((batch) => batch.ownerKey === ownerKey).map(clone);
    },
    async listRunnableWebdesignBatches(limit = 5) {
      return Array.from(batches.values())
        .filter((batch) => batch.status === 'running')
        .sort((left, right) => (left.updatedAt || left.createdAt || 0) - (right.updatedAt || right.createdAt || 0))
        .slice(0, limit)
        .map(clone);
    },
    async upsertWebdesignBatchChunk(chunk) {
      chunks.set(chunk.id, clone(chunk));
      return { ok: true };
    },
    async listWebdesignBatchChunks(ownerKey, batchId) {
      return Array.from(chunks.values())
        .filter((chunk) => chunk.ownerKey === ownerKey && chunk.batchId === batchId)
        .sort((left, right) => left.index - right.index)
        .map(clone);
    },
    async uploadDesignPhoto(entry, meta) {
      return { ok: true, entry, meta };
    },
  };
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
  assert.equal(res.body.job.variant, 'v1-prompt-only');

  const job = await waitForJobDone(coordinator, 'job_1234567890123');
  assert.equal(job.status, 'done', job.error || 'webdesign job did not finish');

  const photoMap = JSON.parse(values.softora_database_photos_v1);
  assert.equal(photoMap['customer-1'].id, 'customer-1');
  assert.equal(photoMap['customer-1'].identityKey, 'softora|serve|31612345678');
  assert.equal(values['softora_database_photo_data_v1_customer-1_0'], TINY_PNG_DATA_URL);
  assert.match(values['softora_database_photo_data_v1_customer-1_mockup_0'], /^data:image\/jpeg;base64,/);
  assert.equal(photoMap['customer-1'].websiteMockupName, 'Softora-webdesign-device-mockup-v8.jpg');
  assert.equal(photoMap['customer-1'].mockupRenderer, 'softora-server-device-v8');
  assert.equal(photoMap['customer-1'].mockupOrientation, 'upright');
  assert.equal(photoMap['customer-1'].mockupQualityStatus, 'checked');
  assert.deepEqual(JSON.parse(values.softora_database_photos_removed_v1), []);
  assert.equal(pipelineCalls[0].options.imageSize, '1024x1536');
  assert.equal(pipelineCalls[0].options.disableReferenceImages, true);
  assert.equal(pipelineCalls[0].options.referenceImageMode, 'prompt-only');
  assert.equal(pipelineCalls[0].options.body.source, 'premium-database');
  assert.deepEqual(pipelineCalls[0].options.body.softoraOutreachProfile, {
    name: 'Servé Creusen',
    roleLabel: 'WEBDESIGN & SOFTWARE ONTWIKKELING',
    source: 'premium-database-webdesign-jobs',
  });

  const martijnRes = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'contact.venvisuals@gmail.com', userId: 'user-2' },
      body: {
        jobId: 'job_venvisual_123456789',
        websiteUrl: 'venvisuals.nl',
        customer: {
          id: 'customer-venvisual',
          bedrijf: 'VenVisuals',
          naam: 'Martijn',
          tel: '+31687654321',
          dom: 'venvisuals.nl',
        },
      },
    },
    martijnRes
  );
  assert.equal(martijnRes.statusCode, 202);
  const martijnJob = await waitForJobDone(coordinator, 'job_venvisual_123456789');
  assert.equal(martijnJob.status, 'done');
  assert.deepEqual(pipelineCalls[1].options.body.softoraOutreachProfile, {
    name: 'Martijn van de Ven',
    roleLabel: 'WEBDESIGN & SOFTWARE ONTWIKKELING',
    source: 'premium-database-webdesign-jobs',
  });

  const v2Res = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'serve@softora.nl', userId: 'user-1' },
      body: {
        jobId: 'job_visual_dna_123456789',
        variant: 'v2-visual-dna',
        websiteUrl: 'https://www.bliv.nl/',
        customer: {
          id: 'customer-v2',
          bedrijf: 'Bliv Makelaardij',
          dom: 'bliv.nl',
        },
      },
    },
    v2Res
  );
  assert.equal(v2Res.statusCode, 202);
  assert.equal(v2Res.body.job.variant, 'v2-visual-dna');
  const v2Job = await waitForJobDone(coordinator, 'job_visual_dna_123456789');
  assert.equal(v2Job.status, 'done');
  assert.equal(pipelineCalls[2].options.disableReferenceImages, false);
  assert.equal(pipelineCalls[2].options.referenceImageMode, 'homepage-screenshot');
  assert.equal(pipelineCalls[2].options.requireReferenceImages, true);
  assert.equal(pipelineCalls[2].options.body.variant, 'v2-visual-dna');
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
  assert.equal(uploadedPhotos[0].entry.websiteMockupName, 'preview-device-mockup-v8.jpg');
  assert.equal(uploadedPhotos[0].entry.mockupRenderer, 'softora-server-device-v8');
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

test('premium database webdesign bulk batches process targets through a persistent small queue', async () => {
  const store = createInMemoryWebdesignBatchStore();
  const pipelineCalls = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    bulkActiveJobLimit: 2,
    bulkStartLimit: 2,
    bulkReconcileLimit: 1,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async (url, options) => {
        pipelineCalls.push({ url, company: options.body.company });
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: `${options.body.company}-preview.png` } };
      },
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 5 } }, startRes);
  assert.equal(startRes.statusCode, 202);
  const batchId = startRes.body.batch.id;

  const chunkRes = createResponseRecorder();
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        offset: 0,
        targets: Array.from({ length: 5 }, (_, index) => ({
          websiteUrl: `https://bedrijf-${index}.test`,
          customer: { id: `customer-${index}`, bedrijf: `Bedrijf ${index}`, dom: `bedrijf-${index}.test` },
        })),
      },
    },
    chunkRes
  );
  assert.equal(chunkRes.statusCode, 202);
  assert.equal(chunkRes.body.batch.uploadedTargets, 5);

  const commitRes = createResponseRecorder();
  await coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 5, expectedChunks: 1 } }, commitRes);
  assert.equal(commitRes.statusCode, 202);
  assert.equal(commitRes.body.batch.total, 5);
  assert.ok(commitRes.body.batch.queued <= 2);
  assert.ok(commitRes.body.batch.activeJobIds.length <= 2);
  assert.equal(pipelineCalls.length, 0);

  let latest = commitRes.body.batch;
  for (let attempt = 0; attempt < 20 && latest.status !== 'done'; attempt += 1) {
    for (const jobId of latest.activeJobIds || []) {
      const jobRes = createResponseRecorder();
      await coordinator.getJobResponse({ premiumAuth: auth, params: { jobId } }, jobRes);
      assert.equal(jobRes.statusCode, 200);
    }
    const statusRes = createResponseRecorder();
    await coordinator.getBatchResponse({ premiumAuth: auth, params: { batchId } }, statusRes);
    assert.equal(statusRes.statusCode, 200);
    latest = statusRes.body.batch;
  }

  assert.equal(latest.status, 'done');
  assert.equal(latest.made, 5);
  assert.equal(latest.failed, 0);
  assert.equal(pipelineCalls.length, 5);
});

test('premium database webdesign bulk starts a larger default active window for faster generation', async () => {
  const store = createInMemoryWebdesignBatchStore();
  let pipelineCalls = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } };
      },
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 50 } }, startRes);
  const batchId = startRes.body.batch.id;
  const chunkRes = createResponseRecorder();
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        offset: 0,
        targets: Array.from({ length: 50 }, (_, index) => ({
          websiteUrl: `https://bedrijf-fast-${index}.test`,
          customer: { id: `customer-fast-${index}`, bedrijf: `Bedrijf Fast ${index}`, dom: `bedrijf-fast-${index}.test` },
        })),
      },
    },
    chunkRes
  );

  const commitRes = createResponseRecorder();
  await coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 50, expectedChunks: 1 } }, commitRes);

  assert.equal(commitRes.statusCode, 202);
  assert.equal(commitRes.body.batch.active, 36);
  assert.equal(commitRes.body.batch.queued, 36);
  assert.equal(commitRes.body.batch.activeJobIds.length, 36);
  assert.equal(pipelineCalls, 0);
});

test('premium database webdesign bulk server worker processes batches without browser job polling', async () => {
  const store = createInMemoryWebdesignBatchStore();
  const pipelineCalls = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async (url, options) => {
        pipelineCalls.push({ url, company: options.body.company });
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: `${options.body.company}-preview.png` } };
      },
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 4 } }, startRes);
  const batchId = startRes.body.batch.id;
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        targets: Array.from({ length: 4 }, (_, index) => ({
          websiteUrl: `https://server-worker-${index}.test`,
          customer: { id: `server-worker-${index}`, bedrijf: `Server Worker ${index}`, dom: `server-worker-${index}.test` },
        })),
      },
    },
    createResponseRecorder()
  );
  await coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 4, expectedChunks: 1 } }, createResponseRecorder());

  const run = await coordinator.runBatchWorker({ batchLimit: 1, jobLimit: 4, concurrency: 2 });

  assert.equal(run.ok, true);
  assert.equal(run.batchCount, 1);
  assert.equal(run.processedJobs, 4);
  assert.equal(pipelineCalls.length, 4);
  assert.equal(run.batches[0].status, 'done');
  assert.equal(run.batches[0].made, 4);
  assert.equal(run.batches[0].remaining, 0);
});

test('premium database webdesign bulk cancel stops the remaining server batch work', async () => {
  const store = createInMemoryWebdesignBatchStore();
  const pipelineCalls = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    bulkActiveJobLimit: 2,
    bulkStartLimit: 2,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async (url, options) => {
        pipelineCalls.push({ url, company: options.body.company });
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: `${options.body.company}-preview.png` } };
      },
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 4 } }, startRes);
  const batchId = startRes.body.batch.id;
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        targets: Array.from({ length: 4 }, (_, index) => ({
          websiteUrl: `https://cancel-${index}.test`,
          customer: { id: `cancel-${index}`, bedrijf: `Cancel ${index}`, dom: `cancel-${index}.test` },
        })),
      },
    },
    createResponseRecorder()
  );
  await coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 4, expectedChunks: 1 } }, createResponseRecorder());

  const firstRun = await coordinator.runBatchWorker({ batchLimit: 1, jobLimit: 1, concurrency: 1 });
  assert.equal(firstRun.processedJobs, 1);
  assert.equal(pipelineCalls.length, 1);

  const cancelRes = createResponseRecorder();
  await coordinator.cancelBatchResponse({ premiumAuth: auth, params: { batchId } }, cancelRes);

  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.body.cancelled, true);
  assert.equal(cancelRes.body.cancelledTargets, 3);
  assert.equal(cancelRes.body.batch.status, 'cancelled');
  assert.equal(cancelRes.body.batch.made, 1);
  assert.equal(cancelRes.body.batch.cancelled, 3);
  assert.equal(cancelRes.body.batch.remaining, 0);

  const secondRun = await coordinator.runBatchWorker({ batchLimit: 1, jobLimit: 4, concurrency: 2 });
  assert.equal(secondRun.batchCount, 0);
  assert.equal(pipelineCalls.length, 1);
});

test('premium database webdesign bulk cancel hides active batch jobs from the running jobs list', async () => {
  const store = createInMemoryWebdesignBatchStore();
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({ image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } }),
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };
  const ownerKey = 'owner@softora.nl::owner';

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 1 } }, startRes);
  const batchId = startRes.body.batch.id;
  const jobResult = await coordinator.startJob({
    ownerKey,
    batchId,
    batchTargetIndex: 0,
    jobId: 'job_orphan_batch_123',
    websiteUrl: 'https://cancel-loader.test',
    customer: { id: 'cancel-loader', bedrijf: 'Cancel Loader' },
  });
  assert.equal(jobResult.ok, true);

  const beforeList = createResponseRecorder();
  await coordinator.listJobsResponse({ premiumAuth: auth }, beforeList);
  assert.equal(beforeList.body.jobs.length, 1);
  assert.equal(beforeList.body.jobs[0].id, 'job_orphan_batch_123');

  const cancelRes = createResponseRecorder();
  await coordinator.cancelBatchResponse({ premiumAuth: auth, params: { batchId } }, cancelRes);
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.body.cancelled, true);
  assert.deepEqual(cancelRes.body.cancelledJobIds, ['job_orphan_batch_123']);

  const afterList = createResponseRecorder();
  await coordinator.listJobsResponse({ premiumAuth: auth }, afterList);
  assert.equal(afterList.statusCode, 200);
  assert.equal(afterList.body.jobs.length, 0);
  assert.equal(store.jobs.get('job_orphan_batch_123').status, 'error');
  assert.equal(store.jobs.get('job_orphan_batch_123').cancelled, true);
});

test('premium database webdesign bulk treats completed batches with cancelled targets as cancelled', async () => {
  const store = createInMemoryWebdesignBatchStore();
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({ image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } }),
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };
  const ownerKey = 'owner@softora.nl::owner';
  const batchId = 'webdesign_batch_done_after_cancel';
  store.batches.set(batchId, {
    id: batchId,
    ownerKey,
    status: 'done',
    total: 1806,
    uploadedTargets: 1806,
    summary: { total: 1806, uploadedTargets: 1806, pending: 0, queued: 0, running: 0, done: 336, failed: 64, cancelled: 1406 },
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    finishedAt: Date.now(),
  });

  const listRes = createResponseRecorder();
  await coordinator.listBatchesResponse({ premiumAuth: auth }, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.batches.length, 1);
  assert.equal(listRes.body.batches[0].status, 'cancelled');
  assert.equal(listRes.body.batches[0].made, 336);
  assert.equal(listRes.body.batches[0].cancelled, 1406);
  assert.equal(listRes.body.batches[0].remaining, 0);
});

test('premium database webdesign bulk stale workers cannot overwrite a stored cancellation', async () => {
  const baseStore = createInMemoryWebdesignBatchStore();
  const ownerKey = 'owner@softora.nl::owner';
  const batchId = 'webdesign_batch_stale_worker_cancelled';
  const staleBatch = {
    id: batchId,
    ownerKey,
    status: 'running',
    total: 2,
    uploadedTargets: 2,
    summary: { total: 2, uploadedTargets: 2, pending: 0, queued: 0, running: 2, done: 0, failed: 0, cancelled: 0 },
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 500,
  };
  const staleChunks = [{
    id: `${batchId}_chunk_00000`,
    ownerKey,
    batchId,
    index: 0,
    targets: [
      { index: 0, status: 'done', jobId: 'job_done_1', websiteUrl: 'https://stale-1.test', customer: { id: 'stale-1', bedrijf: 'Stale 1' } },
      { index: 1, status: 'error', jobId: 'job_done_2', error: 'Webdesign maken is mislukt.', websiteUrl: 'https://stale-2.test', customer: { id: 'stale-2', bedrijf: 'Stale 2' } },
    ],
  }];
  baseStore.batches.set(batchId, {
    id: batchId,
    ownerKey,
    status: 'cancelled',
    total: 2,
    uploadedTargets: 2,
    summary: { total: 2, uploadedTargets: 2, pending: 0, queued: 0, running: 0, done: 0, failed: 0, cancelled: 2 },
    finishedAt: Date.now(),
  });
  const savedBatchStatuses = [];
  const store = {
    ...baseStore,
    async listRunnableWebdesignBatches() {
      return [cloneJson(staleBatch)];
    },
    async listWebdesignBatchChunks() {
      return cloneJson(staleChunks);
    },
    async upsertWebdesignBatch(batch) {
      savedBatchStatuses.push(batch.status);
      return baseStore.upsertWebdesignBatch(batch);
    },
  };
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({ image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } }),
    },
  });

  const run = await coordinator.runBatchWorker({ batchLimit: 1, jobLimit: 2, concurrency: 1 });

  assert.equal(run.ok, true);
  assert.equal(run.batches[0].status, 'cancelled');
  assert.deepEqual(savedBatchStatuses, []);
  assert.equal(baseStore.batches.get(batchId).status, 'cancelled');
  assert.equal(baseStore.batches.get(batchId).summary.cancelled, 2);
});

test('premium database webdesign bulk cancel reports storage cause when saving fails', async () => {
  const baseStore = createInMemoryWebdesignBatchStore();
  const store = {
    ...baseStore,
    async upsertWebdesignBatch(batch) {
      if (batch && batch.status === 'cancelled') {
        return {
          ok: false,
          error: {
            code: '23514',
            message: 'new row violates softora_webdesign_jobs_status_check',
            details: 'Failing row contains status cancelled.',
          },
        };
      }
      return baseStore.upsertWebdesignBatch(batch);
    },
  };
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => ({ image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } }),
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 1 } }, startRes);
  const batchId = startRes.body.batch.id;
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        targets: [{
          websiteUrl: 'https://cancel-fail.test',
          customer: { id: 'cancel-fail', bedrijf: 'Cancel Fail', dom: 'cancel-fail.test' },
        }],
      },
    },
    createResponseRecorder()
  );

  const storedBatch = store.batches.get(batchId);
  storedBatch.status = 'running';
  storedBatch.total = 1;
  storedBatch.uploadedTargets = 1;
  storedBatch.summary = { total: 1, uploadedTargets: 1, pending: 1, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };

  const cancelRes = createResponseRecorder();
  await coordinator.cancelBatchResponse({ premiumAuth: auth, params: { batchId } }, cancelRes);

  assert.equal(cancelRes.statusCode, 503);
  assert.equal(cancelRes.body.ok, false);
  assert.match(cancelRes.body.detail, /Oorzaak: batch-annulering markeren - new row violates softora_webdesign_jobs_status_check/);
  assert.doesNotMatch(cancelRes.body.detail, /\[object Object\]/);
  assert.equal(cancelRes.body.action, 'batch-annulering markeren');
  assert.equal(cancelRes.body.cause, 'new row violates softora_webdesign_jobs_status_check');
});

test('premium database webdesign bulk status returns active jobs without blocking on image generation', async () => {
  const store = createInMemoryWebdesignBatchStore();
  let pipelineCalls = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    bulkActiveJobLimit: 2,
    bulkStartLimit: 2,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } };
      },
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };
  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 2 } }, startRes);
  const batchId = startRes.body.batch.id;
  const chunkRes = createResponseRecorder();
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        targets: [
          { websiteUrl: 'https://bedrijf-1.test', customer: { id: 'customer-1', bedrijf: 'Bedrijf 1' } },
          { websiteUrl: 'https://bedrijf-2.test', customer: { id: 'customer-2', bedrijf: 'Bedrijf 2' } },
        ],
      },
    },
    chunkRes
  );
  const commitRes = createResponseRecorder();
  await coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 2, expectedChunks: 1 } }, commitRes);

  const statusRes = createResponseRecorder();
  await coordinator.getBatchResponse({ premiumAuth: auth, params: { batchId } }, statusRes);

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.batch.made, 0);
  assert.equal(statusRes.body.batch.active, 2);
  assert.equal(statusRes.body.batch.activeJobIds.length, 2);
  assert.equal(pipelineCalls, 0);
});

test('premium database webdesign jobs refuse queued success when persistent job storage fails', async () => {
  let pipelineCalls = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: {
      upsertWebdesignJob: async () => ({ ok: false }),
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'preview.png' } };
      },
    },
  });

  const startRes = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_persistfail123',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-persist-fail', bedrijf: 'Softora' },
      },
    },
    startRes
  );

  assert.equal(startRes.statusCode, 503);
  assert.equal(startRes.body.ok, false);
  assert.equal(startRes.body.error, 'Webdesign-opdracht opslaan mislukt');
  assert.equal(coordinator._jobs.has('job_persistfail123'), false);
  assert.equal(pipelineCalls, 0);
});

test('premium database webdesign jobs keep transient status read failures retryable', async () => {
  const readError = new Error('Supabase status read timeout');
  readError.webdesignJobStatusUnavailable = true;
  readError.statusCode = 503;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    dataOpsStore: {
      getWebdesignJob: async () => {
        throw readError;
      },
    },
  });

  const statusRes = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_readretry123' },
    },
    statusRes
  );

  assert.equal(statusRes.statusCode, 503);
  assert.equal(statusRes.body.ok, false);
  assert.equal(statusRes.body.retryable, true);
  assert.equal(statusRes.body.error, 'Webdesign-status tijdelijk niet bereikbaar');
  assert.notEqual(statusRes.body.error, 'Job niet gevonden');
});

test('premium database webdesign jobs store trimmed webdesign photos before mockup creation', async () => {
  const dataUrl = await createSideGutterWebdesignDataUrl();
  const uploadedPhotos = [];
  let latestJob = null;
  const dataOpsStore = {
    upsertWebdesignJob: async (job) => {
      latestJob = {
        ...job,
        customer: { ...job.customer },
      };
      return { ok: true };
    },
    getWebdesignJob: async (jobId) => (latestJob && latestJob.id === jobId ? latestJob : null),
    uploadDesignPhoto: async (entry) => {
      uploadedPhotos.push(entry);
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
        image: { dataUrl, fileName: 'preview.png' },
      }),
    },
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_trim12345678',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-trim', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_trim12345678' },
    },
    createResponseRecorder()
  );

  assert.equal(uploadedPhotos.length, 1);
  const storedMetadata = await getDataUrlMetadata(uploadedPhotos[0].dataUrl);
  const mockupMetadata = await getDataUrlMetadata(uploadedPhotos[0].websiteMockup);
  assert.equal(storedMetadata.width, 691);
  assert.equal(storedMetadata.height, 1536);
  assert.equal(mockupMetadata.width, 1600);
  assert.equal(mockupMetadata.height, 1000);
  assert.equal(uploadedPhotos[0].legacyMeta.webdesignCanvasRepair.type, 'trimmed_uniform_side_gutters');
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

test('premium database webdesign jobs hide expired persistent jobs and allow a fresh restart', async () => {
  const nowMs = Date.parse('2026-07-10T15:00:00.000Z');
  const store = createInMemoryWebdesignBatchStore();
  store.jobs.set('expired-job-123456', {
    id: 'expired-job-123456',
    ownerKey: 'owner@softora.nl::owner',
    websiteUrl: 'https://softora.nl/',
    customer: { id: 'customer-expired', bedrijf: 'Verlopen job' },
    status: 'queued',
    error: null,
    createdAt: nowMs - (7 * 60 * 60 * 1000),
    startedAt: 0,
    finishedAt: 0,
  });
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    dataOpsStore: store,
    processJobsInline: false,
    now: () => nowMs,
  });

  const listRes = createResponseRecorder();
  await coordinator.listJobsResponse(
    { premiumAuth: { email: 'owner@softora.nl', userId: 'owner' } },
    listRes
  );
  assert.equal(listRes.statusCode, 200);
  assert.deepEqual(listRes.body.jobs, []);

  const startRes = createResponseRecorder();
  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'fresh-job-12345678',
        websiteUrl: 'https://softora.nl/',
        customer: { id: 'customer-expired', bedrijf: 'Nieuwe job' },
      },
    },
    startRes
  );

  assert.equal(startRes.statusCode, 202);
  assert.equal(startRes.body.job.id, 'fresh-job-12345678');
});

test('premium database webdesign jobs keep thousands of queued jobs visible', async () => {
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
  });

  for (let index = 0; index < 1200; index += 1) {
    const res = createResponseRecorder();
    await coordinator.startJobResponse(
      {
        premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
        body: {
          jobId: `job_bulk_${String(index).padStart(5, '0')}_123`,
          websiteUrl: `https://bedrijf-${index}.test`,
          customer: { id: `customer-bulk-${index}`, bedrijf: `Bedrijf ${index}` },
        },
      },
      res
    );
    assert.equal(res.statusCode, 202);
  }

  const listRes = createResponseRecorder();
  await coordinator.listJobsResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
    },
    listRes
  );

  assert.equal(coordinator._jobs.size, 1200);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.jobs.length, 1200);
  assert.equal(listRes.body.jobs[0].customerId, 'customer-bulk-0');
  assert.equal(listRes.body.jobs[1199].customerId, 'customer-bulk-1199');
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

test('premium database webdesign jobs requeue transient photo storage failures instead of showing a hard banner', async () => {
  let nowMs = 1760000000000;
  let storageHealthy = false;
  let pipelineCalls = 0;
  const uploadedPhotos = [];
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    now: () => nowMs,
    retryJitter: false,
    dataOpsStore: {
      upsertWebdesignJob: async () => ({ ok: true }),
      uploadDesignPhoto: async (entry) => {
        if (!storageHealthy) {
          return { ok: false, unavailable: false, error: new Error('Supabase storage timeout') };
        }
        uploadedPhotos.push(entry);
        return { ok: true };
      },
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        return { image: { dataUrl: TINY_PNG_DATA_URL, fileName: 'storage-retry-preview.png' } };
      },
    },
    getUiStateValues: async () => null,
    setUiStateValues: async () => null,
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_storage123456',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-storage-retry', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  const firstPoll = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_storage123456' },
    },
    firstPoll
  );

  assert.equal(firstPoll.statusCode, 200);
  assert.equal(firstPoll.body.job.status, 'queued');
  assert.equal(firstPoll.body.job.error, null);
  assert.equal(firstPoll.body.job.retryAttempts, 1);
  assert.equal(firstPoll.body.job.nextAttemptAt, nowMs + 5000);
  assert.equal(pipelineCalls, 1);
  assert.equal(uploadedPhotos.length, 0);

  storageHealthy = true;
  nowMs = firstPoll.body.job.nextAttemptAt + 1;
  const retryPoll = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_storage123456' },
    },
    retryPoll
  );

  assert.equal(retryPoll.statusCode, 200);
  assert.equal(retryPoll.body.job.status, 'done');
  assert.equal(retryPoll.body.job.error, null);
  assert.equal(pipelineCalls, 2);
  assert.equal(uploadedPhotos.length, 1);
  assert.equal(uploadedPhotos[0].customerId, 'customer-storage-retry');
});

test('premium database webdesign jobs show a safe message after exhausted OpenAI 500 retries', async () => {
  let nowMs = 1760000000000;
  let pipelineCalls = 0;
  let persistedJob = null;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    now: () => nowMs,
    retryJitter: false,
    dataOpsStore: {
      upsertWebdesignJob: async (job) => {
        persistedJob = cloneJson(job);
        return { ok: true };
      },
      getWebdesignJob: async (jobId) => (persistedJob && persistedJob.id === jobId ? cloneJson(persistedJob) : null),
      uploadDesignPhoto: async () => ({ ok: true }),
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        throw createRetryableOpenAi500Error();
      },
    },
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_openai500safe',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-openai-500', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  let latest = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const statusRes = createResponseRecorder();
    await coordinator.getJobResponse(
      {
        premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
        params: { jobId: 'job_openai500safe' },
      },
      statusRes
    );
    assert.equal(statusRes.statusCode, 200);
    latest = statusRes.body.job;
    if (latest.status === 'error') break;
    if (latest.status === 'queued' && latest.nextAttemptAt) nowMs = latest.nextAttemptAt + 1;
  }

  assert.equal(latest.status, 'error');
  assert.match(latest.error, /beeldgenerator reageerde tijdelijk niet/i);
  assert.match(latest.error, /lead is vrijgegeven/i);
  assert.doesNotMatch(JSON.stringify(latest), /req_7d9c|help\.openai\.com|server had an error|Please include/i);
  assert.equal(pipelineCalls, 6);
  assert.equal(persistedJob.error, latest.error);
  assert.doesNotMatch(JSON.stringify({ error: persistedJob.error, retry: persistedJob.retry }), /req_7d9c|help\.openai\.com|server had an error|Please include/i);
});

test('premium database webdesign jobs never mislabel an exhausted V2 reference error as OpenAI', async () => {
  let nowMs = 1760000000000;
  let pipelineCalls = 0;
  let persistedJob = null;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    now: () => nowMs,
    retryJitter: false,
    dataOpsStore: {
      upsertWebdesignJob: async (job) => {
        persistedJob = cloneJson(job);
        return { ok: true };
      },
      getWebdesignJob: async (jobId) =>
        persistedJob && persistedJob.id === jobId ? cloneJson(persistedJob) : null,
      uploadDesignPhoto: async () => ({ ok: true }),
    },
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        throw createRetryableV2ReferenceError();
      },
    },
  });

  await coordinator.startJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      body: {
        jobId: 'job_v2referencesafe',
        variant: 'v2-visual-dna',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-v2-reference', bedrijf: 'Softora' },
      },
    },
    createResponseRecorder()
  );

  let latest = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const statusRes = createResponseRecorder();
    await coordinator.getJobResponse(
      {
        premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
        params: { jobId: 'job_v2referencesafe' },
      },
      statusRes
    );
    assert.equal(statusRes.statusCode, 200);
    latest = statusRes.body.job;
    if (latest.status === 'error') break;
    if (latest.status === 'queued' && latest.nextAttemptAt) nowMs = latest.nextAttemptAt + 1;
  }

  assert.equal(latest.status, 'error');
  assert.match(latest.error, /V2-bronbeeld kon tijdelijk niet worden geladen/i);
  assert.match(latest.error, /lead is vrijgegeven/i);
  assert.doesNotMatch(latest.error, /OpenAI/i);
  assert.equal(pipelineCalls, 6);
});

test('premium database webdesign bulk stores safe target errors after exhausted OpenAI 500 retries', async () => {
  const store = createInMemoryWebdesignBatchStore();
  let nowMs = 1760000000000;
  let pipelineCalls = 0;
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    now: () => nowMs,
    retryJitter: false,
    bulkActiveJobLimit: 1,
    bulkStartLimit: 1,
    dataOpsStore: store,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        pipelineCalls += 1;
        throw createRetryableOpenAi500Error();
      },
    },
  });
  const auth = { email: 'owner@softora.nl', userId: 'owner' };

  const startRes = createResponseRecorder();
  await coordinator.startBatchResponse({ premiumAuth: auth, body: { total: 1 } }, startRes);
  const batchId = startRes.body.batch.id;
  await coordinator.appendBatchChunkResponse(
    {
      premiumAuth: auth,
      params: { batchId },
      body: {
        index: 0,
        targets: [
          {
            websiteUrl: 'https://openai-500-bulk.test',
            customer: { id: 'customer-openai-500-bulk', bedrijf: 'OpenAI 500 Bulk', dom: 'openai-500-bulk.test' },
          },
        ],
      },
    },
    createResponseRecorder()
  );
  await coordinator.commitBatchResponse({ premiumAuth: auth, params: { batchId }, body: { total: 1, expectedChunks: 1 } }, createResponseRecorder());

  let latest = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const run = await coordinator.runBatchWorker({ batchLimit: 1, jobLimit: 1, concurrency: 1 });
    assert.equal(run.ok, true);
    latest = run.batches[0] || latest;
    if (latest.failed === 1) break;
    if (latest.nextAttemptAt) nowMs = latest.nextAttemptAt + 1;
  }

  const statusRes = createResponseRecorder();
  await coordinator.getBatchResponse({ premiumAuth: auth, params: { batchId } }, statusRes);
  assert.equal(statusRes.statusCode, 200);
  latest = statusRes.body.batch;
  const chunk = Array.from(store.chunks.values())[0];
  const target = chunk.targets[0];
  assert.equal(latest.failed, 1);
  assert.equal(latest.remaining, 0);
  assert.equal(target.status, 'error');
  assert.match(target.error, /beeldgenerator reageerde tijdelijk niet/i);
  assert.match(target.error, /lead is vrijgegeven/i);
  assert.equal(pipelineCalls, 6);
  assert.doesNotMatch(JSON.stringify({ batch: latest, target }), /req_7d9c|help\.openai\.com|server had an error|Please include/i);
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

test('premium database webdesign jobs hide OpenAI safety rejection details from job status', async () => {
  const rawSafetyMessage =
    'OpenAI websitegenerator mislukt (400): Your request was rejected by the safety system. Include request ID req_caef77d7f5d84889803634ba4e82ac8a. safety_violations=[sexual].';
  const coordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: { error() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    processJobsInline: true,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async () => {
        const error = new Error(rawSafetyMessage);
        error.status = 400;
        error.openAiSafetyBlocked = true;
        error.data = {
          error: {
            message: rawSafetyMessage,
          },
        };
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
        jobId: 'job_safetyhide123',
        websiteUrl: 'https://softora.nl',
        customer: { id: 'customer-safety-hidden', bedrijf: 'Softora Safety' },
      },
    },
    createResponseRecorder()
  );

  const statusRes = createResponseRecorder();
  await coordinator.getJobResponse(
    {
      premiumAuth: { email: 'owner@softora.nl', userId: 'owner' },
      params: { jobId: 'job_safetyhide123' },
    },
    statusRes
  );

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.job.status, 'error');
  assert.equal(statusRes.body.job.error, null);
  assert.equal(statusRes.body.job.safetyBlocked, true);
  assert.doesNotMatch(JSON.stringify(statusRes.body), /request ID|safety_violations|sexual|help\.openai\.com/i);
});

test('premium database webdesign inline processing keeps AI image jobs in a small bounded pool', async () => {
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

  assert.ok(maxActive <= 2, `expected <=2 active jobs, saw ${maxActive}`);
  assert.equal(pipelineCalls, 2);
  assert.equal(firstPoll.body.job.status, 'done');
  assert.equal(secondPoll.body.job.status, 'done');

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

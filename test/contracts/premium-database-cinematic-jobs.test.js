const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPremiumDatabaseCinematicJobsCoordinator,
} = require('../../server/services/premium-database-cinematic-jobs');
const {
  registerPremiumDatabaseCinematicJobRoutes,
} = require('../../server/routes/premium-database-cinematic-jobs');

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(payload) {
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

test('premium database cinematic job routes expose start, status and video endpoints', () => {
  const routes = [];
  const app = {
    post(pathname) { routes.push(['POST', pathname]); },
    get(pathname) { routes.push(['GET', pathname]); },
  };

  registerPremiumDatabaseCinematicJobRoutes(app, { coordinator: {} });

  assert.deepEqual(routes, [
    ['POST', '/api/premium-database/cinematic-jobs'],
    ['GET', '/api/premium-database/cinematic-jobs/:jobId/video'],
    ['GET', '/api/premium-database/cinematic-jobs/:jobId'],
  ]);
});

test('premium database cinematic routes require premium api access', async () => {
  let startHandlers = null;
  let statusHandlers = null;
  let videoHandlers = null;
  let accessCalls = 0;
  const app = {
    post(pathname, ...handlers) {
      if (pathname === '/api/premium-database/cinematic-jobs') startHandlers = handlers;
    },
    get(pathname, ...handlers) {
      if (pathname.endsWith('/:jobId/video')) videoHandlers = handlers;
      if (pathname.endsWith('/:jobId')) statusHandlers = handlers;
    },
  };

  registerPremiumDatabaseCinematicJobRoutes(app, {
    requirePremiumApiAccess: (_req, _res, next) => {
      accessCalls += 1;
      return next();
    },
    coordinator: {
      startJobResponse: async (_req, res) => res.status(202).json({ ok: true }),
      getJobResponse: async (_req, res) => res.status(200).json({ ok: true }),
      getVideoResponse: async (_req, res) => res.status(200).send(Buffer.from('video')),
    },
  });

  assert.equal((await callRouteHandlers(startHandlers, { body: {} })).statusCode, 202);
  assert.equal((await callRouteHandlers(statusHandlers, { params: { jobId: 'cin_1' } })).statusCode, 200);
  assert.equal((await callRouteHandlers(videoHandlers, { params: { jobId: 'cin_1' } })).statusCode, 200);
  assert.equal(accessCalls, 3);
});

test('premium database cinematic coordinator drives scan, image, veo and site stages', async () => {
  let currentTime = 1000;
  const calls = {
    scanUrl: '',
    imageJob: null,
    veoImages: null,
    polledOperation: '',
  };
  const store = {};
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => currentTime,
    random: () => 0.42,
    fetchWebsitePreviewScanFromUrl: async (url) => {
      calls.scanUrl = url;
      return {
        normalizedUrl: url,
        finalUrl: 'https://example.com/',
        scan: {
          host: 'example.com',
          title: 'Example premium',
          h1: 'Example BV',
          headings: ['Strategie', 'Design', 'Contact'],
          paragraphs: ['Example helpt ondernemers groeien met software en automatisering.'],
          brandPalette: ['#9b2358', '#0f9f93'],
        },
      };
    },
    generateCinematicImages: async (job) => {
      calls.imageJob = job.id;
      return {
        images: [
          { mimeType: 'image/png', base64: 'AAA' },
          { mimeType: 'image/png', base64: 'BBB' },
        ],
        prompt: 'cinematic prompt',
        model: 'gpt-image-2',
      };
    },
    submitVeoVideo: async (_job, images) => {
      calls.veoImages = images.map((image) => image.base64);
      return {
        operationName: 'operations/video-123',
        raw: { name: 'operations/video-123' },
      };
    },
    pollVeoOperation: async (job) => {
      calls.polledOperation = job.videoOperationName;
      return {
        done: true,
        videoUri: 'https://video.example/generated.mp4',
        raw: { done: true },
      };
    },
    getUiStateValues: async () => ({ values: store }),
    setUiStateValues: async (_scope, values) => {
      Object.assign(store, values);
      return { ok: true };
    },
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: {
      id: 'customer-1',
      bedrijf: 'Example BV',
      dom: 'example.com',
    },
  });

  assert.equal(started.statusCode, 202);
  assert.equal(started.job.stage, 'queued');

  currentTime += 1000;
  const submitted = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(submitted.statusCode, 202);
  assert.equal(submitted.job.stage, 'video');
  assert.equal(submitted.job.imageCount, 2);
  assert.equal(calls.scanUrl, 'https://example.com/');
  assert.equal(calls.imageJob, started.job.id);
  assert.deepEqual(calls.veoImages, ['AAA', 'BBB']);

  currentTime += 11000;
  const finished = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(finished.statusCode, 200);
  assert.equal(finished.job.status, 'done');
  assert.equal(finished.job.stage, 'done');
  assert.equal(finished.job.video.ready, true);
  assert.equal(finished.job.video.url, `/api/premium-database/cinematic-jobs/${started.job.id}/video`);
  assert.match(finished.job.result.html, /Example BV/);
  assert.match(finished.job.result.html, /<video autoplay muted loop playsinline/);
  assert.equal(calls.polledOperation, 'operations/video-123');
});

test('premium cinematic website page starts the cinematic job flow', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-cinematic-website.html'), 'utf8');
  const scriptSource = fs.readFileSync(path.join(root, 'assets/premium-cinematic-website.js'), 'utf8');

  assert.match(pageSource, /assets\/premium-cinematic-website\.css\?v=20260619a/);
  assert.match(pageSource, /assets\/premium-cinematic-website\.js\?v=20260619a/);
  assert.match(scriptSource, /var JOB_ENDPOINT = "\/api\/premium-database\/cinematic-jobs";/);
  assert.match(scriptSource, /new URLSearchParams\(global\.location\.search \|\| ""\)/);
  assert.match(scriptSource, /method: "POST"/);
  assert.match(scriptSource, /JOB_ENDPOINT \+ "\/" \+ encodeURIComponent\(currentJob\.id\)/);
});

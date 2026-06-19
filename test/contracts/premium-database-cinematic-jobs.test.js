const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

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
    chunks: [],
    ended: false,
    headers: {},
    events: {},
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
    write(payload) {
      this.chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
      return true;
    },
    end(payload) {
      if (payload) this.write(payload);
      this.ended = true;
      this.body = Buffer.concat(this.chunks);
      if (typeof this.events.finish === 'function') this.events.finish();
      return this;
    },
    on(event, handler) {
      this.events[event] = handler;
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
    ['GET', '/api/premium-database/cinematic-jobs/config'],
    ['GET', '/api/premium-database/cinematic-jobs/:jobId/video'],
    ['GET', '/api/premium-database/cinematic-jobs/:jobId/frame/:frameIndex'],
    ['GET', '/api/premium-database/cinematic-jobs/:jobId'],
  ]);
});

test('premium database cinematic routes require premium api access', async () => {
  let startHandlers = null;
  let configHandlers = null;
  let statusHandlers = null;
  let videoHandlers = null;
  let frameHandlers = null;
  let accessCalls = 0;
  const app = {
    post(pathname, ...handlers) {
      if (pathname === '/api/premium-database/cinematic-jobs') startHandlers = handlers;
    },
    get(pathname, ...handlers) {
      if (pathname === '/api/premium-database/cinematic-jobs/config') configHandlers = handlers;
      if (pathname === '/api/premium-database/cinematic-jobs/:jobId/video') videoHandlers = handlers;
      if (pathname === '/api/premium-database/cinematic-jobs/:jobId/frame/:frameIndex') frameHandlers = handlers;
      if (pathname === '/api/premium-database/cinematic-jobs/:jobId') statusHandlers = handlers;
    },
  };

  registerPremiumDatabaseCinematicJobRoutes(app, {
    requirePremiumApiAccess: (_req, _res, next) => {
      accessCalls += 1;
      return next();
    },
    coordinator: {
      startJobResponse: async (_req, res) => res.status(202).json({ ok: true }),
      configResponse: async (_req, res) => res.status(200).json({ ok: true }),
      getJobResponse: async (_req, res) => res.status(200).json({ ok: true }),
      getVideoResponse: async (_req, res) => res.status(200).send(Buffer.from('video')),
      getFrameResponse: async (_req, res) => res.status(200).send(Buffer.from('frame')),
    },
  });

  assert.equal((await callRouteHandlers(startHandlers, { body: {} })).statusCode, 202);
  assert.equal((await callRouteHandlers(configHandlers)).statusCode, 200);
  assert.equal((await callRouteHandlers(statusHandlers, { params: { jobId: 'cin_1' } })).statusCode, 200);
  assert.equal((await callRouteHandlers(videoHandlers, { params: { jobId: 'cin_1' } })).statusCode, 200);
  assert.equal((await callRouteHandlers(frameHandlers, { params: { jobId: 'cin_1', frameIndex: '1' } })).statusCode, 200);
  assert.equal(accessCalls, 5);
});

test('premium database cinematic coordinator drives scan, image and scrollsite stages', async () => {
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
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
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
  const videoPending = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(videoPending.statusCode, 202);
  assert.equal(videoPending.job.status, 'running');
  assert.equal(videoPending.job.stage, 'video');
  assert.deepEqual(calls.veoImages, ['AAA', 'BBB']);
  assert.equal(videoPending.job.video.ready, false);

  currentTime += 11000;
  const finished = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(finished.statusCode, 200);
  assert.equal(finished.job.status, 'done');
  assert.equal(finished.job.stage, 'done');
  assert.equal(finished.job.imageCount, 2);
  assert.equal(calls.scanUrl, 'https://example.com/');
  assert.equal(calls.imageJob, started.job.id);
  assert.equal(calls.polledOperation, 'operations/video-123');
  assert.equal(finished.job.video.ready, true);
  assert.equal(finished.job.video.url, `/api/premium-database/cinematic-jobs/${started.job.id}/video`);
  assert.equal(finished.job.frameCount, 2);
  assert.equal(finished.job.frames[0].url, `/api/premium-database/cinematic-jobs/${started.job.id}/frame/1`);
  assert.match(finished.job.result.html, /Example BV/);
  assert.match(finished.job.result.html, /data-cinematic-scroll-story/);
  assert.match(finished.job.result.html, /id="scrollVideo"/);
  assert.match(finished.job.result.html, /id="scrollCanvas"/);
  assert.match(finished.job.result.html, /function extractFrames/);
  assert.match(finished.job.result.html, /function drawVideoProgress/);
  assert.match(finished.job.result.html, /class="story-frame is-active"/);
  assert.match(finished.job.result.html, /class="story-step"/);
  assert.match(finished.job.result.html, /scroll-scrub sequence/);
  assert.match(finished.job.result.html, /function setFrameVisual/);
  assert.match(finished.job.result.html, /frameProgress=total&gt;1\?progress\*\(total-1\):0|frameProgress=total>1\?progress\*\(total-1\):0/);
  assert.match(finished.job.result.html, /requestAnimationFrame\(render\)/);
  assert.match(finished.job.result.html, /Merkfilm op scroll/);
  assert.doesNotMatch(finished.job.result.html, /<video[^>]*autoplay/i);
  assert.doesNotMatch(finished.job.result.html, /cinematic-object/);
  assert.doesNotMatch(finished.job.result.html, /object-core/);
});

test('premium database cinematic coordinator bouwt een scrollfilm met thee-motief wanneer de site daarom vraagt', async () => {
  let currentTime = 2000;
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => currentTime,
    random: () => 0.47,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://thee.example/',
      scan: {
        host: 'thee.example',
        h1: 'Thee Atelier',
        headings: ['Losse thee', 'Theerituelen', 'Contact'],
        paragraphs: ['Een theezakje opent en twee handen houden een warme kop thee vast.'],
      },
    }),
    generateCinematicImages: async () => ({ images: [{ mimeType: 'image/png', base64: 'TEA' }] }),
    submitVeoVideo: async () => ({ operationName: 'operations/tea-video', raw: {} }),
    pollVeoOperation: async () => ({
      done: true,
      videoUri: 'https://video.example/tea.mp4',
      raw: { done: true },
    }),
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ ok: true }),
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-tea', bedrijf: 'Thee Atelier', dom: 'thee.example' },
  });
  await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: started.job.id });
  currentTime += 11000;
  const finished = await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: started.job.id });

  assert.equal(finished.job.status, 'done');
  assert.equal(finished.job.frameCount, 1);
  assert.match(finished.job.result.html, /Productritueel/);
  assert.match(finished.job.result.html, /Het ritueel opent/);
  assert.match(finished.job.result.html, new RegExp(`/api/premium-database/cinematic-jobs/${started.job.id}/frame/1`));
  assert.match(finished.job.result.html, new RegExp(`/api/premium-database/cinematic-jobs/${started.job.id}/video`));
  assert.match(finished.job.result.html, /scroll-scrub sequence/);
  assert.match(finished.job.result.html, /id="scrollVideo"/);
  assert.match(finished.job.result.html, /id="scrollCanvas"/);
  assert.match(finished.job.result.html, /min-height:800vh/);
  assert.match(finished.job.result.html, /De video speelt nooit vanzelf/);
  assert.doesNotMatch(finished.job.result.html, /<video[^>]*autoplay/i);
  assert.doesNotMatch(finished.job.result.html, /motif-tea/);
  assert.doesNotMatch(finished.job.result.html, /hand left/);
  assert.doesNotMatch(finished.job.result.html, /steam one/);
});

test('premium database cinematic coordinator serveert gegenereerde image frames apart', async () => {
  const frameBase64 = Buffer.from('frame-one').toString('base64');
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => 2500,
    random: () => 0.49,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://frames.example/',
      scan: { host: 'frames.example', h1: 'Frames BV' },
    }),
    generateCinematicImages: async () => ({
      images: [{ mimeType: 'image/png', base64: frameBase64, title: 'Generated Frame' }],
    }),
    submitVeoVideo: async () => ({ operationName: 'operations/frame-video', raw: {} }),
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ ok: true }),
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-frames', bedrijf: 'Frames BV', dom: 'frames.example' },
  });
  await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: started.job.id });
  const frameResponse = await callRouteHandlers([
    (req, res) => coordinator.getFrameResponse(req, res),
  ], {
    premiumAuth: { email: 'serve@example.com', userId: 'user-1' },
    params: { jobId: started.job.id, frameIndex: '1' },
  });

  assert.equal(frameResponse.statusCode, 200);
  assert.equal(frameResponse.headers['Content-Type'], 'image/png');
  assert.equal(Buffer.isBuffer(frameResponse.body), true);
  assert.equal(frameResponse.body.toString('utf8'), 'frame-one');
});

test('premium database cinematic coordinator probeert Image 2 opnieuw met object-only prompt bij safety reject', async () => {
  let currentTime = 2750;
  let rejectedOnce = false;
  const prompts = [];
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => currentTime,
    random: () => 0.5,
    imageCount: 6,
    useVeo: false,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://patriz.example/',
      scan: {
        host: 'patriz.example',
        h1: 'Atelier en Beeldentuin Patriz',
        headings: ['Atelier', 'Beeldentuin', 'Kunst'],
        paragraphs: ['Een atelier en beeldentuin met sculpturen, tuinervaring en kunstobjecten.'],
      },
    }),
    fetchJsonWithTimeout: async (_url, options) => {
      const body = JSON.parse(options.body);
      prompts.push(body.prompt);
      if (!rejectedOnce && /shedding small stone chips|finished abstract non-figurative sculpture|final cinematic website hero composition/i.test(body.prompt)) {
        rejectedOnce = true;
        return {
          response: { ok: false, status: 400 },
          data: {
            error: {
              message: 'Your request was rejected by the safety system. safety_violations=[sexual].',
            },
          },
        };
      }
      return {
        response: { ok: true },
        data: { data: [{ b64_json: Buffer.from(`frame-${prompts.length}`).toString('base64') }] },
      };
    },
    submitVeoVideo: async () => ({ operationName: 'operations/safety-retry-video', raw: {} }),
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async () => ({ ok: true }),
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-patriz', bedrijf: 'Atelier en Beeldentuin Patriz', dom: 'patriz.example' },
  });
  const advanced = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(advanced.job.stage, 'done');
  assert.equal(advanced.job.imageCount, 6);
  assert.equal(rejectedOnce, true);
  assert.ok(prompts.some((prompt) => /abstract non-figurative sculpture/i.test(prompt)));
  assert.ok(prompts.some((prompt) => /Camera completely locked, zero movement/i.test(prompt)));
  assert.ok(prompts.some((prompt) => /No artificial glow\. No light trails\. No energy effects/i.test(prompt)));
  assert.ok(prompts.some((prompt) => /Strictly object-only commercial still life/.test(prompt)));
  const retryPrompt = prompts.find((prompt) => /Strictly object-only commercial still life/.test(prompt));
  assert.doesNotMatch(retryPrompt, /\bhands?\b|\bfingers?\b|\bskin\b|\bfaces?\b|\bhuman figures?\b/i);
});

test('premium database cinematic coordinator stuurt Veo een geldige image-to-video payload', async () => {
  let capturedBody = null;
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => 3000,
    random: () => 0.51,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    useVeo: true,
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://veo.example/',
      scan: { host: 'veo.example', h1: 'Veo BV' },
    }),
    generateCinematicImages: async () => ({
      images: [
        { mimeType: 'image/png', base64: 'START_FRAME' },
        { mimeType: 'image/png', base64: 'REFERENCE_FRAME' },
      ],
    }),
    fetchJsonWithTimeout: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return { response: { ok: true }, data: { name: 'operations/veo-default' } };
    },
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-veo', bedrijf: 'Veo BV', dom: 'veo.example' },
  });
  const advanced = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(advanced.job.stage, 'video');
  assert.equal(capturedBody.instances[0].image.bytesBase64Encoded, 'START_FRAME');
  assert.equal(capturedBody.instances[0].image.mimeType, 'image/png');
  assert.equal(capturedBody.parameters.lastFrame.bytesBase64Encoded, 'REFERENCE_FRAME');
  assert.equal(capturedBody.parameters.lastFrame.mimeType, 'image/png');
  assert.match(capturedBody.instances[0].prompt, /Ultra slow motion seamless transformation/);
  assert.match(capturedBody.instances[0].prompt, /Camera completely locked, zero movement/);
  assert.equal(capturedBody.instances[0].image.inlineData, undefined);
  assert.equal(capturedBody.instances[0].lastFrame, undefined);
  assert.equal(capturedBody.instances[0].referenceImages, undefined);
  assert.equal(capturedBody.parameters.durationSeconds, 8);
  assert.equal(capturedBody.parameters.personGeneration, undefined);
});

test('premium database cinematic coordinator probeert Veo opnieuw met sobere payload bij schemafouten', async () => {
  const capturedBodies = [];
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => 3500,
    random: () => 0.52,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    useVeo: true,
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://retry-veo.example/',
      scan: { host: 'retry-veo.example', h1: 'Retry Veo BV' },
    }),
    generateCinematicImages: async () => ({
      images: [{ mimeType: 'image/png', base64: 'START_FRAME' }],
    }),
    fetchJsonWithTimeout: async (_url, options) => {
      capturedBodies.push(JSON.parse(options.body));
      if (capturedBodies.length === 1) {
        return {
          response: { ok: false, status: 400 },
          data: { error: { message: 'Unknown name "personGeneration" at parameters: Cannot find field.' } },
        };
      }
      return { response: { ok: true }, data: { name: 'operations/veo-retry' } };
    },
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-veo-retry', bedrijf: 'Retry Veo BV', dom: 'retry-veo.example' },
  });
  const advanced = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(advanced.job.stage, 'video');
  assert.equal(capturedBodies.length, 2);
  assert.equal(capturedBodies[0].parameters.personGeneration, 'allow_adult');
  assert.equal(capturedBodies[1].parameters.personGeneration, undefined);
  assert.equal(capturedBodies[1].parameters.durationSeconds, 8);
  assert.equal(capturedBodies[1].instances[0].image.bytesBase64Encoded, 'START_FRAME');
  assert.equal(capturedBodies[1].instances[0].image.inlineData, undefined);
  assert.equal(capturedBodies[1].instances[0].referenceImages, undefined);
});

test('premium database cinematic coordinator herhaalt Veo niet bij auth of quota fouten', async () => {
  let attempts = 0;
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => 3600,
    random: () => 0.53,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    useVeo: true,
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://no-retry-veo.example/',
      scan: { host: 'no-retry-veo.example', h1: 'No Retry Veo BV' },
    }),
    generateCinematicImages: async () => ({
      images: [{ mimeType: 'image/png', base64: 'START_FRAME' }],
    }),
    fetchJsonWithTimeout: async () => {
      attempts += 1;
      return {
        response: { ok: false, status: 403 },
        data: { error: { message: 'API key is not allowed to use this model.' } },
      };
    },
  });

  const started = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-veo-no-retry', bedrijf: 'No Retry Veo BV', dom: 'no-retry-veo.example' },
  });
  const advanced = await coordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(advanced.job.status, 'error');
  assert.equal(attempts, 1);
  assert.match(advanced.job.error, /API key is not allowed/);
});

test('premium database cinematic coordinator downloadt relatieve Veo video-uri via Gemini base url', async () => {
  let currentTime = 4000;
  let pollUrl = '';
  let downloadUrl = '';
  let downloadApiKey = '';
  const originalFetch = global.fetch;
  let arrayBufferCalled = false;
  global.fetch = async (url, options = {}) => {
    downloadUrl = String(url || '');
    downloadApiKey = String(options.headers && options.headers['x-goog-api-key'] || '');
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'video/mp4' : '') },
      body: Readable.toWeb(Readable.from([Buffer.from('video-bytes')])),
      arrayBuffer: async () => {
        arrayBufferCalled = true;
        return Buffer.from('video-bytes').buffer;
      },
    };
  };
  try {
    const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
      now: () => currentTime,
      random: () => 0.54,
      getOpenAiApiKey: () => 'openai-key',
      getGeminiApiKey: () => 'gemini-key',
      useVeo: true,
      geminiApiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
      fetchWebsitePreviewScanFromUrl: async (url) => ({
        normalizedUrl: url,
        finalUrl: 'https://relative-video.example/',
        scan: { host: 'relative-video.example', h1: 'Relative Video BV' },
      }),
      generateCinematicImages: async () => ({
        images: [{ mimeType: 'image/png', base64: 'START_FRAME' }],
      }),
      submitVeoVideo: async () => ({ operationName: '/v1beta/operations/relative-video-op', raw: {} }),
      fetchJsonWithTimeout: async (url) => {
        pollUrl = String(url || '');
        return {
          response: { ok: true },
          data: {
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [{ video: { uri: 'files/relative-video:download?alt=media' } }],
              },
            },
          },
        };
      },
    });

    const started = await coordinator.startJob({
      ownerKey: 'serve@example.com::user-1',
      customer: { id: 'customer-relative-video', bedrijf: 'Relative Video BV', dom: 'relative-video.example' },
    });
    await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: started.job.id });
    currentTime += 11000;
    const finished = await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: started.job.id });
    const videoResponse = await callRouteHandlers([
      (req, res) => coordinator.getVideoResponse(req, res),
    ], {
      premiumAuth: { email: 'serve@example.com', userId: 'user-1' },
      params: { jobId: started.job.id },
    });

    assert.equal(finished.job.status, 'done');
    assert.equal(pollUrl, 'https://generativelanguage.googleapis.com/v1beta/operations/relative-video-op');
    assert.equal(downloadUrl, 'https://generativelanguage.googleapis.com/v1beta/files/relative-video:download?alt=media');
    assert.equal(downloadApiKey, 'gemini-key');
    assert.equal(videoResponse.statusCode, 200);
    assert.equal(videoResponse.headers['Content-Type'], 'video/mp4');
    assert.equal(arrayBufferCalled, false);
    assert.equal(videoResponse.ended, true);
    assert.equal(Buffer.isBuffer(videoResponse.body), true);
    assert.equal(videoResponse.body.toString('utf8'), 'video-bytes');
  } finally {
    global.fetch = originalFetch;
  }
});

test('premium database cinematic coordinator hergebruikt bestaande site voordat AI opnieuw draait', async () => {
  let currentTime = 2000;
  let imageCalls = 0;
  const store = {};
  const sharedDeps = {
    now: () => currentTime,
    random: () => 0.33,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    useVeo: true,
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://cached.example/',
      scan: {
        host: 'cached.example',
        h1: 'Cached BV',
        headings: ['Premium'],
      },
    }),
    submitVeoVideo: async () => ({ operationName: 'operations/cached-video', raw: {} }),
    pollVeoOperation: async () => ({
      done: true,
      videoUri: 'https://video.example/cached.mp4',
      raw: { done: true },
    }),
    getUiStateValues: async () => ({ values: store }),
    setUiStateValues: async (_scope, values) => {
      Object.assign(store, values);
      return { ok: true };
    },
  };
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    ...sharedDeps,
    generateCinematicImages: async () => {
      imageCalls += 1;
      return {
        images: [{ mimeType: 'image/png', base64: 'AAA' }],
      };
    },
  });

  const first = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: {
      id: 'customer-cached',
      bedrijf: 'Cached BV',
      dom: 'cached.example',
    },
  });
  currentTime += 1000;
  await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: first.job.id });
  currentTime += 11000;
  const finished = await coordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: first.job.id });

  assert.equal(finished.job.status, 'done');
  assert.equal(imageCalls, 1);
  assert.match(store.softora_premium_database_cinematic_sites_v1, /customer-cached/);

  const reusedCoordinator = createPremiumDatabaseCinematicJobsCoordinator({
    ...sharedDeps,
    generateCinematicImages: async () => {
      throw new Error('AI hoort niet opnieuw te starten');
    },
  });
  store.softora_premium_database_cinematic_jobs_v1 = '{}';

  const reused = await reusedCoordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: {
      id: 'customer-cached',
      bedrijf: 'Cached BV',
      dom: 'cached.example',
    },
  });

  assert.equal(reused.statusCode, 200);
  assert.equal(reused.existing, true);
  assert.equal(reused.cached, true);
  assert.equal(reused.job.status, 'done');
  assert.equal(reused.job.cachedSite, true);
  assert.equal(reused.job.result.html, finished.job.result.html);

  const loadedFromSiteLibrary = await reusedCoordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: first.job.id,
  });

  assert.equal(loadedFromSiteLibrary.statusCode, 200);
  assert.equal(loadedFromSiteLibrary.job.status, 'done');
  assert.equal(loadedFromSiteLibrary.job.video.url, `/api/premium-database/cinematic-jobs/${first.job.id}/video`);
});

test('premium database cinematic coordinator negeert oude cached sites zonder scroll scrub builder versie', async () => {
  const ownerKey = 'serve@example.com::user-1';
  const oldJobId = 'cin_old_cached_123';
  const store = {
    softora_premium_database_cinematic_jobs_v1: JSON.stringify({
      [oldJobId]: {
        id: oldJobId,
        ownerKey,
        status: 'done',
        stage: 'done',
        progress: 100,
        customer: { id: 'customer-old-cache', bedrijf: 'Old Cache BV', dom: 'old-cache.example' },
        websiteUrl: 'https://old-cache.example/',
        result: { html: '<main class="cinematic-object">old builder</main>', builderVersion: 'image-sequence-v2' },
        builderVersion: 'image-sequence-v2',
      },
    }),
    softora_premium_database_cinematic_sites_v1: JSON.stringify({
      'serve-example-com-user-1:customer:customer-old-cache': {
        id: oldJobId,
        ownerKey,
        customer: { id: 'customer-old-cache', bedrijf: 'Old Cache BV', dom: 'old-cache.example' },
        websiteUrl: 'https://old-cache.example/',
        result: { html: '<main class="cinematic-object">old site cache</main>', builderVersion: 'image-sequence-v2' },
        builderVersion: 'image-sequence-v2',
      },
    }),
  };
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    now: () => 6200,
    random: () => 0.62,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    useVeo: true,
    getUiStateValues: async () => ({ values: store }),
    setUiStateValues: async (_scope, values) => {
      Object.assign(store, values);
      return { ok: true };
    },
  });

  const started = await coordinator.startJob({
    ownerKey,
    customer: { id: 'customer-old-cache', bedrijf: 'Old Cache BV', dom: 'old-cache.example' },
  });

  assert.equal(started.statusCode, 202);
  assert.equal(started.existing, false);
  assert.notEqual(started.job.id, oldJobId);
  assert.equal(started.job.stage, 'queued');
});

test('premium database cinematic coordinator hervat lopende opgeslagen job na serverwissel', async () => {
  let currentTime = 7000;
  let imageCalls = 0;
  const store = {};
  const sharedDeps = {
    now: () => currentTime,
    random: () => 0.61,
    getOpenAiApiKey: () => 'openai-key',
    getGeminiApiKey: () => 'gemini-key',
    useVeo: true,
    getUiStateValues: async () => ({ values: store }),
    setUiStateValues: async (_scope, values) => {
      Object.assign(store, values);
      return { ok: true };
    },
    fetchWebsitePreviewScanFromUrl: async (url) => ({
      normalizedUrl: url,
      finalUrl: 'https://resume.example/',
      scan: { host: 'resume.example', h1: 'Resume BV' },
    }),
    generateCinematicImages: async () => {
      imageCalls += 1;
      return { images: [{ mimeType: 'image/png', base64: 'START_FRAME' }] };
    },
    submitVeoVideo: async () => ({ operationName: 'operations/resume-video', raw: {} }),
  };
  const firstCoordinator = createPremiumDatabaseCinematicJobsCoordinator(sharedDeps);
  const started = await firstCoordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-resume', bedrijf: 'Resume BV', dom: 'resume.example' },
  });
  await firstCoordinator.getJob({ ownerKey: 'serve@example.com::user-1', jobId: started.job.id });

  assert.equal(imageCalls, 1);
  assert.match(store.softora_premium_database_cinematic_jobs_v1, /operations\/resume-video/);

  const resumedCoordinator = createPremiumDatabaseCinematicJobsCoordinator({
    ...sharedDeps,
    generateCinematicImages: async () => {
      throw new Error('AI hoort niet opnieuw te starten voor dezelfde lopende job');
    },
    pollVeoOperation: async (job) => ({
      done: true,
      videoUri: 'https://video.example/resumed.mp4',
      raw: { polledOperation: job.videoOperationName },
    }),
  });
  const resumedStart = await resumedCoordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-resume', bedrijf: 'Resume BV', dom: 'resume.example' },
  });

  assert.equal(resumedStart.statusCode, 202);
  assert.equal(resumedStart.existing, true);
  assert.equal(resumedStart.job.id, started.job.id);
  assert.equal(resumedStart.job.stage, 'video');

  currentTime += 11000;
  const finished = await resumedCoordinator.getJob({
    ownerKey: 'serve@example.com::user-1',
    jobId: started.job.id,
  });

  assert.equal(finished.statusCode, 200);
  assert.equal(finished.job.status, 'done');
  assert.equal(finished.job.video.ready, true);
  assert.match(finished.job.result.html, /Resume BV/);
  assert.equal(imageCalls, 1);
});

test('premium database cinematic API stopt nieuwe jobs wanneer provider-config ontbreekt', async () => {
  let imageCalls = 0;
  const coordinator = createPremiumDatabaseCinematicJobsCoordinator({
    getOpenAiApiKey: () => '',
    getGeminiApiKey: () => '',
    generateCinematicImages: async () => {
      imageCalls += 1;
      return { images: [{ mimeType: 'image/png', base64: 'AAA' }] };
    },
  });

  const status = coordinator.getProviderStatus();
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ['OPENAI_API_KEY', 'GEMINI_API_KEY']);
  assert.equal(status.openAi.configured, false);
  assert.equal(status.veo.enabled, true);
  assert.equal(status.veo.configured, false);

  const result = await coordinator.startJob({
    ownerKey: 'serve@example.com::user-1',
    customer: { id: 'customer-missing', bedrijf: 'Missing BV', dom: 'missing.example' },
  });

  assert.equal(result.statusCode, 503);
  assert.equal(result.code, 'CINEMATIC_PROVIDER_NOT_CONFIGURED');
  assert.match(result.detail, /OPENAI_API_KEY/);
  assert.match(result.detail, /GEMINI_API_KEY/);
  assert.equal(imageCalls, 0);
  assert.equal(result.providerStatus.ready, false);
});

test('premium cinematic website page starts the cinematic job flow', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-cinematic-website.html'), 'utf8');
  const scriptSource = fs.readFileSync(path.join(root, 'assets/premium-cinematic-website.js'), 'utf8');

  assert.match(pageSource, /assets\/premium-cinematic-website\.css\?v=20260619b/);
  assert.match(pageSource, /assets\/premium-cinematic-website\.js\?v=20260619b/);
  assert.match(pageSource, /id="previewImage"/);
  assert.match(pageSource, /Veo motion/);
  assert.doesNotMatch(pageSource, /preview-video/);
  assert.doesNotMatch(pageSource, /autoplay muted loop/);
  assert.match(scriptSource, /var JOB_ENDPOINT = "\/api\/premium-database\/cinematic-jobs";/);
  assert.match(scriptSource, /var STAGE_ORDER = \["scanning", "images", "video", "site", "done"\];/);
  assert.match(scriptSource, /function getPreviewFrame/);
  assert.match(scriptSource, /Veo maakt de motion-laag/);
  assert.match(scriptSource, /De canvas-scrollsite wordt opgebouwd rond de Veo-video/);
  assert.doesNotMatch(scriptSource, /previewVideo/);
  assert.match(scriptSource, /new URLSearchParams\(global\.location\.search \|\| ""\)/);
  assert.match(scriptSource, /method: "POST"/);
  assert.match(scriptSource, /data\.job\.status !== "done"/);
  assert.match(scriptSource, /JOB_ENDPOINT \+ "\/" \+ encodeURIComponent\(currentJob\.id\)/);
});

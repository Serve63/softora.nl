const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWebsitePreviewBatchCoordinator,
} = require('../../server/services/website-preview-batch');

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

function createSharedUiStateFixture() {
  let values = {};
  return {
    get values() {
      return values;
    },
    getUiStateValues: async () => ({ values }),
    setUiStateValues: async (_scope, nextValues) => {
      values = { ...nextValues };
      return { values };
    },
  };
}

function createPremiumRequest(overrides = {}) {
  return {
    premiumAuth: {
      email: 'serve@softora.nl',
      userId: 'user-1',
      displayName: 'Servé Creusen',
      authenticated: true,
      role: 'admin',
    },
    params: {},
    body: {},
    ...overrides,
  };
}

test('website preview batch status survives another server instance through shared state', async () => {
  const shared = createSharedUiStateFixture();
  const startCoordinator = createWebsitePreviewBatchCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    getUiStateValues: shared.getUiStateValues,
    setUiStateValues: shared.setUiStateValues,
    processJobsInline: true,
    aiToolsCoordinator: {
      runWebsitePreviewGeneratePipeline: async (url) => ({
        site: { host: new URL(url).hostname },
        image: {
          dataUrl: 'data:image/png;base64,AAAA',
          fileName: 'softora-preview.png',
        },
      }),
    },
    websitePreviewLibraryCoordinator: {
      persistPreviewLibraryEntry: async () => ({
        ok: true,
        entry: { id: 'preview-entry-1' },
      }),
    },
  });

  const startRes = createResponseRecorder();
  await startCoordinator.startBatchResponse(
    createPremiumRequest({ body: { urls: ['softora.nl'] } }),
    startRes
  );

  assert.equal(startRes.statusCode, 202);
  assert.equal(startRes.body.ok, true);
  assert.ok(startRes.body.jobId);
  assert.match(String(shared.values.softora_website_preview_batches_v1 || ''), /preview-entry-1/);

  const pollCoordinator = createWebsitePreviewBatchCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    getUiStateValues: shared.getUiStateValues,
    setUiStateValues: shared.setUiStateValues,
    processJobsInline: true,
  });

  const pollRes = createResponseRecorder();
  await pollCoordinator.getBatchResponse(
    createPremiumRequest({ params: { jobId: startRes.body.jobId } }),
    pollRes
  );

  assert.equal(pollRes.statusCode, 200);
  assert.equal(pollRes.body.ok, true);
  assert.equal(pollRes.body.job.status, 'done');
  assert.equal(pollRes.body.job.items[0].libraryEntryId, 'preview-entry-1');
});

test('website preview batch returns a shared running job instead of an expired-batch 404', async () => {
  const shared = createSharedUiStateFixture();
  const jobId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  await shared.setUiStateValues('website_preview_batches', {
    softora_website_preview_batches_v1: JSON.stringify({
      [jobId]: {
        id: jobId,
        ownerKey: 'serve@softora.nl::user-1',
        ownerStub: {
          email: 'serve@softora.nl',
          userId: 'user-1',
          displayName: 'Servé Creusen',
          authenticated: true,
          role: 'admin',
        },
        status: 'running',
        currentIndex: 0,
        items: [
          {
            url: 'https://softora.nl/',
            hostname: 'softora.nl',
            status: 'running',
            error: null,
            libraryEntryId: null,
          },
        ],
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
      },
    }),
  });

  const coordinator = createWebsitePreviewBatchCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    getUiStateValues: shared.getUiStateValues,
    setUiStateValues: shared.setUiStateValues,
    processJobsInline: false,
  });

  const res = createResponseRecorder();
  await coordinator.getBatchResponse(createPremiumRequest({ params: { jobId } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.job.status, 'running');
  assert.equal(res.body.job.items[0].hostname, 'softora.nl');
});

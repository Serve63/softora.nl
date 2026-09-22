const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseStateStore } = require('../../server/services/supabase-state');
const { createWebsitePreviewLibraryCoordinator } = require('../../server/services/website-preview-library');
const { createWebsitePreviewBatchCoordinator } = require('../../server/services/website-preview-batch');
const { RELIABLE_UI_STATE_READ_OPTIONS_BY_SCOPE } = require('../../server/services/ui-seo-runtime');
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('generated photo survives unrelated database cooldown and uncertain first write without regeneration', async () => {
  const rows = new Map();
  const writtenKeys = [];
  let failUnrelatedRequest = true;
  const store = createSupabaseStateStore({
    supabaseUrl: 'https://example.supabase.co', supabaseServiceRoleKey: 'test-key',
    supabaseStateTable: 'runtime_state', supabaseStateKey: 'core',
    fetchImpl: async (_url, options) => {
      if (failUnrelatedRequest) { failUnrelatedRequest = false; throw new Error('network timeout'); }
      if (options.method === 'POST') {
        const [row] = JSON.parse(options.body);
        writtenKeys.push(row.state_key);
        rows.set(row.state_key, row);
        // Database accepted it, but the client lost the acknowledgement.
        if (writtenKeys.length === 1) throw new Error('network timeout after write');
        return { ok: true, status: 201, text: async () => '' };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify([...rows.values()]) };
    },
  });
  await store.fetchSupabaseStateRowViaRest();
  assert.match((await store.fetchSupabaseStateRowViaRest()).error, /tijdelijk overgeslagen/);
  const library = createWebsitePreviewLibraryCoordinator({ ...store, supabaseStateKey: 'core', storageRetrySleep: async () => {} });
  let values = {};
  let generations = 0;
  const batch = createWebsitePreviewBatchCoordinator({
    getUiStateValues: async () => ({ values }), setUiStateValues: async (_, next) => { values = next; return { values }; },
    processJobsInline: true, websitePreviewLibraryCoordinator: library,
    aiToolsCoordinator: { runWebsitePreviewGeneratePipeline: async () => {
      generations += 1;
      return { image: { dataUrl: 'data:image/png;base64,AAAA' } };
    } },
  });
  const req = { premiumAuth: { email: 'test@example.nl', userId: 'test', authenticated: true }, body: { urls: ['example.nl'] } };
  const started = response();
  await batch.startBatchResponse(req, started);
  const status = response();
  await batch.getBatchResponse({ ...req, params: { jobId: started.body.jobId } }, status);
  assert.equal(status.body.job.status, 'done');
  assert.equal(generations, 1);
  assert.equal(writtenKeys.length, 2);
  assert.equal(new Set(writtenKeys).size, 1);
  const listed = response();
  await library.listLibraryResponse(req, listed);
  assert.equal(listed.code, 200);
  assert.equal(listed.body.entries.length, 1);
  assert.equal(listed.body.entries[0].id, status.body.job.items[0].libraryEntryId);
  assert.equal(listed.body.entries[0].dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(RELIABLE_UI_STATE_READ_OPTIONS_BY_SCOPE.website_preview_batches.ignoreSupabaseRestFailureCooldown, true);
});

test('library does not retry permanent storage rejection', async () => {
  let attempts = 0;
  const library = createWebsitePreviewLibraryCoordinator({
    logger: { error() {} }, isSupabaseConfigured: () => true,
    upsertSupabaseRowViaRest: async () => { attempts += 1; return { ok: false, status: 403 }; },
    storageRetrySleep: async () => {},
  });
  const result = await library.persistPreviewLibraryEntry({ email: 'test@example.nl' }, { url: 'https://example.nl', dataUrl: 'data:image/png;base64,AAAA' });
  assert.equal(result.ok, false);
  assert.equal(attempts, 1);
});

test('library bounds transient storage retries', async () => {
  let attempts = 0;
  const library = createWebsitePreviewLibraryCoordinator({
    logger: { error() {} }, isSupabaseConfigured: () => true,
    upsertSupabaseRowViaRest: async () => { attempts += 1; return { ok: false, status: 503 }; },
    storageRetrySleep: async () => {},
  });
  const result = await library.persistPreviewLibraryEntry({ email: 'test@example.nl' }, { url: 'https://example.nl', dataUrl: 'data:image/png;base64,AAAA' });
  assert.equal(result.ok, false);
  assert.equal(attempts, 3);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebsitePreviewLibraryCoordinator } = require('../../server/services/website-preview-library');

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
    setHeader() {},
  };
}

function createFixture(overrides = {}) {
  const rowsByPrefix = [];
  const deletedKeys = [];

  const coordinator = createWebsitePreviewLibraryCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    slugifyAutomationText: (value, fallback = 'gebruiker') =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '') || fallback,
    isSupabaseConfigured: overrides.isSupabaseConfigured || (() => true),
    fetchSupabaseRowsByStateKeyPrefixViaRest:
      overrides.fetchSupabaseRowsByStateKeyPrefixViaRest ||
      (async (prefix, limit = 500, _selectColumns = 'state_key,payload,updated_at', offset = 0) => ({
        ok: true,
        body: rowsByPrefix
          .filter((r) => String(r.state_key || '').startsWith(prefix))
          .slice(offset, offset + limit),
      })),
    fetchSupabaseRowByKeyViaRest:
      overrides.fetchSupabaseRowByKeyViaRest ||
      (async (key) => {
        const row = rowsByPrefix.find((r) => r.state_key === key);
        return row ? { ok: true, body: [row] } : { ok: true, body: [] };
      }),
    upsertSupabaseRowViaRest:
      overrides.upsertSupabaseRowViaRest ||
      (async (row) => {
        rowsByPrefix.push({
          state_key: row.state_key,
          payload: row.payload,
          updated_at: row.updated_at,
        });
        return { ok: true };
      }),
    deleteSupabaseRowByStateKeyViaRest:
      overrides.deleteSupabaseRowByStateKeyViaRest ||
      (async (key) => {
        deletedKeys.push(key);
        const idx = rowsByPrefix.findIndex((r) => r.state_key === key);
        if (idx >= 0) rowsByPrefix.splice(idx, 1);
        return { ok: true };
      }),
    createThumbnailDataUrl:
      overrides.createThumbnailDataUrl || (async () => 'data:image/webp;base64,THUMB'),
    supabaseStateKey: 'core',
  });

  return { coordinator, rowsByPrefix, deletedKeys };
}

test('website preview library coordinator rejects save without url', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();
  await coordinator.saveLibraryResponse({ body: { dataUrl: 'data:image/png;base64,xx' }, premiumAuth: { email: 'a@b.nl' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('website preview library coordinator stores preview row scoped to user', async () => {
  const { coordinator, rowsByPrefix } = createFixture();
  const res = createResponseRecorder();

  await coordinator.saveLibraryResponse(
    {
      body: {
        dataUrl: 'data:image/png;base64,AAA',
        url: 'https://softora.nl/',
        hostname: 'softora.nl',
        fileName: 'softora-preview.png',
        width: 1024,
        height: 1536,
      },
      premiumAuth: { email: 'preview.user@softora.nl' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.entry.id, /^[0-9a-f-]{36}$/i);
  assert.equal(res.body.entry.url, 'https://softora.nl/');
  assert.equal(rowsByPrefix.length, 1);
  assert.match(rowsByPrefix[0].state_key, /^core:website_preview_lib:preview-user-at-softora-nl:/);
});

test('website preview library coordinator does not prune old previews on save', async () => {
  const { coordinator, rowsByPrefix, deletedKeys } = createFixture();
  for (let i = 0; i < 55; i += 1) {
    rowsByPrefix.push({
      state_key: `core:website_preview_lib:preview-user-at-softora-nl:aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`,
      payload: {
        type: 'website_preview_library',
        id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`,
        dataUrl: 'data:image/png;base64,OLD',
        url: `https://old-${i}.example.nl/`,
        hostname: `old-${i}.example.nl`,
        fileName: 'old.png',
      },
      updated_at: new Date(2026, 0, 1, 0, i).toISOString(),
    });
  }

  const res = createResponseRecorder();
  await coordinator.saveLibraryResponse(
    {
      body: {
        dataUrl: 'data:image/png;base64,NEW',
        url: 'https://softora.nl/',
        hostname: 'softora.nl',
      },
      premiumAuth: { email: 'preview.user@softora.nl' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(rowsByPrefix.length, 56);
  assert.deepEqual(deletedKeys, []);
});

test('website preview library coordinator lists entries for all owner prefixes', async () => {
  const { coordinator, rowsByPrefix } = createFixture();
  rowsByPrefix.push({
    state_key: 'core:website_preview_lib:demo-at-user-nl:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    payload: {
      type: 'website_preview_library',
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      dataUrl: 'data:image/png;base64,BBB',
      url: 'https://example.nl/',
      hostname: 'example.nl',
      fileName: 'x.png',
      width: 800,
      height: 1200,
      createdAt: '2026-01-01T12:00:00.000Z',
    },
    updated_at: '2026-01-01T12:00:00.000Z',
  });
  rowsByPrefix.push({
    state_key: 'core:website_preview_lib:ander-at-user-nl:bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    payload: {
      type: 'website_preview_library',
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      dataUrl: 'data:image/png;base64,CCC',
      url: 'https://other.example.nl/',
      hostname: 'other.example.nl',
      fileName: 'y.png',
      width: 800,
      height: 1200,
      createdAt: '2026-01-01T12:01:00.000Z',
    },
    updated_at: '2026-01-01T12:01:00.000Z',
  });

  const res = createResponseRecorder();
  await coordinator.listLibraryResponse({ premiumAuth: { email: 'demo@user.nl' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entries.length, 2);
  assert.equal(res.body.entries[0].hostname, 'example.nl');
  assert.equal(res.body.entries[1].hostname, 'other.example.nl');
});

test('website preview library coordinator paginates all supabase preview rows', async () => {
  const { coordinator, rowsByPrefix } = createFixture();
  for (let i = 0; i < 505; i += 1) {
    const id = `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`;
    rowsByPrefix.push({
      state_key: `core:website_preview_lib:user-${i % 3}:${id}`,
      payload: {
        type: 'website_preview_library',
        id,
        dataUrl: 'data:image/png;base64,BBB',
        url: `https://example-${i}.nl/`,
        hostname: `example-${i}.nl`,
        fileName: 'x.png',
        createdAt: '2026-01-01T12:00:00.000Z',
      },
      updated_at: '2026-01-01T12:00:00.000Z',
    });
  }

  const res = createResponseRecorder();
  await coordinator.listLibraryResponse({ premiumAuth: { email: 'demo@user.nl' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entries.length, 505);
});

test('website preview library coordinator loads one full entry by id', async () => {
  const { coordinator, rowsByPrefix } = createFixture();
  rowsByPrefix.push({
    state_key: 'core:website_preview_lib:demo-at-user-nl:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    payload: {
      type: 'website_preview_library',
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      dataUrl: `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`,
      url: 'https://full.example.nl/',
      hostname: 'full.example.nl',
      fileName: 'full.png',
      width: 1024,
      height: 1536,
      createdAt: '2026-01-01T12:00:00.000Z',
    },
    updated_at: '2026-01-01T12:00:00.000Z',
  });

  const res = createResponseRecorder();
  await coordinator.getLibraryEntryResponse(
    {
      params: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      premiumAuth: { email: 'demo@user.nl' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entry.hostname, 'full.example.nl');
  assert.match(res.body.entry.dataUrl, /^data:image\/png;base64,A+/);
});

test('website preview library coordinator keeps list responses small when stored previews are huge', async () => {
  const { coordinator, rowsByPrefix } = createFixture();
  rowsByPrefix.push({
    state_key: 'core:website_preview_lib:demo-at-user-nl:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    payload: {
      type: 'website_preview_library',
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      dataUrl: `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`,
      url: 'https://large.example.nl/',
      hostname: 'large.example.nl',
      fileName: 'large.png',
      width: 1024,
      height: 1536,
      createdAt: '2026-01-01T12:00:00.000Z',
    },
    updated_at: '2026-01-01T12:00:00.000Z',
  });
  rowsByPrefix.push({
    state_key: 'core:website_preview_lib:demo-at-user-nl:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    payload: {
      type: 'website_preview_library',
      id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      dataUrl: 'data:image/png;base64,BBB',
      url: 'https://small.example.nl/',
      hostname: 'small.example.nl',
      fileName: 'small.png',
      width: 800,
      height: 1200,
      createdAt: '2026-01-01T12:01:00.000Z',
    },
    updated_at: '2026-01-01T12:01:00.000Z',
  });

  const res = createResponseRecorder();
  await coordinator.listLibraryResponse({ premiumAuth: { email: 'demo@user.nl' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entries.length, 2);
  assert.equal(res.body.entries[0].hostname, 'large.example.nl');
  assert.equal(res.body.entries[0].dataUrl, '');
  assert.equal(res.body.entries[0].imageDeferred, true);
  assert.equal(res.body.entries[1].hostname, 'small.example.nl');
  assert.equal(res.body.entries[1].dataUrl, '');
  assert.equal(res.body.omittedLargeItems, 0);
  assert.ok(JSON.stringify(res.body).length < 3.2 * 1024 * 1024);
  const detail = createResponseRecorder();
  await coordinator.getLibraryEntryResponse({ params: { id: res.body.entries[0].id } }, detail);
  assert.equal(detail.statusCode, 200);
  assert.ok(detail.body.entry.dataUrl.length > 3.2 * 1024 * 1024);
});

test('website preview library coordinator delete validates uuid id', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();
  await coordinator.deleteLibraryResponse({ params: { id: 'nope' }, premiumAuth: { email: 'a@b.nl' } }, res);
  assert.equal(res.statusCode, 400);
});

test('website preview library list only selects light columns and returns stored thumbnails', async () => {
  const selects = [];
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const { coordinator } = createFixture({
    fetchSupabaseRowsByStateKeyPrefixViaRest: async (_prefix, _limit, selectColumns) => {
      selects.push(selectColumns);
      return {
        ok: true,
        body: [{
          state_key: `core:website_preview_lib:demo:${id}`,
          updated_at: '2026-01-01T12:00:00.000Z',
          id, url: 'https://thumb.example.nl/', hostname: 'thumb.example.nl', fileName: 't.png',
          width: '1024', height: '1536', createdAt: '2026-01-01T12:00:00.000Z',
          thumbDataUrl: 'data:image/webp;base64,SMALL',
        }],
      };
    },
  });

  const res = createResponseRecorder();
  await coordinator.listLibraryResponse({ premiumAuth: { email: 'demo@user.nl' } }, res);

  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(selects[0], /(^|,)payload(,|$)/);
  assert.doesNotMatch(selects[0], /dataUrl:payload->>dataUrl/);
  assert.equal(res.body.entries[0].thumbDataUrl, 'data:image/webp;base64,SMALL');
  assert.equal(res.body.entries[0].dataUrl, '');
  assert.equal(res.body.entries[0].width, 1024);
});

test('website preview library saves a small thumbnail next to the full image', async () => {
  const { coordinator, rowsByPrefix } = createFixture();
  const res = createResponseRecorder();
  await coordinator.saveLibraryResponse(
    { body: { dataUrl: 'data:image/png;base64,FULL', url: 'https://softora.nl/' }, premiumAuth: { email: 'a@b.nl' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(rowsByPrefix[0].payload.thumbDataUrl, 'data:image/webp;base64,THUMB');
  assert.equal(rowsByPrefix[0].payload.dataUrl, 'data:image/png;base64,FULL');
});

test('website preview library loads one entry by key and backfills a missing thumbnail', async () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const keyLookups = [];
  const upserts = [];
  const stateKey = `core:website_preview_lib:demo:${id}`;
  const fullRow = {
    state_key: stateKey,
    updated_at: '2026-01-01T12:00:00.000Z',
    payload: { type: 'website_preview_library', id, dataUrl: 'data:image/png;base64,FULL', url: 'https://x.nl/' },
  };
  const { coordinator } = createFixture({
    fetchSupabaseRowsByStateKeyPrefixViaRest: async (_prefix, _limit, selectColumns) => {
      assert.doesNotMatch(selectColumns, /(^|,)payload(,|$)/);
      return { ok: true, body: [{ state_key: stateKey, type: 'website_preview_library', id }] };
    },
    fetchSupabaseRowByKeyViaRest: async (key) => {
      keyLookups.push(key);
      return { ok: true, body: [fullRow] };
    },
    upsertSupabaseRowViaRest: async (row) => {
      upserts.push(row);
      return { ok: true };
    },
  });

  const res = createResponseRecorder();
  await coordinator.getLibraryEntryResponse({ params: { id } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(keyLookups, [stateKey]);
  assert.equal(res.body.entry.thumbDataUrl, 'data:image/webp;base64,THUMB');
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].payload.dataUrl, 'data:image/png;base64,FULL');
  assert.equal(upserts[0].payload.thumbDataUrl, 'data:image/webp;base64,THUMB');
  assert.equal(upserts[0].updated_at, '2026-01-01T12:00:00.000Z');
});

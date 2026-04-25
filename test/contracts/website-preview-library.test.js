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
      (async (prefix) => ({
        ok: true,
        body: rowsByPrefix.filter((r) => String(r.state_key || '').startsWith(prefix)),
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
    supabaseStateKey: 'core',
    websitePreviewLibraryMaxItems: 50,
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

test('website preview library coordinator lists entries for same owner prefix', async () => {
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

  const res = createResponseRecorder();
  await coordinator.listLibraryResponse({ premiumAuth: { email: 'demo@user.nl' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entries.length, 1);
  assert.equal(res.body.entries[0].hostname, 'example.nl');
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
  assert.equal(res.body.entries.length, 1);
  assert.equal(res.body.entries[0].hostname, 'small.example.nl');
  assert.equal(res.body.omittedLargeItems, 1);
});

test('website preview library coordinator delete validates uuid id', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();
  await coordinator.deleteLibraryResponse({ params: { id: 'nope' }, premiumAuth: { email: 'a@b.nl' } }, res);
  assert.equal(res.statusCode, 400);
});

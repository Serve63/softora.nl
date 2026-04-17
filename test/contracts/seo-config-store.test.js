const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoConfigStore } = require('../../server/services/seo-config-store');

test('seo config store caches parsed config within the ttl window', async () => {
  let nowMs = 20_000;
  let reads = 0;
  const store = createSeoConfigStore({
    getUiStateValues: async () => {
      reads += 1;
      return {
        values: {
          config_json: JSON.stringify({ version: 2, pages: { home: {} }, images: {}, automation: {} }),
        },
      };
    },
    normalizeString: (value) => String(value || '').trim(),
    getDefaultSeoConfig: () => ({ version: 2, pages: {}, images: {}, automation: {} }),
    normalizeSeoConfig: (value) => ({ ...value, normalized: true }),
    now: () => nowMs,
    cacheTtlMs: 15000,
  });

  const first = await store.getSeoConfigCached();
  const second = await store.getSeoConfigCached();
  nowMs += 20000;
  const third = await store.getSeoConfigCached();

  assert.equal(reads, 2);
  assert.equal(first.normalized, true);
  assert.deepEqual(second, first);
  assert.equal(third.normalized, true);
});

test('seo config store persists config and refreshes the cache immediately', async () => {
  const writes = [];
  const store = createSeoConfigStore({
    getUiStateValues: async () => ({ values: {} }),
    setUiStateValues: async (scope, payload, meta) => {
      writes.push({ scope, payload, meta });
      return { ok: true };
    },
    normalizeString: (value) => String(value || '').trim(),
    getDefaultSeoConfig: () => ({ version: 2, pages: {}, images: {}, automation: {} }),
    normalizeSeoConfig: (value) => ({ ...value, version: 2 }),
    now: () => 42,
    scope: 'seo',
    configKey: 'config_json',
  });

  const persisted = await store.persistSeoConfig(
    { pages: { home: { title: 'Softora' } }, images: {}, automation: {} },
    { source: 'dashboard', actor: 'serve' }
  );
  const cached = await store.getSeoConfigCached();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].scope, 'seo');
  assert.equal(writes[0].meta.source, 'dashboard');
  assert.equal(writes[0].meta.actor, 'serve');
  assert.deepEqual(cached, persisted);
});

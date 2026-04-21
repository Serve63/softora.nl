const test = require('node:test');
const assert = require('node:assert/strict');

const { createSupabaseStateStore } = require('../../server/services/supabase-state');

function createFixture(overrides = {}) {
  const fetchCalls = [];
  const clientCalls = [];
  const fetchImpl =
    overrides.fetchImpl ||
    (async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    });
  const createClient =
    overrides.createClient ||
    ((...args) => {
      clientCalls.push(args);
      return { kind: 'supabase-client' };
    });

  const store = createSupabaseStateStore({
    supabaseUrl: 'https://example.supabase.co/',
    supabaseServiceRoleKey: 'service-role-key',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    supabaseCallUpdateStateKeyPrefix: 'call_update:',
    supabaseCallUpdateRowsFetchLimit: 1000,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    createClient,
    fetchImpl,
    ...overrides,
  });

  return {
    clientCalls,
    fetchCalls,
    store,
  };
}

test('supabase state store reports config, redacts urls and memoizes the client', () => {
  const fixture = createFixture();

  assert.equal(fixture.store.isSupabaseConfigured(), true);
  assert.equal(
    fixture.store.redactSupabaseUrlForDebug('https://example.supabase.co/rest/v1/runtime_state'),
    'https://example.supabase.co'
  );
  assert.equal(
    fixture.store.redactSupabaseUrlForDebug('not a valid url at all'),
    'not a valid url at all'
  );

  const firstClient = fixture.store.getSupabaseClient();
  const secondClient = fixture.store.getSupabaseClient();

  assert.equal(firstClient, secondClient);
  assert.equal(fixture.clientCalls.length, 1);
  assert.deepEqual(fixture.clientCalls[0][2].auth, {
    persistSession: false,
    autoRefreshToken: false,
  });
  assert.equal(typeof fixture.clientCalls[0][2].global.fetch, 'function');
});

test('supabase state store builds stable REST requests for the main runtime snapshot', async () => {
  const fetchCalls = [];
  const fixture = createFixture({
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ payload: { savedAt: '2026-04-08T10:00:00.000Z' } }]),
      };
    },
  });

  const fetchResult = await fixture.store.fetchSupabaseStateRowViaRest();
  const upsertResult = await fixture.store.upsertSupabaseStateRowViaRest({
    state_key: 'runtime_state_main',
    payload: { version: 5 },
  });

  assert.equal(fetchResult.ok, true);
  assert.equal(upsertResult.ok, true);
  assert.equal(fetchCalls.length, 2);

  const fetchUrl = new URL(fetchCalls[0].url);
  assert.equal(fetchUrl.pathname, '/rest/v1/runtime_state');
  assert.equal(fetchUrl.searchParams.get('select'), 'payload,updated_at');
  assert.equal(fetchUrl.searchParams.get('state_key'), 'eq.runtime_state_main');
  assert.equal(fetchUrl.searchParams.get('limit'), '1');
  assert.equal(fetchCalls[0].options.method, 'GET');
  assert.equal(fetchCalls[0].options.headers.apikey, 'service-role-key');

  const upsertUrl = new URL(fetchCalls[1].url);
  assert.equal(upsertUrl.pathname, '/rest/v1/runtime_state');
  assert.equal(upsertUrl.searchParams.get('on_conflict'), 'state_key');
  assert.equal(fetchCalls[1].options.method, 'POST');
  assert.equal(
    fetchCalls[1].options.headers.Prefer,
    'resolution=merge-duplicates,return=minimal'
  );
  assert.deepEqual(JSON.parse(fetchCalls[1].options.body), [
    {
      state_key: 'runtime_state_main',
      payload: { version: 5 },
    },
  ]);
});

test('supabase state store validates generic row keys and preserves parsed bodies', async () => {
  const fetchCalls = [];
  const fixture = createFixture({
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      };
    },
  });

  const invalidFetch = await fixture.store.fetchSupabaseRowByKeyViaRest('');
  const invalidUpsert = await fixture.store.upsertSupabaseRowViaRest({ payload: { foo: 'bar' } });
  const validFetch = await fixture.store.fetchSupabaseRowByKeyViaRest('ui_state:seo');
  const validUpsert = await fixture.store.upsertSupabaseRowViaRest({
    state_key: 'ui_state:seo',
    payload: { values: { tab: 'overview' } },
  });

  assert.equal(invalidFetch.ok, false);
  assert.match(invalidFetch.error || '', /Ongeldige state key/);
  assert.equal(invalidUpsert.ok, false);
  assert.match(invalidUpsert.error || '', /Ongeldige state key/);
  assert.deepEqual(validFetch.body, { ok: true });
  assert.deepEqual(validUpsert.body, { ok: true });

  const fetchUrl = new URL(fetchCalls[0].url);
  assert.equal(fetchUrl.searchParams.get('state_key'), 'eq.ui_state:seo');
  const upsertPayload = JSON.parse(fetchCalls[1].options.body);
  assert.equal(upsertPayload[0].state_key, 'ui_state:seo');
});

test('supabase state store normalizes call update keys and clamps REST fetch limits', async () => {
  const fixture = createFixture();

  assert.equal(fixture.store.buildSupabaseCallUpdateStateKey(' call-123 '), 'call_update:call-123');
  assert.equal(
    fixture.store.extractCallIdFromSupabaseCallUpdateStateKey('call_update:call-123'),
    'call-123'
  );
  assert.equal(fixture.store.extractCallIdFromSupabaseCallUpdateStateKey('other:call-123'), '');

  await fixture.store.fetchSupabaseCallUpdateRowsViaRest(99999);

  assert.equal(fixture.fetchCalls.length, 1);
  const fetchUrl = new URL(fixture.fetchCalls[0].url);
  assert.equal(fetchUrl.pathname, '/rest/v1/runtime_state');
  assert.equal(fetchUrl.searchParams.get('state_key'), 'like.call_update:%');
  assert.equal(fetchUrl.searchParams.get('order'), 'updated_at.desc');
  assert.equal(fetchUrl.searchParams.get('limit'), '2000');
});

test('supabase state store aborts hung REST requests with a timeout error', async () => {
  const fixture = createFixture({
    supabaseRestTimeoutMs: 5,
    fetchImpl: async (_url, options = {}) =>
      new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  const result = await fixture.store.fetchSupabaseStateRowViaRest();

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Supabase REST timeout na/);
});

test('supabase state store wires a timeout-wrapped fetch into the Supabase client', async () => {
  let upstreamSignal = null;
  const fixture = createFixture({
    supabaseRestTimeoutMs: 5,
    fetchImpl: async (_url, options = {}) =>
      new Promise((_, reject) => {
        upstreamSignal = options.signal || null;
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  fixture.store.getSupabaseClient();
  const fetchWithTimeout = fixture.clientCalls[0][2].global.fetch;

  await assert.rejects(fetchWithTimeout('https://example.supabase.co/rest/v1/runtime_state'));
  assert.ok(upstreamSignal, 'Supabase client fetch hoort een abort-signaal te krijgen');
  assert.equal(upstreamSignal.aborted, true);
});

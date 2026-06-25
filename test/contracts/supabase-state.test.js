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
  assert.equal(fixture.clientCalls[0][0], 'https://example.supabase.co');
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

test('supabase state store blocks unsafe REST origins before fetch', async () => {
  const fetchCalls = [];
  const fixture = createFixture({
    supabaseUrl: 'http://169.254.169.254/latest/meta-data',
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    },
  });

  const result = await fixture.store.fetchSupabaseStateRowViaRest();

  assert.equal(result.ok, false);
  assert.match(result.error || '', /host is niet toegestaan/);
  assert.equal(fetchCalls.length, 0);
});

test('supabase state store allows local Supabase REST development hosts', async () => {
  const fetchCalls = [];
  const fixture = createFixture({
    supabaseUrl: 'http://127.0.0.1:54321',
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    },
  });

  const result = await fixture.store.fetchSupabaseStateRowViaRest();

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  const fetchUrl = new URL(fetchCalls[0].url);
  assert.equal(fetchUrl.origin, 'http://127.0.0.1:54321');
  assert.equal(fetchUrl.pathname, '/rest/v1/runtime_state');
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

test('supabase state store rejects oversized REST responses before reading the body', async () => {
  let textRead = false;
  const fixture = createFixture({
    supabaseRestMaxResponseBytes: 16,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name.toLowerCase() === 'content-length' ? '17' : ''),
      },
      text: async () => {
        textRead = true;
        return '{"too":"large"}';
      },
    }),
  });

  const result = await fixture.store.fetchSupabaseStateRowViaRest();

  assert.equal(result.ok, false);
  assert.match(result.error || '', /response te groot/);
  assert.equal(textRead, false);
});

test('supabase state store rejects cross-origin Supabase client fetches before fetch', async () => {
  const fetchCalls = [];
  const fixture = createFixture({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    },
  });
  fixture.store.getSupabaseClient();
  const fetchWithTimeout = fixture.clientCalls[0][2].global.fetch;

  await assert.rejects(
    fetchWithTimeout('https://evil.supabase.co/rest/v1/runtime_state'),
    /host is niet toegestaan/
  );
  assert.equal(fetchCalls.length, 0);
});

test('supabase state store defaults REST and client fetches to a short fail-fast timeout', async () => {
  const capturedTimeouts = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const createHangingFetch = () => async (_url, options = {}) =>
    new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => {
        const reason = options.signal?.reason;
        if (reason instanceof Error) {
          reject(reason);
          return;
        }
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });

  global.setTimeout = (callback, ms) => {
    capturedTimeouts.push(ms);
    queueMicrotask(callback);
    return { ms };
  };
  global.clearTimeout = () => {};

  try {
    const restFixture = createFixture({ fetchImpl: createHangingFetch() });
    const restResult = await restFixture.store.fetchSupabaseStateRowViaRest();
    assert.equal(restResult.ok, false);
    assert.match(restResult.error || '', /Supabase REST timeout na 1500ms/);

    const clientFixture = createFixture({ fetchImpl: createHangingFetch() });
    clientFixture.store.getSupabaseClient();
    const fetchWithTimeout = clientFixture.clientCalls[0][2].global.fetch;
    await assert.rejects(
      fetchWithTimeout('https://example.supabase.co/rest/v1/runtime_state'),
      /Supabase client timeout na 1500ms/
    );
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert.deepEqual(capturedTimeouts, [1500, 1500]);
});

test('supabase state store opens a short REST cooldown after a timeout', async () => {
  let fetchCalls = 0;
  const fixture = createFixture({
    supabaseRestTimeoutMs: 5,
    supabaseRestFailureCooldownMs: 1000,
    fetchImpl: async (_url, options = {}) => {
      fetchCalls += 1;
      return new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  });

  const first = await fixture.store.fetchSupabaseStateRowViaRest();
  const second = await fixture.store.fetchSupabaseStateRowViaRest();

  assert.equal(first.ok, false);
  assert.match(first.error || '', /Supabase REST timeout na/);
  assert.equal(second.ok, false);
  assert.match(second.error || '', /Supabase REST tijdelijk overgeslagen/);
  assert.equal(fetchCalls, 1);
});

test('supabase state store lets critical REST reads ignore shared cooldown and use their own timeout', async () => {
  const capturedTimeouts = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const fixture = createFixture({
    supabaseRestTimeoutMs: 5,
    supabaseRestFailureCooldownMs: 1000,
    fetchImpl: async (_url, options = {}) =>
      new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  global.setTimeout = (callback, ms) => {
    capturedTimeouts.push(ms);
    queueMicrotask(callback);
    return { ms };
  };
  global.clearTimeout = () => {};

  try {
    const first = await fixture.store.fetchSupabaseStateRowViaRest();
    const skipped = await fixture.store.fetchSupabaseStateRowViaRest();
    const critical = await fixture.store.fetchSupabaseRowByKeyViaRest(
      'ui_state:premium_coldmail_autopilot',
      'payload,updated_at',
      {
        timeoutMs: 8000,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      }
    );

    assert.match(first.error || '', /Supabase REST timeout na 1000ms/);
    assert.match(skipped.error || '', /Supabase REST tijdelijk overgeslagen/);
    assert.match(critical.error || '', /Supabase REST timeout na 8000ms/);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert.deepEqual(capturedTimeouts, [1000, 8000]);
});

test('supabase state store lets critical REST writes ignore shared cooldown and use their own timeout', async () => {
  const capturedTimeouts = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const fixture = createFixture({
    supabaseRestTimeoutMs: 5,
    supabaseRestFailureCooldownMs: 1000,
    fetchImpl: async (_url, options = {}) =>
      new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  global.setTimeout = (callback, ms) => {
    capturedTimeouts.push(ms);
    queueMicrotask(callback);
    return { ms };
  };
  global.clearTimeout = () => {};

  try {
    const first = await fixture.store.upsertSupabaseRowViaRest({
      state_key: 'ui_state:premium_customers_database',
      payload: { values: { customers: '[]' } },
    });
    const skipped = await fixture.store.upsertSupabaseRowViaRest({
      state_key: 'ui_state:premium_customers_database',
      payload: { values: { customers: '[]' } },
    });
    const critical = await fixture.store.upsertSupabaseRowViaRest(
      {
        state_key: 'ui_state:premium_customers_database',
        payload: { values: { customers: '[]' } },
      },
      {
        timeoutMs: 8000,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      }
    );

    assert.match(first.error || '', /Supabase REST timeout na 1000ms/);
    assert.match(skipped.error || '', /Supabase REST tijdelijk overgeslagen/);
    assert.match(critical.error || '', /Supabase REST timeout na 8000ms/);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert.deepEqual(capturedTimeouts, [1000, 8000]);
});

test('supabase state store lets critical Supabase clients ignore shared cooldown and use their own timeout', async () => {
  const capturedTimeouts = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let fetchCalls = 0;
  const fixture = createFixture({
    supabaseRestTimeoutMs: 5,
    supabaseRestFailureCooldownMs: 1000,
    fetchImpl: async (_url, options = {}) => {
      fetchCalls += 1;
      return new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          const reason = options.signal?.reason;
          if (reason instanceof Error) {
            reject(reason);
            return;
          }
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  });

  global.setTimeout = (callback, ms) => {
    capturedTimeouts.push(ms);
    queueMicrotask(callback);
    return { ms };
  };
  global.clearTimeout = () => {};

  try {
    const defaultClient = fixture.store.getSupabaseClient();
    const defaultFetch = fixture.clientCalls[0][2].global.fetch;
    await assert.rejects(
      defaultFetch('https://example.supabase.co/rest/v1/runtime_state'),
      /Supabase client timeout na 1000ms/
    );
    await assert.rejects(
      defaultFetch('https://example.supabase.co/rest/v1/runtime_state'),
      /Supabase REST tijdelijk overgeslagen/
    );

    const criticalClient = fixture.store.getSupabaseClient({
      timeoutMs: 8000,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    const secondCriticalClient = fixture.store.getSupabaseClient({
      timeoutMs: 8000,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    const criticalFetch = fixture.clientCalls[1][2].global.fetch;

    await assert.rejects(
      criticalFetch('https://example.supabase.co/rest/v1/runtime_state'),
      /Supabase client timeout na 8000ms/
    );
    assert.notEqual(criticalClient, defaultClient);
    assert.equal(secondCriticalClient, criticalClient);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert.equal(fetchCalls, 2);
  assert.equal(fixture.clientCalls.length, 2);
  assert.deepEqual(capturedTimeouts, [1000, 8000]);
});

test('supabase state store opens REST cooldown after 5xx responses', async () => {
  let fetchCalls = 0;
  const fixture = createFixture({
    supabaseRestFailureCooldownMs: 1000,
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status: 504,
        text: async () => '{"message":"gateway timeout"}',
      };
    },
  });

  const first = await fixture.store.fetchSupabaseStateRowViaRest();
  const second = await fixture.store.fetchSupabaseStateRowViaRest();

  assert.equal(first.ok, false);
  assert.equal(first.status, 504);
  assert.equal(second.ok, false);
  assert.match(second.error || '', /Supabase REST tijdelijk overgeslagen/);
  assert.equal(fetchCalls, 1);
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

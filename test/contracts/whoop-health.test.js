const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createGoogleHealthSheetService } = require('../../server/services/google-health-sheet');
const { createWhoopHealthService, formatDay } = require('../../server/services/whoop-health');
const {
  registerWhoopHealthProtectedRoutes,
  registerWhoopHealthPublicRoutes,
} = require('../../server/routes/whoop-health');

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    redirectLocation: '',
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, location) { this.statusCode = code; this.redirectLocation = location; return this; },
  };
}

function createMemorySupabase(initialTables = {}) {
  const tables = {
    softora_health_whoop_connections: [],
    softora_health_whoop_records: [],
    softora_health_sync_runs: [],
    softora_health_whoop_webhook_events: [],
    ...structuredClone(initialTables),
  };
  let generatedId = 0;

  function from(tableName) {
    const state = {
      action: 'select',
      filters: [],
      limit: null,
      onConflict: '',
      ignoreDuplicates: false,
      order: null,
      pending: null,
      returning: false,
    };

    function matchingRows() {
      let rows = (tables[tableName] || []).filter((row) => state.filters.every((filter) => filter(row)));
      if (state.order) {
        const { column, ascending } = state.order;
        rows = [...rows].sort((left, right) => {
          const compared = String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
          return ascending ? compared : -compared;
        });
      }
      if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
      return rows;
    }

    function execute() {
      const rows = tables[tableName] || (tables[tableName] = []);
      if (state.action === 'select') return { data: matchingRows().map((row) => ({ ...row })), error: null };

      if (state.action === 'update') {
        const updated = [];
        rows.forEach((row) => {
          if (!state.filters.every((filter) => filter(row))) return;
          Object.assign(row, state.pending);
          updated.push({ ...row });
        });
        return { data: state.returning ? updated : null, error: null };
      }

      if (state.action === 'insert') {
        const values = (Array.isArray(state.pending) ? state.pending : [state.pending]).map((value) => ({
          ...(tableName === 'softora_health_sync_runs' && !value.id ? { id: `run-${++generatedId}` } : {}),
          ...value,
        }));
        rows.push(...values);
        return { data: state.returning ? values.map((row) => ({ ...row })) : null, error: null };
      }

      if (state.action === 'upsert') {
        const values = Array.isArray(state.pending) ? state.pending : [state.pending];
        const conflictColumns = String(state.onConflict || '').split(',').filter(Boolean);
        const stored = [];
        values.forEach((value) => {
          const index = conflictColumns.length
            ? rows.findIndex((row) => conflictColumns.every((column) => row[column] === value[column]))
            : -1;
          if (index >= 0 && state.ignoreDuplicates) {
            stored.push(rows[index]);
            return;
          }
          if (index >= 0) rows[index] = { ...rows[index], ...value };
          else rows.push({ ...value });
          stored.push(index >= 0 ? rows[index] : rows[rows.length - 1]);
        });
        return { data: state.returning ? stored.map((row) => ({ ...row })) : null, error: null };
      }

      return { data: null, error: new Error(`unsupported ${state.action}`) };
    }

    const builder = {
      select() { state.returning = state.action !== 'select'; return builder; },
      update(value) { state.action = 'update'; state.pending = { ...value }; return builder; },
      insert(value) { state.action = 'insert'; state.pending = value; return builder; },
      upsert(value, options = {}) {
        state.action = 'upsert';
        state.pending = value;
        state.onConflict = options.onConflict || '';
        state.ignoreDuplicates = Boolean(options.ignoreDuplicates);
        return builder;
      },
      eq(column, value) { state.filters.push((row) => row[column] === value); return builder; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return builder; },
      lte(column, value) { state.filters.push((row) => String(row[column] ?? '') <= String(value)); return builder; },
      gte(column, value) { state.filters.push((row) => String(row[column] ?? '') >= String(value)); return builder; },
      or(expression) {
        const clauses = String(expression || '').split(',').map((clause) => clause.trim());
        state.filters.push((row) => clauses.some((clause) => {
          if (clause.endsWith('.is.null')) return row[clause.slice(0, -8)] == null;
          const lessThanIndex = clause.indexOf('.lt.');
          if (lessThanIndex > 0) {
            const column = clause.slice(0, lessThanIndex);
            return String(row[column] ?? '') < clause.slice(lessThanIndex + 4);
          }
          return false;
        }));
        return builder;
      },
      order(column, options = {}) { state.order = { column, ascending: options.ascending !== false }; return builder; },
      limit(value) { state.limit = Number(value); return builder; },
      maybeSingle: async () => {
        const result = execute();
        return { data: Array.isArray(result.data) ? (result.data[0] || null) : null, error: result.error };
      },
      single: async () => {
        const result = execute();
        return { data: Array.isArray(result.data) ? (result.data[0] || null) : null, error: result.error };
      },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return builder;
  }

  async function rpc(name, args = {}) {
    if (name !== 'softora_claim_whoop_sync_lock') {
      return { data: null, error: new Error(`unsupported rpc ${name}`) };
    }
    const connection = tables.softora_health_whoop_connections
      .find((row) => row.owner_key === args.p_owner_key);
    const currentTime = Date.now();
    const activeUntil = new Date(connection?.sync_lock_until || 0).getTime();
    if (!connection || connection.status !== 'connected' || (
      connection.sync_lock_id && Number.isFinite(activeUntil) && activeUntil > currentTime
    )) {
      return {
        data: [{ acquired: false, claimed_lock_id: null, lock_expires_at: connection?.sync_lock_until || null }],
        error: null,
      };
    }
    connection.sync_lock_id = args.p_lock_id;
    connection.sync_lock_until = new Date(
      currentTime + Math.max(60, Number(args.p_lock_ttl_seconds || 900)) * 1000
    ).toISOString();
    connection.updated_at = new Date(currentTime).toISOString();
    return {
      data: [{ acquired: true, claimed_lock_id: args.p_lock_id, lock_expires_at: connection.sync_lock_until }],
      error: null,
    };
  }

  return { from, rpc, tables };
}

function encryptWhoopTokens(tokens, secret) {
  const key = Buffer.from(secret, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createConnectedWhoopState(secret, overrides = {}) {
  return {
    owner_key: 'serve',
    whoop_user_id: 23320184,
    status: 'connected',
    encrypted_tokens: encryptWhoopTokens({
      access_token: 'access-old',
      refresh_token: 'refresh-old',
      expires_at: Date.now() - 1000,
      scope: 'offline read:recovery',
    }, secret),
    last_synced_day: '2026-07-26',
    token_refresh_lock_id: null,
    token_refresh_lock_until: null,
    sync_lock_id: null,
    sync_lock_until: null,
    ...overrides,
  };
}

test('WHOOP OAuth authorization URL stores an eight-character single-use state', async () => {
  const supabase = createMemorySupabase();
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    config: {
      clientId: 'whoop-client',
      clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback',
      tokenEncryptionKey: crypto.randomBytes(32).toString('base64'),
    },
  });

  const authorizationUrl = new URL(await service.createAuthorizationUrl());
  assert.equal(authorizationUrl.origin, 'https://api.prod.whoop.com');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'whoop-client');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'https://www.softora.nl/api/health/whoop/callback');
  assert.equal(authorizationUrl.searchParams.get('state').length, 8);
  assert.match(authorizationUrl.searchParams.get('scope'), /read:recovery/);
  assert.match(authorizationUrl.searchParams.get('scope'), /offline/);
  assert.equal(supabase.tables.softora_health_whoop_connections.length, 1);
  assert.equal(supabase.tables.softora_health_whoop_connections[0].oauth_state_hash.length, 64);
});

test('WHOOP persists exchanged OAuth tokens before fallible profile enrichment', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const state = 'oauth-state';
  const connection = createConnectedWhoopState(tokenEncryptionKey, {
    status: 'refresh_uncertain',
    oauth_state_hash: crypto.createHash('sha256').update(state).digest('hex'),
    oauth_state_expires_at: new Date(Date.now() + 60000).toISOString(),
    profile: { user_id: 23320184, first_name: 'Servé' },
  });
  const previousEncryptedTokens = connection.encrypted_tokens;
  const supabase = createMemorySupabase({ softora_health_whoop_connections: [connection] });
  const requestedUrls = [];
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes('/oauth/oauth2/token')) {
        return createJsonResponse(200, {
          access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600, scope: 'offline',
        });
      }
      if (String(url).endsWith('/user/profile/basic')) {
        return createJsonResponse(503, { error: 'profile_temporarily_unavailable' });
      }
      return createJsonResponse(200, { height_meter: 1.8 });
    },
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.completeAuthorization({ code: 'one-time-code', state });
  const stored = supabase.tables.softora_health_whoop_connections[0];
  assert.equal(result.ok, true);
  assert.equal(result.profilePending, true);
  assert.equal(stored.status, 'connected');
  assert.notEqual(stored.encrypted_tokens, previousEncryptedTokens);
  assert.equal(stored.oauth_state_hash, null);
  assert.match(stored.last_sync_error, /profielmetadata wordt later bijgewerkt/);
  assert.equal(requestedUrls.filter((url) => url.includes('/oauth/oauth2/token')).length, 1);
  assert.equal(supabase.tables.softora_health_whoop_webhook_events.length, 1);
  assert.equal(supabase.tables.softora_health_whoop_webhook_events[0].event_type, 'internal.backfill');
});

test('WHOOP day formatting follows Europe/Amsterdam around daylight saving time', () => {
  assert.equal(formatDay(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
  assert.equal(formatDay(new Date('2026-10-25T22:30:00Z')), '2026-10-25');
});

test('WHOOP webhook signature uses timestamp plus raw body with the app secret', () => {
  const secret = 'whoop-webhook-secret';
  const timestamp = '1786352400123';
  const rawBody = Buffer.from(JSON.stringify({
    user_id: 23320184,
    id: 'sleep-id',
    type: 'recovery.updated',
    trace_id: 'trace-id',
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(timestamp), rawBody]))
    .digest('base64');
  const service = createWhoopHealthService({
    config: {
      clientId: 'whoop-client',
      clientSecret: secret,
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback',
      tokenEncryptionKey: crypto.randomBytes(32).toString('base64'),
    },
  });

  assert.equal(service.verifyWebhookSignature({ rawBody, timestamp, signature }), true);
  assert.equal(service.verifyWebhookSignature({ rawBody, timestamp, signature: 'invalid' }), false);
});

test('WHOOP refresh never replays a rotating token after an ambiguous 5xx', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey)],
  });
  let tokenCalls = 0;
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.prod.whoop.com/oauth/oauth2/token');
      tokenCalls += 1;
      return createJsonResponse(502, { error: 'bad_gateway' });
    },
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  await assert.rejects(service.sync({ mode: 'daily', targetDay: '2026-08-10' }), /bad_gateway/);
  assert.equal(tokenCalls, 1);
  const connection = supabase.tables.softora_health_whoop_connections[0];
  assert.equal(connection.status, 'refresh_uncertain');
  assert.equal(connection.last_sync_status, 'failed');
  assert.match(connection.last_sync_error, /bad_gateway/);
  assert.equal(connection.token_refresh_lock_id, null);
  assert.equal(connection.sync_lock_id, null);
  assert.equal(supabase.tables.softora_health_sync_runs[0].status, 'failed');

  const status = await service.getStatus();
  assert.equal(status.connected, false);
  assert.equal(status.needsReauthorization, true);
  assert.equal(status.reauthorizationReason, 'refresh_outcome_unknown');
});

test('WHOOP invalid_grant requires reauthorization but malformed requests do not', async () => {
  for (const scenario of [
    { providerError: 'invalid_grant', expectedStatus: 'reauthorization_required' },
    { providerError: 'invalid_request', expectedStatus: 'connected' },
  ]) {
    const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
    const supabase = createMemorySupabase({
      softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey)],
    });
    let tokenCalls = 0;
    const service = createWhoopHealthService({
      getSupabaseClient: () => supabase,
      fetchImpl: async () => {
        tokenCalls += 1;
        return createJsonResponse(400, {
          error: scenario.providerError,
          error_description: scenario.providerError === 'invalid_grant'
            ? 'The refresh token is invalid or revoked'
            : 'The OAuth request is malformed',
        });
      },
      now: () => new Date('2026-08-10T08:00:00.000Z'),
      config: {
        clientId: 'whoop-client', clientSecret: 'whoop-secret',
        redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
      },
    });

    await assert.rejects(service.sync({ mode: 'manual', targetDay: '2026-08-10' }));
    assert.equal(tokenCalls, 1);
    assert.equal(supabase.tables.softora_health_whoop_connections[0].status, scenario.expectedStatus);
    assert.equal(supabase.tables.softora_health_whoop_connections[0].last_sync_status, 'failed');
  }
});

test('WHOOP serializes concurrent syncs and rotates the refresh token once', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const connection = createConnectedWhoopState(tokenEncryptionKey);
  const previousEncryptedTokens = connection.encrypted_tokens;
  const supabase = createMemorySupabase({ softora_health_whoop_connections: [connection] });
  let tokenCalls = 0;
  let dataCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/oauth/oauth2/token')) {
      tokenCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createJsonResponse(200, {
        access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600, scope: 'offline',
      });
    }
    dataCalls += 1;
    return createJsonResponse(200, { records: [], next_token: '' });
  };
  const deps = {
    getSupabaseClient: () => supabase,
    fetchImpl,
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  };
  const first = createWhoopHealthService(deps);
  const second = createWhoopHealthService(deps);

  const results = await Promise.all([
    first.sync({ mode: 'manual', targetDay: '2026-08-10' }),
    second.sync({ mode: 'reconcile', targetDay: '2026-08-10' }),
  ]);

  assert.equal(tokenCalls, 1);
  assert.equal(dataCalls, 4);
  assert.equal(results.filter((result) => result.reason === 'sync_in_progress').length, 1);
  assert.equal(supabase.tables.softora_health_sync_runs.length, 1);
  assert.notEqual(supabase.tables.softora_health_whoop_connections[0].encrypted_tokens, previousEncryptedTokens);
});

test('WHOOP reclaims an expired token-refresh lease without replaying a refresh token', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      token_refresh_lock_id: 'stale-lease',
      token_refresh_lock_until: '2026-08-09T07:00:00.000Z',
    })],
  });
  let tokenCalls = 0;
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      if (String(url).includes('/oauth/oauth2/token')) {
        tokenCalls += 1;
        return createJsonResponse(200, { access_token: 'access-reclaimed', refresh_token: 'refresh-rotated', expires_in: 3600 });
      }
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.sync({ mode: 'manual', targetDay: '2026-08-10' });
  assert.equal(result.ok, true);
  assert.equal(tokenCalls, 1);
  assert.equal(supabase.tables.softora_health_whoop_connections[0].status, 'connected');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].token_refresh_lock_id, null);
});

test('WHOOP status distinguishes an active lease from a stale running status', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      last_sync_status: 'running',
      token_refresh_lock_id: 'active-refresh',
      token_refresh_lock_until: '2026-08-10T08:05:00.000Z',
      sync_lock_id: null,
      sync_lock_until: null,
    })],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    config: { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://www.softora.nl/callback', tokenEncryptionKey },
  });
  const active = await service.getStatus();
  assert.equal(active.tokenRefreshInProgress, true);
  assert.equal(active.syncState, 'token_refreshing');

  supabase.tables.softora_health_whoop_connections[0].token_refresh_lock_id = null;
  supabase.tables.softora_health_whoop_connections[0].token_refresh_lock_until = null;
  const stale = await service.getStatus();
  assert.equal(stale.staleSyncStatus, true);
  assert.equal(stale.syncState, 'stale');

  supabase.tables.softora_health_whoop_connections[0].last_sync_status = 'failed';
  supabase.tables.softora_health_whoop_connections[0].last_sync_error = 'WHOOP-tokenvernieuwing is nog bezig; probeer de sync zo opnieuw.';
  const staleBusyFailure = await service.getStatus();
  assert.equal(staleBusyFailure.staleSyncStatus, true);
  assert.equal(staleBusyFailure.syncState, 'stale');
});

test('WHOOP backfill starts after the last completed day and remains bounded', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: Date.now() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
    })],
  });
  const requestedUrls = [];
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      requestedUrls.push(new URL(String(url)));
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  await service.sync({ mode: 'backfill', targetDay: '2026-08-10' });
  assert.equal(requestedUrls.length, 4);
  requestedUrls.forEach((url) => {
    assert.equal(url.searchParams.get('start'), '2026-07-27T00:00:00.000Z');
    assert.equal(url.searchParams.get('end'), '2026-08-12T00:00:00.000Z');
  });
});

test('WHOOP webhook workers atomically claim one event across concurrent invocations', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-10T08:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: Date.now() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
    })],
    softora_health_whoop_webhook_events: [{
      trace_id: 'trace-atomic', whoop_user_id: 23320184, resource_id: 'recovery-1',
      event_type: 'recovery.updated', status: 'pending', attempts: 0,
      next_attempt_at: nowIso, received_at: nowIso,
    }],
  });
  let dataCalls = 0;
  const deps = {
    getSupabaseClient: () => supabase,
    fetchImpl: async () => {
      dataCalls += 1;
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  };

  const results = await Promise.all([
    createWhoopHealthService(deps).processWebhookQueue({ limit: 5 }),
    createWhoopHealthService(deps).processWebhookQueue({ limit: 5 }),
  ]);

  assert.equal(results.reduce((sum, result) => sum + result.processed, 0), 1);
  assert.equal(dataCalls, 4);
  assert.equal(supabase.tables.softora_health_sync_runs.length, 1);
  assert.equal(supabase.tables.softora_health_whoop_webhook_events[0].status, 'processed');
  assert.equal(supabase.tables.softora_health_whoop_webhook_events[0].attempts, 1);
});

test('Google health sheet service replaces the five managed data ranges', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (new URL(String(url)).hostname === 'oauth2.googleapis.com') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'google-token', expires_in: 3600 }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const service = createGoogleHealthSheetService({
    fetchImpl,
    config: {
      clientEmail: 'health-sheet@example.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      spreadsheetId: 'sheet-123',
    },
  });
  const result = await service.syncSnapshot({
    records: [{
      source_type: 'recovery', source_id: 'cycle-1', local_day: '2026-07-15',
      summary: { recovery_score: 81, hrv_rmssd_milli: 54 }, raw: { score_state: 'SCORED' },
    }],
    runs: [],
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /values:batchClear$/);
  assert.match(calls[2].url, /values:batchUpdate$/);
  const updateBody = JSON.parse(calls[2].options.body);
  assert.deepEqual(updateBody.data.map((item) => item.range), [
    'Dagoverzicht!A1:Q', 'Slaap!A1:O', 'Workouts!A1:P', 'Ruwe_data!A1:J', 'Sync_log!A1:I',
  ]);
  assert.equal(updateBody.data[0].values[1][1], 81);
  assert.equal(updateBody.data[0].values[1][2], 54);
});

test('WHOOP routes keep cron public-secret protected and dashboard admin-only', async () => {
  const routes = { get: new Map(), post: new Map() };
  const app = {
    get(path, ...handlers) { routes.get.set(path, handlers); },
    post(path, ...handlers) { routes.post.set(path, handlers); },
  };
  const service = {
    sync: async () => ({ ok: true, targetDay: '2026-07-15' }),
    syncTodayFallback: async () => ({ ok: true, targetDay: '2026-08-10' }),
    reconcileToday: async () => ({ ok: true, targetDay: '2026-08-10' }),
    processWebhookQueue: async () => ({ ok: true, processed: 0 }),
    acceptWebhook: async () => ({ ok: true, accepted: true }),
    getStatus: async () => ({ connected: true }),
    getDashboard: async () => ({ records: [] }),
    createAuthorizationUrl: async () => 'https://api.prod.whoop.com/oauth/oauth2/auth',
    completeAuthorization: async () => ({ ok: true }),
  };
  const requireAdmin = (_req, _res, next) => next();
  registerWhoopHealthPublicRoutes(app, { service, cronSecret: 'cron-secret' });
  registerWhoopHealthProtectedRoutes(app, { service, requirePremiumAdminApiAccess: requireAdmin });

  const cronHandlers = routes.get.get('/api/health/whoop/daily-sync');
  const denied = createResponseRecorder();
  await cronHandlers[0]({ headers: {} }, denied);
  assert.equal(denied.statusCode, 401);

  const allowed = createResponseRecorder();
  await cronHandlers[0]({ headers: { authorization: 'Bearer cron-secret' } }, allowed);
  assert.equal(allowed.body.ok, true);

  const reconcileHandlers = routes.get.get('/api/health/whoop/reconcile');
  const reconcile = createResponseRecorder();
  await reconcileHandlers[0]({ headers: { authorization: 'Bearer cron-secret' } }, reconcile);
  assert.equal(reconcile.body.ok, true);

  const workerHandlers = routes.get.get('/api/health/whoop/webhook-worker');
  const worker = createResponseRecorder();
  await workerHandlers[0]({ headers: { authorization: 'Bearer cron-secret' } }, worker);
  assert.equal(worker.body.ok, true);

  const statusHandlers = routes.get.get('/api/health/whoop/status');
  assert.equal(statusHandlers[0], requireAdmin);
  const status = createResponseRecorder();
  await statusHandlers[1]({}, status);
  assert.equal(status.body.connected, true);
});

test('WHOOP cron is event-first with reconciliation and a same-day noon fallback', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/webhook-worker' && cron.schedule === '* * * * *'
  ));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/reconcile' && cron.schedule === '*/15 3-11 * * *'
  ));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/daily-sync' && cron.schedule === '0 10,11 * * *'
  ));
  assert.ok(!vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/daily-sync' && cron.schedule === '0 6,7 * * *'
  ));
});

test('WHOOP migrations permit hardened connection, sync and queue states', () => {
  const migration = fs.readFileSync(path.join(
    __dirname,
    '../../supabase/migrations/20260810140540_harden_whoop_rotation_and_queue_claims.sql'
  ), 'utf8');
  assert.match(migration, /add column if not exists sync_lock_id text/);
  assert.match(migration, /'reauthorization_required',[\s\S]*'refresh_uncertain'/);
  assert.match(migration, /'daily', 'backfill', 'manual', 'webhook', 'reconcile'/);
  assert.match(migration, /'pending', 'processing', 'retry', 'processed', 'dead'/);
  assert.match(migration, /check \(attempts >= 0\)/);

  const lockMigration = fs.readFileSync(path.join(
    __dirname,
    '../../supabase/migrations/20260810144500_claim_whoop_sync_lock_atomically.sql'
  ), 'utf8');
  assert.match(lockMigration, /create or replace function public\.softora_claim_whoop_sync_lock/);
  assert.match(lockMigration, /pg_advisory_xact_lock/);
  assert.match(lockMigration, /for update/);
  assert.match(lockMigration, /grant execute on function public\.softora_claim_whoop_sync_lock/);
});

test('health dossier has no manual WHOOP or spreadsheet controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../premium-gezondheidsdossier.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../../assets/premium-health-dossier.js'), 'utf8');
  ['data-health-connect', 'data-health-sync', 'data-health-sheet'].forEach((selector) => {
    assert.doesNotMatch(html, new RegExp(selector));
    assert.doesNotMatch(script, new RegExp(selector));
  });
  assert.match(script, /tokenRefreshInProgress/);
  assert.match(script, /staleSyncStatus/);
  assert.match(script, /laatst bevestigde gegevens/);
  assert.doesNotMatch(script, /laatste sync gaf:/);
});

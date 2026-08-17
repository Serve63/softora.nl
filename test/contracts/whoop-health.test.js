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
  const rpcCalls = [];

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
    rpcCalls.push([name, structuredClone(args)]);
    const connection = tables.softora_health_whoop_connections
      .find((row) => row.owner_key === args.p_owner_key);
    const currentTime = Date.now();

    if (name === 'softora_claim_whoop_sync_run') {
      const activeUntil = new Date(connection?.sync_lock_until || 0).getTime();
      if (!connection || connection.status !== 'connected' || (
        connection.sync_lock_id && Number.isFinite(activeUntil) && activeUntil > currentTime
      )) {
        return {
          data: [{ acquired: false, claimed_lock_id: null, lock_expires_at: connection?.sync_lock_until || null, run_id: null }],
          error: null,
        };
      }
      const runId = `run-${++generatedId}`;
      const startedAt = new Date(currentTime).toISOString();
      const run = {
        id: runId,
        owner_key: args.p_owner_key,
        target_day: args.p_target_day,
        mode: args.p_mode,
        status: 'running',
        started_at: startedAt,
        lock_id: args.p_lock_id,
        attempt: Number(args.p_attempt || 1),
      };
      tables.softora_health_sync_runs.push(run);
      Object.assign(connection, {
        sync_lock_id: args.p_lock_id,
        sync_lock_until: new Date(
          currentTime + Math.max(60, Number(args.p_lock_ttl_seconds || 900)) * 1000
        ).toISOString(),
        last_sync_run_id: runId,
        last_sync_started_at: startedAt,
        last_sync_status: 'running',
        last_sync_error: null,
        last_sync_error_code: null,
        last_sync_attempt: Number(args.p_attempt || 1),
        next_retry_at: null,
        updated_at: startedAt,
      });
      return {
        data: [{
          acquired: true,
          claimed_lock_id: args.p_lock_id,
          lock_expires_at: connection.sync_lock_until,
          run_id: runId,
        }],
        error: null,
      };
    }

    if (name === 'softora_finish_whoop_sync_run') {
      const run = tables.softora_health_sync_runs.find((row) => row.id === args.p_run_id);
      if (!connection || !run || connection.sync_lock_id !== args.p_lock_id
        || connection.last_sync_run_id !== args.p_run_id || run.lock_id !== args.p_lock_id
        || run.status !== 'running') return { data: false, error: null };
      const completedAt = new Date(currentTime).toISOString();
      Object.assign(run, {
        status: args.p_status,
        records_seen: Number(args.p_records_seen || 0),
        records_upserted: Number(args.p_records_upserted || 0),
        error_code: args.p_error_code || null,
        error: args.p_error_message || null,
        next_retry_at: args.p_next_retry_at || null,
        completed_at: completedAt,
      });
      Object.assign(connection, {
        sync_lock_id: null,
        sync_lock_until: null,
        last_sync_status: args.p_status,
        last_sync_error_code: args.p_error_code || null,
        last_sync_error: args.p_error_message || null,
        next_retry_at: args.p_next_retry_at || null,
        updated_at: completedAt,
      });
      if (args.p_status === 'completed') {
        connection.last_sync_completed_at = completedAt;
        if (args.p_last_synced_day) connection.last_synced_day = args.p_last_synced_day;
        if (args.p_whoop_user_id) connection.whoop_user_id = args.p_whoop_user_id;
      }
      return { data: true, error: null };
    }

    if (name === 'softora_claim_whoop_refresh_lock') {
      const activeUntil = new Date(connection?.token_refresh_lock_until || 0).getTime();
      if (!connection || connection.status !== 'connected' || (
        connection.token_refresh_lock_id && Number.isFinite(activeUntil) && activeUntil > currentTime
      )) {
        return {
          data: [{ acquired: false, claimed_lock_id: null, lock_expires_at: connection?.token_refresh_lock_until || null }],
          error: null,
        };
      }
      connection.token_refresh_lock_id = args.p_lock_id;
      connection.token_refresh_lock_until = new Date(
        currentTime + Math.max(30, Number(args.p_lock_ttl_seconds || 60)) * 1000
      ).toISOString();
      return {
        data: [{
          acquired: true,
          claimed_lock_id: args.p_lock_id,
          lock_expires_at: connection.token_refresh_lock_until,
          encrypted_tokens: connection.encrypted_tokens,
          connection_status: connection.status,
        }],
        error: null,
      };
    }

    if (name === 'softora_finish_whoop_refresh') {
      if (!connection || connection.token_refresh_lock_id !== args.p_lock_id) return { data: false, error: null };
      const activeUntil = new Date(connection.token_refresh_lock_until || 0).getTime();
      if (args.p_outcome === 'completed' && (
        !args.p_encrypted_tokens || !Number.isFinite(activeUntil) || activeUntil <= currentTime
      )) return { data: false, error: null };
      if (args.p_outcome === 'completed') {
        connection.encrypted_tokens = args.p_encrypted_tokens;
        connection.status = 'connected';
      } else if (args.p_outcome === 'reauthorization_required' || args.p_outcome === 'refresh_uncertain') {
        connection.status = args.p_outcome;
      }
      connection.last_sync_error_code = args.p_error_code || null;
      connection.last_sync_error = args.p_error_message || null;
      connection.token_refresh_lock_id = null;
      connection.token_refresh_lock_until = null;
      return { data: true, error: null };
    }

    return { data: null, error: new Error(`unsupported rpc ${name}`) };
  }

  return { from, rpc, rpcCalls, tables };
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
  connection.status = 'refresh_uncertain';
  const previousEncryptedTokens = connection.encrypted_tokens;
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [connection],
    softora_health_whoop_webhook_events: [{
      trace_id: 'deferred-before-reauth', whoop_user_id: 23320184, resource_id: 'recovery-old',
      event_type: 'recovery.updated', status: 'dead', attempts: 8,
      next_attempt_at: '2026-08-11T08:00:00.000Z', received_at: '2026-08-10T07:00:00.000Z',
      last_error: 'WHOOP_REFRESH_OUTCOME_UNKNOWN',
    }],
  });
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
  assert.equal(stored.last_synced_day, null);
  assert.match(stored.last_sync_error, /profielmetadata wordt later bijgewerkt/);
  assert.equal(requestedUrls.filter((url) => url.includes('/oauth/oauth2/token')).length, 1);
  assert.equal(supabase.tables.softora_health_whoop_webhook_events.length, 2);
  const resumed = supabase.tables.softora_health_whoop_webhook_events
    .find((event) => event.trace_id === 'deferred-before-reauth');
  assert.equal(resumed.status, 'retry');
  assert.equal(resumed.attempts, 0);
  assert.equal(resumed.last_error, null);
  assert.ok(supabase.tables.softora_health_whoop_webhook_events
    .some((event) => event.event_type === 'internal.backfill'));
  const backfill = supabase.tables.softora_health_whoop_webhook_events
    .find((event) => event.event_type === 'internal.backfill');
  assert.equal(backfill.resource_id, '2026-05-13');
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
  const nowIso = '2026-08-10T08:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-expiring', refresh_token: 'refresh-old',
        expires_at: new Date(nowIso).getTime() + 60000, scope: 'offline',
      }, tokenEncryptionKey),
    })],
  });
  let tokenCalls = 0;
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.prod.whoop.com/oauth/oauth2/token');
      tokenCalls += 1;
      return createJsonResponse(502, { error: 'bad_gateway' });
    },
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  await assert.rejects(service.maintainToken(), /bad_gateway/);
  assert.equal(tokenCalls, 1);
  const connection = supabase.tables.softora_health_whoop_connections[0];
  assert.equal(connection.status, 'refresh_uncertain');
  assert.match(connection.last_sync_error, /bad_gateway/);
  assert.equal(connection.token_refresh_lock_id, null);
  assert.equal(connection.sync_lock_id, null);
  assert.equal(supabase.tables.softora_health_sync_runs.length, 0);

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
    const nowIso = '2026-08-10T08:00:00.000Z';
    const supabase = createMemorySupabase({
      softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
        encrypted_tokens: encryptWhoopTokens({
          access_token: 'access-expiring', refresh_token: 'refresh-old',
          expires_at: new Date(nowIso).getTime() + 60000, scope: 'offline',
        }, tokenEncryptionKey),
      })],
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
      now: () => new Date(nowIso),
      config: {
        clientId: 'whoop-client', clientSecret: 'whoop-secret',
        redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
      },
    });

    await assert.rejects(service.maintainToken());
    assert.equal(tokenCalls, 1);
    assert.equal(supabase.tables.softora_health_whoop_connections[0].status, scenario.expectedStatus);
    assert.equal(supabase.tables.softora_health_sync_runs.length, 0);
  }
});

test('WHOOP serializes concurrent token workers and keeps data syncs away from refresh', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-10T08:00:00.000Z';
  const connection = createConnectedWhoopState(tokenEncryptionKey, {
    encrypted_tokens: encryptWhoopTokens({
      access_token: 'access-expiring', refresh_token: 'refresh-old',
      expires_at: new Date(nowIso).getTime() + 60000, scope: 'offline',
    }, tokenEncryptionKey),
  });
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
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  };
  const first = createWhoopHealthService(deps);
  const second = createWhoopHealthService(deps);

  const results = await Promise.all([
    first.maintainToken(),
    second.maintainToken(),
  ]);

  assert.equal(tokenCalls, 1);
  assert.equal(dataCalls, 0);
  assert.ok(results.every((result) => result.ok === true));
  assert.equal(supabase.tables.softora_health_sync_runs.length, 0);
  assert.notEqual(supabase.tables.softora_health_whoop_connections[0].encrypted_tokens, previousEncryptedTokens);
  assert.equal(supabase.rpcCalls.filter(([name]) => name === 'softora_claim_whoop_sync_run').length, 0);
  assert.equal(supabase.rpcCalls.filter(([name]) => name === 'softora_claim_whoop_refresh_lock').length, 2);
  assert.equal(supabase.rpcCalls.filter(([name]) => name === 'softora_finish_whoop_refresh').length, 1);

  const current = supabase.tables.softora_health_whoop_connections[0];
  current.encrypted_tokens = encryptWhoopTokens({
    access_token: 'access-nearly-expired', refresh_token: 'refresh-new',
    expires_at: new Date(nowIso).getTime() + 30000, scope: 'offline',
  }, tokenEncryptionKey);
  await assert.rejects(
    first.sync({ mode: 'manual', targetDay: '2026-08-10' }),
    (error) => error.code === 'WHOOP_TOKEN_REFRESH_DEFERRED'
  );
  assert.equal(tokenCalls, 1);
  assert.equal(supabase.tables.softora_health_sync_runs.at(-1).status, 'failed');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].sync_lock_id, null);
});

test('WHOOP reclaims an expired token-refresh lease without replaying a refresh token', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-10T08:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-expiring', refresh_token: 'refresh-old',
        expires_at: new Date(nowIso).getTime() + 60000, scope: 'offline',
      }, tokenEncryptionKey),
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
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.maintainToken();
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
  assert.equal(active.syncState, 'syncing');

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

test('WHOOP webhook worker defers auth-blocked events without consuming attempts', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-10T08:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      status: 'refresh_uncertain',
    })],
    softora_health_whoop_webhook_events: [{
      trace_id: 'trace-auth-deferred', whoop_user_id: 23320184, resource_id: 'recovery-1',
      event_type: 'recovery.updated', status: 'pending', attempts: 0,
      next_attempt_at: nowIso, received_at: nowIso,
    }],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async () => assert.fail('auth-blocked queue mag WHOOP niet aanroepen'),
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.processWebhookQueue({ limit: 5 });
  const event = supabase.tables.softora_health_whoop_webhook_events[0];
  assert.equal(result.results[0].deferred, true);
  assert.equal(result.results[0].reason, 'whoop_refresh_outcome_unknown');
  assert.equal(event.status, 'retry');
  assert.equal(event.attempts, 0);
  assert.equal(event.last_error, 'whoop_refresh_outcome_unknown');
  assert.ok(new Date(event.next_attempt_at).getTime() > new Date(nowIso).getTime());
});

test('WHOOP fenced completion cannot let an expired sync owner overwrite a newer run', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const connection = createConnectedWhoopState(tokenEncryptionKey, {
    encrypted_tokens: encryptWhoopTokens({
      access_token: 'access-valid', refresh_token: 'refresh-valid',
      expires_at: Date.now() + 3600000, scope: 'offline',
    }, tokenEncryptionKey),
  });
  const supabase = createMemorySupabase({ softora_health_whoop_connections: [connection] });
  let fenceStolen = false;
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async () => {
      if (!fenceStolen) {
        fenceStolen = true;
        supabase.tables.softora_health_whoop_connections[0].sync_lock_id = 'newer-lock';
        supabase.tables.softora_health_whoop_connections[0].last_sync_run_id = 'newer-run';
      }
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date('2026-08-12T16:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  await assert.rejects(
    service.sync({ mode: 'daily', targetDay: '2026-08-12' }),
    (error) => error.code === 'WHOOP_SYNC_LOCK_FENCE_LOST'
  );
  assert.equal(supabase.tables.softora_health_sync_runs[0].status, 'running');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].sync_lock_id, 'newer-lock');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].last_sync_run_id, 'newer-run');
});

test('WHOOP retries idempotent provider reads on 429 without retrying token refresh', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: Date.now() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: '2026-08-11',
    })],
  });
  let cycleCalls = 0;
  const sleeps = [];
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    sleep: async (delay) => sleeps.push(delay),
    random: () => 0,
    fetchImpl: async (url) => {
      if (String(url).includes('/cycle?')) {
        cycleCalls += 1;
        if (cycleCalls === 1) return createJsonResponse(429, { error: 'rate_limited' });
      }
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date('2026-08-12T16:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.sync({ mode: 'daily', targetDay: '2026-08-12' });
  assert.equal(result.ok, true);
  assert.equal(cycleCalls, 2);
  assert.deepEqual(sleeps, [250]);
  assert.equal(supabase.rpcCalls.filter(([name]) => name === 'softora_claim_whoop_refresh_lock').length, 0);
});

test('WHOOP provider 5xx schedules bounded retry and preserves stored data', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const existingRecord = {
    owner_key: 'serve', whoop_user_id: 23320184, source_type: 'recovery',
    source_id: 'existing-recovery', local_day: '2026-08-10', score_state: 'SCORED',
  };
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: Date.now() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: '2026-08-10',
    })],
    softora_health_whoop_records: [existingRecord],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    sleep: async () => {},
    random: () => 0,
    fetchImpl: async () => createJsonResponse(503, { error: 'temporarily_unavailable' }),
    now: () => new Date('2026-08-12T16:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  await assert.rejects(
    service.sync({ mode: 'backfill', targetDay: '2026-08-12' }),
    (error) => error.code === 'WHOOP_PROVIDER_UNAVAILABLE'
  );
  const connection = supabase.tables.softora_health_whoop_connections[0];
  assert.equal(connection.last_sync_status, 'failed');
  assert.equal(connection.last_sync_error_code, 'WHOOP_PROVIDER_UNAVAILABLE');
  assert.ok(new Date(connection.next_retry_at).getTime() > new Date('2026-08-12T16:00:00.000Z').getTime());
  assert.deepEqual(supabase.tables.softora_health_whoop_records, [existingRecord]);

  const status = await service.getStatus();
  assert.equal(status.syncState, 'provider_unavailable');
  assert.equal(status.retryScheduled, true);
  assert.equal(status.providerUnavailable, true);
  assert.deepEqual(status.alerts.sort(), ['expected_day_missing', 'provider_unavailable', 'stale_sync_state']);
});

test('WHOOP worker automatically backfills a missing expected day through the shared claim RPC', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: Date.now() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: '2026-08-10',
      last_sync_status: 'completed',
    })],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => createJsonResponse(200, {
      records: String(url).includes('/recovery?') ? [
        {
          cycle_id: 1706990000,
          user_id: 23320184,
          created_at: '2026-08-11T08:00:00.000Z',
          updated_at: '2026-08-11T09:00:00.000Z',
          score_state: 'SCORED',
          score: { recovery_score: 72 },
        },
        {
          cycle_id: 1707000000,
          user_id: 23320184,
          created_at: '2026-08-12T08:00:00.000Z',
          updated_at: '2026-08-12T09:00:00.000Z',
          score_state: 'SCORED',
          score: { recovery_score: 81 },
        },
      ] : [],
      next_token: '',
    }),
    now: () => new Date('2026-08-12T16:00:00.000Z'),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const worker = await service.processWebhookQueue({ limit: 5 });
  assert.equal(worker.processed, 0);
  assert.equal(worker.monitoring.ok, true);
  assert.equal(worker.monitoring.result.targetDayStored, true);
  assert.equal(worker.monitoring.result.targetDayComplete, true);
  assert.equal(supabase.tables.softora_health_whoop_connections[0].last_synced_day, '2026-08-12');
  assert.equal(supabase.tables.softora_health_whoop_records.length, 2);
  assert.equal(supabase.rpcCalls.filter(([name]) => name === 'softora_claim_whoop_sync_run').length, 1);

  const status = await service.getStatus();
  assert.equal(status.current, true);
  assert.equal(status.syncState, 'current');
  assert.equal(status.expectedDay, '2026-08-12');
  assert.equal(Object.hasOwn(status, 'profile'), false);
  assert.equal(Object.hasOwn(status, 'bodyMeasurement'), false);
});

test('WHOOP only advances the completed day for scored or confirmed unscorable recovery', async () => {
  for (const scenario of [
    { scoreState: 'PENDING_SCORE', expectedComplete: false, expectedLastDay: '2026-08-11' },
    { scoreState: 'UNSCORABLE', expectedComplete: true, expectedLastDay: '2026-08-12' },
  ]) {
    const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
    const nowIso = '2026-08-12T16:00:00.000Z';
    const supabase = createMemorySupabase({
      softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
        encrypted_tokens: encryptWhoopTokens({
          access_token: 'access-valid', refresh_token: 'refresh-valid',
          expires_at: new Date(nowIso).getTime() + 3600000, scope: 'offline',
        }, tokenEncryptionKey),
        last_synced_day: '2026-08-11',
      })],
    });
    const service = createWhoopHealthService({
      getSupabaseClient: () => supabase,
      fetchImpl: async (url) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith('/recovery')) {
          return createJsonResponse(200, { records: [{
            cycle_id: 1707000000,
            user_id: 23320184,
            created_at: '2026-08-12T08:00:00.000Z',
            updated_at: '2026-08-12T09:00:00.000Z',
            score_state: scenario.scoreState,
            score: {},
          }], next_token: '' });
        }
        if (pathname.endsWith('/activity/workout')) {
          return createJsonResponse(200, { records: [{
            id: 'workout-1', user_id: 23320184,
            start: '2026-08-12T12:00:00.000Z', end: '2026-08-12T13:00:00.000Z',
            score_state: 'SCORED', score: { strain: 8.1 },
          }], next_token: '' });
        }
        return createJsonResponse(200, { records: [], next_token: '' });
      },
      now: () => new Date(nowIso),
      config: {
        clientId: 'whoop-client', clientSecret: 'whoop-secret',
        redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
      },
    });

    const result = await service.sync({ mode: 'daily', targetDay: '2026-08-12' });
    assert.equal(result.targetDayStored, true);
    assert.equal(result.targetDayComplete, scenario.expectedComplete);
    assert.equal(result.recoveryRangeComplete, scenario.expectedComplete);
    assert.equal(supabase.tables.softora_health_whoop_connections[0].last_synced_day, scenario.expectedLastDay);
    assert.equal(Boolean(result.nextRetryAt), !scenario.expectedComplete);
  }
});

test('WHOOP backfill never leaps over a missing recovery day', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-12T16:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: new Date(nowIso).getTime() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: '2026-08-10',
    })],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/recovery')) {
        return createJsonResponse(200, { records: [{
          cycle_id: 1707000000, user_id: 23320184,
          created_at: '2026-08-12T08:00:00.000Z', score_state: 'SCORED',
          score: { recovery_score: 81 },
        }], next_token: '' });
      }
      if (pathname.endsWith('/activity/sleep')) {
        return createJsonResponse(200, { records: [{
          id: 'sleep-without-recovery', user_id: 23320184,
          start: '2026-08-10T23:00:00.000Z', end: '2026-08-11T07:00:00.000Z',
          nap: false, score_state: 'SCORED', score: {},
        }], next_token: '' });
      }
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.sync({ mode: 'backfill', targetDay: '2026-08-12' });
  assert.equal(result.targetDayComplete, true);
  assert.equal(result.recoveryRangeComplete, false);
  assert.equal(result.lastCompleteRecoveryDay, '2026-08-12');
  assert.equal(result.lastContiguousRecoveryDay, '2026-08-10');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].last_synced_day, '2026-08-10');
  assert.ok(result.nextRetryAt);
});

test('WHOOP backfill treats historical days without a main sleep as verified no-recovery days', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-12T16:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: new Date(nowIso).getTime() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: '2026-08-10',
    })],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/recovery')) {
        return createJsonResponse(200, { records: [{
          cycle_id: 1707000000, user_id: 23320184,
          created_at: '2026-08-12T08:00:00.000Z', score_state: 'SCORED',
          score: { recovery_score: 81 },
        }], next_token: '' });
      }
      if (pathname.endsWith('/activity/sleep')) {
        return createJsonResponse(200, { records: [{
          id: 'historical-nap', user_id: 23320184,
          start: '2026-08-11T12:00:00.000Z', end: '2026-08-11T12:30:00.000Z',
          nap: true, score_state: 'SCORED', score: {},
        }], next_token: '' });
      }
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const result = await service.sync({ mode: 'backfill', targetDay: '2026-08-12' });
  assert.equal(result.targetDayComplete, true);
  assert.equal(result.recoveryRangeComplete, true);
  assert.equal(result.lastContiguousRecoveryDay, '2026-08-12');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].last_synced_day, '2026-08-12');
  assert.equal(result.nextRetryAt, null);
});

test('WHOOP resumed webhook cannot outrun the reauthorization backfill', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-17T08:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: new Date(nowIso).getTime() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: null,
    })],
    softora_health_whoop_webhook_events: [{
      trace_id: 'resumed-before-backfill', whoop_user_id: 23320184, resource_id: 'recovery-old',
      event_type: 'recovery.updated', status: 'retry', attempts: 0,
      next_attempt_at: nowIso, received_at: '2026-08-11T07:00:00.000Z', last_error: null,
    }, {
      trace_id: 'internal-backfill-after-reauth', whoop_user_id: 23320184, resource_id: '2026-05-20',
      event_type: 'internal.backfill', status: 'pending', attempts: 0,
      next_attempt_at: nowIso, received_at: nowIso, last_error: null,
    }],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => createJsonResponse(200, {
      records: String(url).includes('/recovery?') ? [{
        cycle_id: 1707000000, user_id: 23320184,
        created_at: '2026-08-17T08:00:00.000Z', score_state: 'SCORED',
        score: { recovery_score: 80 },
      }] : [],
      next_token: '',
    }),
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const worker = await service.processWebhookQueue({ limit: 1 });
  assert.equal(worker.processed, 1);
  assert.equal(worker.results[0].result.targetDayComplete, true);
  assert.equal(worker.results[0].result.recoveryRangeComplete, false);
  assert.equal(worker.results[0].result.lastContiguousRecoveryDay, null);
  assert.equal(supabase.tables.softora_health_whoop_connections[0].last_synced_day, null);
  assert.equal(supabase.tables.softora_health_whoop_webhook_events[1].status, 'pending');
});

test('WHOOP forced reauthorization backfill repairs stale progress before a gap', async () => {
  const tokenEncryptionKey = crypto.randomBytes(32).toString('base64');
  const nowIso = '2026-08-17T08:00:00.000Z';
  const supabase = createMemorySupabase({
    softora_health_whoop_connections: [createConnectedWhoopState(tokenEncryptionKey, {
      encrypted_tokens: encryptWhoopTokens({
        access_token: 'access-valid', refresh_token: 'refresh-valid',
        expires_at: new Date(nowIso).getTime() + 3600000, scope: 'offline',
      }, tokenEncryptionKey),
      last_synced_day: '2026-08-17',
    })],
    softora_health_whoop_webhook_events: [{
      trace_id: 'forced-backfill-repair', whoop_user_id: 23320184, resource_id: '2026-08-10',
      event_type: 'internal.backfill', status: 'pending', attempts: 0,
      next_attempt_at: nowIso, received_at: nowIso, last_error: null,
    }],
  });
  const service = createWhoopHealthService({
    getSupabaseClient: () => supabase,
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/recovery')) {
        return createJsonResponse(200, { records: [
          {
            cycle_id: 1706990000, user_id: 23320184,
            created_at: '2026-08-10T08:00:00.000Z', score_state: 'SCORED',
            score: { recovery_score: 47 },
          },
          {
            cycle_id: 1707000000, user_id: 23320184,
            created_at: '2026-08-12T08:00:00.000Z', score_state: 'SCORED',
            score: { recovery_score: 66 },
          },
        ], next_token: '' });
      }
      if (pathname.endsWith('/activity/sleep')) {
        return createJsonResponse(200, { records: [{
          id: 'sleep-without-recovery', user_id: 23320184,
          start: '2026-08-10T23:00:00.000Z', end: '2026-08-11T07:00:00.000Z',
          nap: false, score_state: 'SCORED', score: {},
        }], next_token: '' });
      }
      return createJsonResponse(200, { records: [], next_token: '' });
    },
    now: () => new Date(nowIso),
    config: {
      clientId: 'whoop-client', clientSecret: 'whoop-secret',
      redirectUri: 'https://www.softora.nl/api/health/whoop/callback', tokenEncryptionKey,
    },
  });

  const worker = await service.processWebhookQueue({ limit: 1 });
  assert.equal(worker.processed, 1);
  assert.equal(worker.results[0].result.recoveryRangeComplete, false);
  assert.equal(worker.results[0].result.lastContiguousRecoveryDay, '2026-08-10');
  assert.equal(supabase.tables.softora_health_whoop_connections[0].last_synced_day, '2026-08-10');
  assert.ok(worker.results[0].result.nextRetryAt);
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
    maintainToken: async () => ({ ok: true, refreshed: true }),
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

  const tokenHandlers = routes.get.get('/api/health/whoop/token-worker');
  const tokenDenied = createResponseRecorder();
  await tokenHandlers[0]({ headers: {} }, tokenDenied);
  assert.equal(tokenDenied.statusCode, 401);
  const tokenAllowed = createResponseRecorder();
  await tokenHandlers[0]({ headers: { authorization: 'Bearer cron-secret' } }, tokenAllowed);
  assert.equal(tokenAllowed.body.refreshed, true);

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

test('WHOOP crons keep refresh and data syncs away from provider peak minutes', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/webhook-worker' && cron.schedule === '* * * * *'
  ));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/token-worker' && cron.schedule === '7,22,37,52 * * * *'
  ));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/reconcile' && cron.schedule === '11,26,41,56 3-11 * * *'
  ));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/daily-sync' && cron.schedule === '17 10,11 * * *'
  ));
  const dangerousMinutes = new Set(['0', '15', '30', '45']);
  vercelConfig.crons.filter((cron) => cron.path.startsWith('/api/health/whoop/'))
    .filter((cron) => cron.path !== '/api/health/whoop/webhook-worker')
    .forEach((cron) => {
      String(cron.schedule).split(/\s+/)[0].split(',').forEach((minute) => {
        assert.equal(dangerousMinutes.has(minute), false, `${cron.path} gebruikt risicominuut ${minute}`);
      });
    });
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

  const stateMachineMigration = fs.readFileSync(path.join(
    __dirname,
    '../../supabase/migrations/20260812183000_harden_whoop_atomic_state_machine.sql'
  ), 'utf8');
  [
    'softora_claim_whoop_sync_run',
    'softora_finish_whoop_sync_run',
    'softora_claim_whoop_refresh_lock',
    'softora_finish_whoop_refresh',
  ].forEach((functionName) => {
    assert.match(stateMachineMigration, new RegExp(`create or replace function public\\.${functionName}`));
  });
  assert.match(stateMachineMigration, /pg_advisory_xact_lock\(824031, 5\)/);
  assert.match(stateMachineMigration, /pg_advisory_xact_lock\(824031, 6\)/);
  assert.match(stateMachineMigration, /last_sync_run_id is distinct from p_run_id/);
  assert.match(stateMachineMigration, /token_refresh_lock_id is distinct from v_lock_id/);
  assert.match(stateMachineMigration, /grant execute on function public\.softora_claim_whoop_refresh_lock[\s\S]*to service_role/);
  assert.match(stateMachineMigration, /where status = 'dead'[\s\S]*WHOOP-tokenvernieuwing had geen actieve lease meer/);

  const fencingMigration = fs.readFileSync(path.join(
    __dirname,
    '../../supabase/migrations/20260817081928_whoop_token_worker_fencing.sql'
  ), 'utf8');
  assert.match(fencingMigration, /create or replace function public\.softora_enforce_whoop_operation_fencing/);
  assert.match(fencingMigration, /security invoker/);
  assert.match(fencingMigration, /WHOOP_TOKEN_REFRESH_ACTIVE/);
  assert.match(fencingMigration, /WHOOP_SYNC_ACTIVE/);
  assert.match(fencingMigration, /create trigger softora_whoop_operation_fencing/);
  assert.match(fencingMigration, /revoke all on function public\.softora_enforce_whoop_operation_fencing\(\)/);

  const serviceSource = fs.readFileSync(path.join(__dirname, '../../server/services/whoop-health.js'), 'utf8');
  assert.match(serviceSource, /rpc\('softora_claim_whoop_sync_run'/);
  assert.match(serviceSource, /rpc\('softora_finish_whoop_sync_run'/);
  assert.match(serviceSource, /rpc\('softora_claim_whoop_refresh_lock'/);
  assert.match(serviceSource, /rpc\('softora_finish_whoop_refresh'/);
  assert.doesNotMatch(serviceSource, /\.or\(`token_refresh_lock_until/);
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
  assert.match(script, /retry_scheduled/);
  assert.match(script, /provider_unavailable/);
  assert.match(script, /laatst bevestigde gegevens/);
  assert.doesNotMatch(script, /laatste sync gaf:/);
});

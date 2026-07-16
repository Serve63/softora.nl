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

function createMemorySupabase() {
  const tables = { softora_health_whoop_connections: [] };
  function from(tableName) {
    const state = { filters: [], pending: null, mode: '' };
    const builder = {
      select() { state.mode = state.mode || 'select'; return builder; },
      eq(column, value) { state.filters.push([column, value]); return builder; },
      maybeSingle: async () => {
        const row = (tables[tableName] || []).find((item) => state.filters.every(([key, value]) => item[key] === value));
        return { data: row || null, error: null };
      },
      upsert(value) { state.pending = { ...value }; state.mode = 'upsert'; return builder; },
      single: async () => {
        if (state.mode !== 'upsert') return { data: null, error: new Error('unsupported') };
        const rows = tables[tableName] || (tables[tableName] = []);
        const index = rows.findIndex((item) => item.owner_key === state.pending.owner_key);
        if (index >= 0) rows[index] = { ...rows[index], ...state.pending };
        else rows.push(state.pending);
        return { data: rows[index >= 0 ? index : rows.length - 1], error: null };
      },
    };
    return builder;
  }
  return { from, tables };
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

test('WHOOP day formatting follows Europe/Amsterdam around daylight saving time', () => {
  assert.equal(formatDay(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
  assert.equal(formatDay(new Date('2026-10-25T22:30:00Z')), '2026-10-25');
});

test('Google health sheet service replaces the five managed data ranges', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) {
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

  const statusHandlers = routes.get.get('/api/health/whoop/status');
  assert.equal(statusHandlers[0], requireAdmin);
  const status = createResponseRecorder();
  await statusHandlers[1]({}, status);
  assert.equal(status.body.connected, true);
});

test('WHOOP cron runs at both UTC hours that can represent 08:00 Europe/Amsterdam', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  assert.ok(vercelConfig.crons.some((cron) =>
    cron.path === '/api/health/whoop/daily-sync' && cron.schedule === '0 6,7 * * *'
  ));
});

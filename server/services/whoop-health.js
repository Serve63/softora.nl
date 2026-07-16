const crypto = require('crypto');

const OWNER_KEY = 'serve';
const TIMEZONE = 'Europe/Amsterdam';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_SCOPES = [
  'offline', 'read:cycles', 'read:recovery', 'read:sleep', 'read:workout', 'read:profile',
  'read:body_measurement',
];

function formatDay(date, timezone = TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function addDays(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function createWhoopHealthService(deps = {}) {
  const config = deps.config || {};
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const getSupabaseClient = deps.getSupabaseClient || (() => null);
  const sheetService = deps.sheetService || { isConfigured: () => false, getSpreadsheetUrl: () => '', syncSnapshot: async () => ({ skipped: true }) };
  const now = deps.now || (() => new Date());
  const clientId = String(config.clientId || '').trim();
  const clientSecret = String(config.clientSecret || '').trim();
  const redirectUri = String(config.redirectUri || '').trim();
  const timezone = String(config.timezone || TIMEZONE).trim() || TIMEZONE;
  const encryptionSecret = String(config.tokenEncryptionKey || '').trim();

  function db() {
    const client = getSupabaseClient({ timeoutMs: 20000, ignoreFailureCooldown: true });
    if (!client) throw new Error('Supabase is niet geconfigureerd voor het gezondheidsdossier.');
    return client;
  }

  function encryptionKey() {
    const key = /^[a-f0-9]{64}$/i.test(encryptionSecret)
      ? Buffer.from(encryptionSecret, 'hex')
      : Buffer.from(encryptionSecret, 'base64');
    if (key.length !== 32) throw new Error('WHOOP_TOKEN_ENCRYPTION_KEY moet exact 32 bytes zijn.');
    return key;
  }

  function encryptTokens(tokens) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  function decryptTokens(value) {
    const [version, iv, tag, ciphertext] = String(value || '').split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('WHOOP-tokens ontbreken of zijn ongeldig.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final(),
    ]).toString('utf8'));
  }

  async function getConnection() {
    const { data, error } = await db().from('softora_health_whoop_connections').select('*').eq('owner_key', OWNER_KEY).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function patchConnection(values) {
    const { data, error } = await db().from('softora_health_whoop_connections').upsert({
      owner_key: OWNER_KEY, ...values, updated_at: now().toISOString(),
    }, { onConflict: 'owner_key' }).select('*').single();
    if (error) throw error;
    return data;
  }

  async function exchangeToken(payload) {
    const response = await fetchImpl(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `WHOOP tokenfout (${response.status})`);
    return data;
  }

  function normalizeTokens(data, previous = {}) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || previous.refresh_token,
      expires_at: Date.now() + Math.max(300, Number(data.expires_in || 3600)) * 1000,
      scope: data.scope || previous.scope || WHOOP_SCOPES.join(' '),
    };
  }

  async function validAccessToken(connection) {
    const tokens = decryptTokens(connection.encrypted_tokens);
    if (Number(tokens.expires_at || 0) > Date.now() + 120000) return tokens.access_token;
    const refreshed = await exchangeToken({
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId,
      client_secret: clientSecret, scope: 'offline',
    });
    const next = normalizeTokens(refreshed, tokens);
    await patchConnection({ encrypted_tokens: encryptTokens(next), status: 'connected', last_sync_error: null });
    return next.access_token;
  }

  async function whoopRequest(path, token) {
    const response = await fetchImpl(`${WHOOP_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `WHOOP API-fout (${response.status})`);
    return data;
  }

  async function collection(path, token, range = null) {
    const records = [];
    let nextToken = '';
    do {
      const params = new URLSearchParams({ limit: '25' });
      if (range?.start) params.set('start', range.start);
      if (range?.end) params.set('end', range.end);
      if (nextToken) params.set('nextToken', nextToken);
      const data = await whoopRequest(`${path}?${params}`, token);
      records.push(...(Array.isArray(data.records) ? data.records : []));
      nextToken = String(data.next_token || '');
    } while (nextToken);
    return records;
  }

  function localDayFor(type, item) {
    const raw = type === 'sleep' ? (item.end || item.start) : (item.start || item.created_at);
    const date = new Date(raw || 0);
    return Number.isNaN(date.getTime()) ? formatDay(now(), timezone) : formatDay(date, timezone);
  }

  function mapRecord(type, item) {
    const score = item.score && typeof item.score === 'object' ? item.score : {};
    const sourceId = type === 'recovery' ? item.cycle_id : item.id;
    const summary = type === 'cycle' ? score
      : type === 'recovery' ? score
        : type === 'sleep' ? { nap: Boolean(item.nap), ...score }
          : { sport_id: item.sport_id, sport_name: item.sport_name || '', ...score };
    return {
      owner_key: OWNER_KEY,
      whoop_user_id: Number(item.user_id || 0),
      source_type: type,
      source_id: String(sourceId),
      local_day: localDayFor(type, item),
      start_at: item.start || null,
      end_at: item.end || null,
      score_state: item.score_state || null,
      summary,
      raw: item,
      source_updated_at: item.updated_at || null,
      updated_at: now().toISOString(),
    };
  }

  async function createAuthorizationUrl() {
    if (!clientId || !clientSecret || !redirectUri || !encryptionSecret) throw new Error('WHOOP-koppeling is nog niet volledig geconfigureerd.');
    const state = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    await patchConnection({
      oauth_state_hash: crypto.createHash('sha256').update(state).digest('hex'),
      oauth_state_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: WHOOP_SCOPES.join(' '), state });
    return `${WHOOP_AUTH_URL}?${params}`;
  }

  async function completeAuthorization({ code, state }) {
    const connection = await getConnection();
    const stateHash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
    if (!connection?.oauth_state_hash || connection.oauth_state_hash !== stateHash || new Date(connection.oauth_state_expires_at).getTime() < Date.now()) {
      throw new Error('WHOOP OAuth-state is ongeldig of verlopen.');
    }
    const tokenData = await exchangeToken({
      grant_type: 'authorization_code', code: String(code || ''), client_id: clientId,
      client_secret: clientSecret, redirect_uri: redirectUri,
    });
    const tokens = normalizeTokens(tokenData);
    const profile = await whoopRequest('/user/profile/basic', tokens.access_token);
    const bodyMeasurement = await whoopRequest('/user/measurement/body', tokens.access_token);
    await patchConnection({
      whoop_user_id: Number(profile.user_id), status: 'connected', encrypted_tokens: encryptTokens(tokens),
      scopes: String(tokens.scope || '').split(/\s+/).filter(Boolean), profile,
      body_measurement: bodyMeasurement, connected_at: now().toISOString(), oauth_state_hash: null,
      oauth_state_expires_at: null, last_sync_error: null,
    });
    return { ok: true, userId: Number(profile.user_id) };
  }

  function yesterday() {
    return addDays(formatDay(now(), timezone), -1);
  }

  async function getSheetSnapshot() {
    const client = db();
    const [{ data: records, error: recordsError }, { data: runs, error: runsError }] = await Promise.all([
      client.from('softora_health_whoop_records').select('*').eq('owner_key', OWNER_KEY).order('local_day', { ascending: false }).limit(10000),
      client.from('softora_health_sync_runs').select('*').eq('owner_key', OWNER_KEY).order('started_at', { ascending: false }).limit(250),
    ]);
    if (recordsError) throw recordsError;
    if (runsError) throw runsError;
    return { records: records || [], runs: runs || [] };
  }

  async function sync(options = {}) {
    const mode = ['daily', 'backfill', 'manual'].includes(options.mode) ? options.mode : 'manual';
    const targetDay = String(options.targetDay || yesterday());
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now()));
    const connection = await getConnection();
    if (options.enforceSchedule && localHour !== 8) return { ok: true, skipped: true, reason: 'outside_local_08_hour' };
    if (!connection?.encrypted_tokens || connection.status !== 'connected') return { ok: true, skipped: true, reason: 'whoop_not_connected' };
    if (mode === 'daily' && connection.last_synced_day === targetDay && connection.last_sync_status === 'completed') {
      return { ok: true, skipped: true, reason: 'day_already_synced', targetDay };
    }
    const startedAt = now().toISOString();
    const { data: run, error: runError } = await db().from('softora_health_sync_runs').insert({ owner_key: OWNER_KEY, target_day: targetDay, mode, status: 'running', started_at: startedAt }).select('*').single();
    if (runError) throw runError;
    await patchConnection({ last_sync_started_at: startedAt, last_sync_status: 'running', last_sync_error: null });
    try {
      const token = await validAccessToken(connection);
      const range = mode === 'backfill' ? null : {
        start: new Date(`${addDays(targetDay, -1)}T00:00:00Z`).toISOString(),
        end: new Date(`${addDays(targetDay, 2)}T00:00:00Z`).toISOString(),
      };
      const batches = await Promise.all([
        collection('/cycle', token, range), collection('/recovery', token, range),
        collection('/activity/sleep', token, range), collection('/activity/workout', token, range),
      ]);
      let records = ['cycle', 'recovery', 'sleep', 'workout'].flatMap((type, index) => batches[index].map((item) => mapRecord(type, item)));
      if (mode !== 'backfill') records = records.filter((record) => record.local_day === targetDay);
      if (records.length) {
        const { error } = await db().from('softora_health_whoop_records').upsert(records, { onConflict: 'owner_key,source_type,source_id' });
        if (error) throw error;
      }
      const completedAt = now().toISOString();
      await db().from('softora_health_sync_runs').update({ status: 'completed', records_seen: records.length, records_upserted: records.length, completed_at: completedAt }).eq('id', run.id);
      let sheetResult = { ok: true, skipped: true };
      try {
        sheetResult = await sheetService.syncSnapshot(await getSheetSnapshot());
      } catch (sheetError) {
        sheetResult = { ok: false, error: String(sheetError.message || sheetError) };
      }
      const sheetStatus = sheetResult.ok === false ? 'failed' : (sheetResult.skipped ? 'skipped' : 'completed');
      await db().from('softora_health_sync_runs').update({ sheet_status: sheetStatus, error: sheetResult.error || null }).eq('id', run.id);
      await patchConnection({ last_sync_completed_at: completedAt, last_sync_status: 'completed', last_sync_error: sheetResult.error || null, last_synced_day: targetDay });
      return { ok: true, targetDay, records: records.length, sheet: sheetResult };
    } catch (error) {
      const message = String(error.message || error).slice(0, 1000);
      await db().from('softora_health_sync_runs').update({ status: 'failed', error: message, completed_at: now().toISOString() }).eq('id', run.id);
      await patchConnection({ last_sync_status: 'failed', last_sync_error: message });
      throw error;
    }
  }

  async function getStatus() {
    const connection = await getConnection();
    return {
      configured: Boolean(clientId && clientSecret && redirectUri && encryptionSecret),
      connected: Boolean(connection?.status === 'connected' && connection.encrypted_tokens),
      profile: connection?.profile || {}, bodyMeasurement: connection?.body_measurement || {},
      lastSyncStartedAt: connection?.last_sync_started_at || null,
      lastSyncCompletedAt: connection?.last_sync_completed_at || null,
      lastSyncStatus: connection?.last_sync_status || '', lastSyncError: connection?.last_sync_error || '',
      lastSyncedDay: connection?.last_synced_day || null, spreadsheetUrl: sheetService.getSpreadsheetUrl(),
    };
  }

  async function getDashboard(days = 90) {
    const fromDay = addDays(formatDay(now(), timezone), -Math.max(7, Math.min(730, Number(days) || 90)));
    const { data, error } = await db().from('softora_health_whoop_records').select('*').eq('owner_key', OWNER_KEY).gte('local_day', fromDay).order('local_day', { ascending: false }).limit(5000);
    if (error) throw error;
    return { records: data || [], fromDay, timezone };
  }

  return { completeAuthorization, createAuthorizationUrl, getDashboard, getStatus, sync };
}

module.exports = { addDays, createWhoopHealthService, formatDay };

const crypto = require('crypto');

const OWNER_KEY = 'serve';
const TIMEZONE = 'Europe/Amsterdam';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_WEBHOOK_TABLE = 'softora_health_whoop_webhook_events';
const TOKEN_REQUEST_TIMEOUT_MS = 15000;
const API_REQUEST_TIMEOUT_MS = 20000;
const TOKEN_REFRESH_LOCK_MS = 60000;
const SYNC_LOCK_MS = 15 * 60 * 1000;
const WEBHOOK_CLAIM_MS = 15 * 60 * 1000;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  function tokenError(message, status, transient, providerCode = '', outcomeUnknown = false) {
    const error = new Error(message);
    error.code = 'WHOOP_TOKEN_ERROR';
    error.status = Number(status || 0);
    error.transient = Boolean(transient);
    error.providerCode = String(providerCode || '');
    error.outcomeUnknown = Boolean(outcomeUnknown);
    return error;
  }

  function isTransientTokenStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  function isPermanentRefreshTokenError(error) {
    if (String(error?.providerCode || '').toLowerCase() === 'invalid_grant') return true;
    return /refresh[_ -]?token[^.]{0,80}(invalid|revoked|expired)|invalid[^.]{0,40}refresh[_ -]?token/i
      .test(String(error?.message || ''));
  }

  async function exchangeToken(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);
    let response;
    let data;
    try {
      response = await fetchImpl(WHOOP_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(payload),
        signal: controller.signal,
      });
      data = await response.json().catch(() => ({}));
    } catch (networkError) {
      throw tokenError(
        `WHOOP tokennetwerkfout: ${String(networkError.message || networkError)}`,
        0,
        true,
        '',
        true
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok && data.access_token) return data;
    const status = Number(response.status || 0);
    const providerCode = String(data.error || data.code || '');
    throw tokenError(
      String(data.error_description || data.error || data.message || `WHOOP tokenfout (${status || 'onbekend'})`),
      status,
      isTransientTokenStatus(status),
      providerCode,
      status === 408 || status >= 500
    );
  }

  function normalizeTokens(data, previous = {}) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || previous.refresh_token,
      expires_at: Date.now() + Math.max(300, Number(data.expires_in || 3600)) * 1000,
      scope: data.scope || previous.scope || WHOOP_SCOPES.join(' '),
    };
  }

  async function claimTokenRefreshLock() {
    const lockId = crypto.randomUUID();
    const lockStarted = now();
    const lockUntil = new Date(lockStarted.getTime() + TOKEN_REFRESH_LOCK_MS).toISOString();
    const nowIso = lockStarted.toISOString();
    const { data, error } = await db()
      .from('softora_health_whoop_connections')
      .update({
        token_refresh_lock_id: lockId,
        token_refresh_lock_until: lockUntil,
        updated_at: nowIso,
      })
      .eq('owner_key', OWNER_KEY)
      .eq('status', 'connected')
      .or(`token_refresh_lock_until.is.null,token_refresh_lock_until.lt.${nowIso}`)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? { lockId, connection: data } : null;
  }

  async function releaseTokenRefreshLock(lockId) {
    if (!lockId) return;
    const { error } = await db()
      .from('softora_health_whoop_connections')
      .update({
        token_refresh_lock_id: null,
        token_refresh_lock_until: null,
        updated_at: now().toISOString(),
      })
      .eq('owner_key', OWNER_KEY)
      .eq('token_refresh_lock_id', lockId);
    if (error) console.warn('[WHOOP] token refresh lock vrijgeven mislukt:', error.message || error);
  }

  async function waitForPeerRefresh(previousEncryptedTokens) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(250);
      const fresh = await getConnection();
      if (fresh?.status === 'reauthorization_required') {
        const error = new Error(fresh.last_sync_error || 'WHOOP moet opnieuw worden gekoppeld.');
        error.code = 'WHOOP_REAUTHORIZATION_REQUIRED';
        throw error;
      }
      if (fresh?.status === 'refresh_uncertain') {
        const error = new Error(fresh.last_sync_error || 'WHOOP-tokenvernieuwing kon niet veilig worden bevestigd.');
        error.code = 'WHOOP_REFRESH_OUTCOME_UNKNOWN';
        throw error;
      }
      if (!fresh?.encrypted_tokens) continue;
      if (fresh.encrypted_tokens !== previousEncryptedTokens) {
        const tokens = decryptTokens(fresh.encrypted_tokens);
        if (Number(tokens.expires_at || 0) > Date.now() + 30000) return tokens.access_token;
      }
      const lockUntil = new Date(fresh.token_refresh_lock_until || 0).getTime();
      if (!Number.isFinite(lockUntil) || lockUntil <= Date.now()) break;
    }
    const error = new Error('WHOOP-tokenvernieuwing is nog bezig; probeer de sync zo opnieuw.');
    error.code = 'WHOOP_REFRESH_BUSY';
    throw error;
  }

  async function updateWhileTokenRefreshLocked(lockId, values) {
    const { data, error } = await db()
      .from('softora_health_whoop_connections')
      .update({ ...values, updated_at: now().toISOString() })
      .eq('owner_key', OWNER_KEY)
      .eq('token_refresh_lock_id', lockId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const lockError = new Error('WHOOP-tokenlock verliep voordat de refresh veilig kon worden opgeslagen.');
      lockError.code = 'WHOOP_REFRESH_FENCE_LOST';
      throw lockError;
    }
    return data;
  }

  async function validAccessToken(connection) {
    const initialTokens = decryptTokens(connection.encrypted_tokens);
    if (Number(initialTokens.expires_at || 0) > Date.now() + 120000) return initialTokens.access_token;

    const lock = await claimTokenRefreshLock();
    if (!lock) return waitForPeerRefresh(connection.encrypted_tokens);

    try {
      const lockedConnection = lock.connection || await getConnection();
      const lockedTokens = decryptTokens(lockedConnection.encrypted_tokens);
      if (Number(lockedTokens.expires_at || 0) > Date.now() + 120000) return lockedTokens.access_token;

      let refreshed;
      try {
        refreshed = await exchangeToken({
          grant_type: 'refresh_token',
          refresh_token: lockedTokens.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'offline',
        });
      } catch (error) {
        if (error?.code === 'WHOOP_TOKEN_ERROR' && isPermanentRefreshTokenError(error)) {
          await updateWhileTokenRefreshLocked(lock.lockId, {
            status: 'reauthorization_required',
            last_sync_error: String(error.message || error).slice(0, 1000),
          });
        } else if (error?.code === 'WHOOP_TOKEN_ERROR' && error.outcomeUnknown) {
          await updateWhileTokenRefreshLocked(lock.lockId, {
            status: 'refresh_uncertain',
            last_sync_error: String(error.message || error).slice(0, 1000),
          });
        }
        throw error;
      }

      const next = normalizeTokens(refreshed, lockedTokens);
      await updateWhileTokenRefreshLocked(lock.lockId, {
        encrypted_tokens: encryptTokens(next),
        status: 'connected',
        last_sync_error: null,
      });
      return next.access_token;
    } finally {
      await releaseTokenRefreshLock(lock.lockId);
    }
  }

  async function whoopRequest(path, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    let response;
    let data;
    try {
      response = await fetchImpl(`${WHOOP_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      throw new Error(`WHOOP API-netwerkfout: ${String(error.message || error)}`);
    } finally {
      clearTimeout(timeout);
    }
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

  function today() {
    return formatDay(now(), timezone);
  }

  function localHour() {
    return Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', hour12: false,
    }).format(now()));
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

  async function enqueueInternalBackfill(userId) {
    const traceId = `internal-backfill-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const { error } = await db().from(WHOOP_WEBHOOK_TABLE).upsert({
      trace_id: traceId,
      whoop_user_id: Number(userId || 0),
      resource_id: '',
      event_type: 'internal.backfill',
      status: 'pending',
      attempts: 0,
      next_attempt_at: now().toISOString(),
      received_at: now().toISOString(),
    }, { onConflict: 'trace_id', ignoreDuplicates: true });
    if (error) throw error;
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
    await patchConnection({
      status: 'connected', encrypted_tokens: encryptTokens(tokens),
      scopes: String(tokens.scope || '').split(/\s+/).filter(Boolean),
      connected_at: now().toISOString(), oauth_state_hash: null,
      oauth_state_expires_at: null, last_sync_error: null,
      token_refresh_lock_id: null, token_refresh_lock_until: null,
      sync_lock_id: null, sync_lock_until: null,
    });

    let profile = connection.profile || {};
    let bodyMeasurement = connection.body_measurement || {};
    let metadataError = '';
    try {
      [profile, bodyMeasurement] = await Promise.all([
        whoopRequest('/user/profile/basic', tokens.access_token),
        whoopRequest('/user/measurement/body', tokens.access_token),
      ]);
    } catch (error) {
      metadataError = `WHOOP opnieuw gekoppeld; profielmetadata wordt later bijgewerkt: ${String(error.message || error)}`
        .slice(0, 1000);
    }
    const userId = Number(profile.user_id || connection.whoop_user_id || 0);
    await patchConnection({
      whoop_user_id: userId,
      profile,
      body_measurement: bodyMeasurement,
      last_sync_error: metadataError || null,
    });
    await enqueueInternalBackfill(userId);
    return { ok: true, userId, profilePending: Boolean(metadataError) };
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

  async function hasScoredRecoveryForDay(targetDay) {
    const { data, error } = await db()
      .from('softora_health_whoop_records')
      .select('source_id')
      .eq('owner_key', OWNER_KEY)
      .eq('source_type', 'recovery')
      .eq('local_day', targetDay)
      .eq('score_state', 'SCORED')
      .limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async function claimSyncLock() {
    const lockId = crypto.randomUUID();
    const lockStarted = now();
    const nowIso = lockStarted.toISOString();
    const lockUntil = new Date(lockStarted.getTime() + SYNC_LOCK_MS).toISOString();
    const { data, error } = await db()
      .from('softora_health_whoop_connections')
      .update({ sync_lock_id: lockId, sync_lock_until: lockUntil, updated_at: nowIso })
      .eq('owner_key', OWNER_KEY)
      .eq('status', 'connected')
      .or(`sync_lock_until.is.null,sync_lock_until.lt.${nowIso}`)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? { lockId, connection: data } : null;
  }

  async function releaseSyncLock(lockId) {
    if (!lockId) return;
    const { error } = await db()
      .from('softora_health_whoop_connections')
      .update({ sync_lock_id: null, sync_lock_until: null, updated_at: now().toISOString() })
      .eq('owner_key', OWNER_KEY)
      .eq('sync_lock_id', lockId);
    if (error) console.warn('[WHOOP] sync-lock vrijgeven mislukt:', error.message || error);
  }

  async function updateSyncRun(runId, values) {
    const { error } = await db().from('softora_health_sync_runs').update(values).eq('id', runId);
    if (error) throw error;
  }

  async function sync(options = {}) {
    const mode = ['daily', 'backfill', 'manual', 'webhook', 'reconcile'].includes(options.mode) ? options.mode : 'manual';
    const targetDay = String(options.targetDay || today());
    const connection = await getConnection();
    if (!connection?.encrypted_tokens || connection.status !== 'connected') {
      return {
        ok: true,
        skipped: true,
        reason: connection?.status === 'reauthorization_required'
          ? 'whoop_reauthorization_required'
          : (connection?.status === 'refresh_uncertain'
              ? 'whoop_refresh_outcome_unknown'
              : 'whoop_not_connected'),
      };
    }

    const syncLock = await claimSyncLock();
    if (!syncLock) return { ok: true, skipped: true, reason: 'sync_in_progress', targetDay };

    let run = null;
    try {
      const startedAt = now().toISOString();
      const { data: insertedRun, error: runError } = await db().from('softora_health_sync_runs').insert({
        owner_key: OWNER_KEY, target_day: targetDay, mode, status: 'running', started_at: startedAt,
      }).select('*').single();
      if (runError) throw runError;
      run = insertedRun;
      await patchConnection({ last_sync_started_at: startedAt, last_sync_status: 'running', last_sync_error: null });

      const lockedConnection = syncLock.connection || connection;
      const token = await validAccessToken(lockedConnection);
      const backfillStartDay = String(
        options.startDay || (lockedConnection.last_synced_day
          ? addDays(String(lockedConnection.last_synced_day), 1)
          : addDays(targetDay, -89))
      );
      const range = mode === 'backfill'
        ? {
            start: new Date(`${backfillStartDay}T00:00:00Z`).toISOString(),
            end: new Date(`${addDays(targetDay, 2)}T00:00:00Z`).toISOString(),
          }
        : {
            start: new Date(`${addDays(targetDay, -1)}T00:00:00Z`).toISOString(),
            end: new Date(`${addDays(targetDay, 2)}T00:00:00Z`).toISOString(),
          };
      const batches = await Promise.all([
        collection('/cycle', token, range), collection('/recovery', token, range),
        collection('/activity/sleep', token, range), collection('/activity/workout', token, range),
      ]);
      let records = ['cycle', 'recovery', 'sleep', 'workout'].flatMap((type, index) => batches[index].map((item) => mapRecord(type, item)));
      records = mode === 'backfill'
        ? records.filter((record) => record.local_day >= backfillStartDay && record.local_day <= targetDay)
        : records.filter((record) => record.local_day === targetDay);
      if (records.length) {
        const { error } = await db().from('softora_health_whoop_records').upsert(records, { onConflict: 'owner_key,source_type,source_id' });
        if (error) throw error;
      }
      const completedAt = now().toISOString();
      await updateSyncRun(run.id, {
        status: 'completed', records_seen: records.length, records_upserted: records.length, completed_at: completedAt,
      });
      let sheetResult = { ok: true, skipped: true };
      try {
        sheetResult = await sheetService.syncSnapshot(await getSheetSnapshot());
      } catch (sheetError) {
        sheetResult = { ok: false, error: String(sheetError.message || sheetError) };
      }
      const sheetStatus = sheetResult.ok === false ? 'failed' : (sheetResult.skipped ? 'skipped' : 'completed');
      await updateSyncRun(run.id, {
        sheet_status: sheetStatus, error: sheetResult.error || null,
      });
      const syncedRecord = records.find((record) => Number(record.whoop_user_id || 0) > 0);
      await patchConnection({
        last_sync_completed_at: completedAt,
        last_sync_status: 'completed',
        last_sync_error: sheetResult.error || null,
        last_synced_day: targetDay,
        ...(syncedRecord
          ? { whoop_user_id: Number(syncedRecord.whoop_user_id) }
          : {}),
      });
      return { ok: true, targetDay, records: records.length, sheet: sheetResult };
    } catch (error) {
      const message = String(error.message || error).slice(0, 1000);
      if (run?.id) {
        try {
          await updateSyncRun(run.id, { status: 'failed', error: message, completed_at: now().toISOString() });
        } catch (runError) {
          console.error('[WHOOP] mislukte sync-run kon niet als failed worden opgeslagen:', runError.message || runError);
        }
      }
      try {
        await patchConnection({ last_sync_status: 'failed', last_sync_error: message });
      } catch (connectionError) {
        console.error('[WHOOP] mislukte syncstatus kon niet worden opgeslagen:', connectionError.message || connectionError);
      }
      throw error;
    } finally {
      await releaseSyncLock(syncLock.lockId);
    }
  }

  async function reconcileToday(options = {}) {
    const hour = localHour();
    if (options.enforceSchedule && (hour < 5 || hour >= 12)) {
      return { ok: true, skipped: true, reason: 'outside_local_morning_window' };
    }
    const targetDay = today();
    if (await hasScoredRecoveryForDay(targetDay)) {
      return { ok: true, skipped: true, reason: 'today_recovery_already_synced', targetDay };
    }
    return sync({ mode: 'reconcile', targetDay });
  }

  async function syncTodayFallback(options = {}) {
    const hour = localHour();
    if (options.enforceSchedule && hour !== 12) {
      return { ok: true, skipped: true, reason: 'outside_local_12_hour' };
    }
    return sync({ mode: 'daily', targetDay: today() });
  }

  function safeEqualText(left, right) {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function verifyWebhookSignature({ rawBody, signature, timestamp }) {
    if (!clientSecret || !signature || !timestamp || !Buffer.isBuffer(rawBody)) return false;
    const expected = crypto
      .createHmac('sha256', clientSecret)
      .update(Buffer.concat([Buffer.from(String(timestamp), 'utf8'), rawBody]))
      .digest('base64');
    return safeEqualText(expected, signature);
  }

  async function acceptWebhook({ rawBody, signature, timestamp, payload }) {
    if (!verifyWebhookSignature({ rawBody, signature, timestamp })) {
      const error = new Error('Ongeldige WHOOP-webhookhandtekening.');
      error.code = 'WHOOP_WEBHOOK_SIGNATURE_INVALID';
      throw error;
    }
    const eventType = String(payload?.type || '');
    const traceId = String(payload?.trace_id || '');
    const resourceId = String(payload?.id || '');
    const userId = Number(payload?.user_id || 0);
    if (!traceId || !eventType || !userId) {
      const error = new Error('WHOOP-webhookpayload is onvolledig.');
      error.code = 'WHOOP_WEBHOOK_PAYLOAD_INVALID';
      throw error;
    }

    const connection = await getConnection();
    if (connection?.whoop_user_id && Number(connection.whoop_user_id) !== userId) {
      return { ok: true, accepted: false, ignored: true, reason: 'different_user' };
    }
    if (eventType !== 'recovery.updated') {
      return { ok: true, accepted: false, ignored: true, reason: 'event_not_needed' };
    }

    const { error } = await db().from(WHOOP_WEBHOOK_TABLE).upsert({
      trace_id: traceId,
      whoop_user_id: userId,
      resource_id: resourceId,
      event_type: eventType,
      status: 'pending',
      attempts: 0,
      next_attempt_at: now().toISOString(),
      received_at: now().toISOString(),
    }, { onConflict: 'trace_id', ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true, accepted: true, traceId };
  }

  async function claimWebhookEvent(event) {
    const claimedAt = now();
    const previousAttempts = Number(event.attempts || 0);
    const attempts = previousAttempts + 1;
    const { data, error } = await db()
      .from(WHOOP_WEBHOOK_TABLE)
      .update({
        status: 'processing',
        attempts,
        next_attempt_at: new Date(claimedAt.getTime() + WEBHOOK_CLAIM_MS).toISOString(),
        last_error: null,
      })
      .eq('trace_id', event.trace_id)
      .eq('attempts', previousAttempts)
      .in('status', ['pending', 'retry', 'processing'])
      .lte('next_attempt_at', claimedAt.toISOString())
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function updateClaimedWebhookEvent(event, values) {
    const { error } = await db()
      .from(WHOOP_WEBHOOK_TABLE)
      .update(values)
      .eq('trace_id', event.trace_id)
      .eq('status', 'processing')
      .eq('attempts', event.attempts);
    if (error) throw error;
  }

  async function processWebhookQueue(options = {}) {
    const limit = Math.max(1, Math.min(20, Number(options.limit || 5) || 5));
    const { data: events, error } = await db()
      .from(WHOOP_WEBHOOK_TABLE)
      .select('*')
      .in('status', ['pending', 'retry', 'processing'])
      .lte('next_attempt_at', now().toISOString())
      .order('received_at', { ascending: true })
      .limit(limit);
    if (error) throw error;

    const results = [];
    for (const candidate of events || []) {
      const event = await claimWebhookEvent(candidate);
      if (!event) continue;
      const attempts = Number(event.attempts || 0);
      try {
        const result = event.event_type === 'internal.backfill'
          ? await sync({ mode: 'backfill', targetDay: today() })
          : await sync({ mode: 'webhook', targetDay: today() });
        if (result?.skipped) {
          throw new Error(result.reason);
        }
        await updateClaimedWebhookEvent(event, {
          status: 'processed',
          processed_at: now().toISOString(),
          last_error: null,
        });
        results.push({ traceId: event.trace_id, ok: true, result });
      } catch (queueError) {
        const message = String(queueError.message || queueError).slice(0, 1000);
        const terminal = attempts >= 8 || [
          'whoop_not_connected',
          'whoop_reauthorization_required',
          'whoop_refresh_outcome_unknown',
        ].includes(message);
        const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1)));
        await updateClaimedWebhookEvent(event, {
          status: terminal ? 'dead' : 'retry',
          next_attempt_at: new Date(now().getTime() + delaySeconds * 1000).toISOString(),
          last_error: message,
        });
        results.push({ traceId: event.trace_id, ok: false, error: message });
      }
    }
    return { ok: true, processed: results.length, results };
  }

  async function getStatus() {
    const connection = await getConnection();
    return {
      configured: Boolean(clientId && clientSecret && redirectUri && encryptionSecret),
      connected: Boolean(connection?.status === 'connected' && connection.encrypted_tokens),
      connectionStatus: connection?.status || 'disconnected',
      needsReauthorization: ['reauthorization_required', 'refresh_uncertain'].includes(connection?.status),
      reauthorizationReason: connection?.status === 'refresh_uncertain'
        ? 'refresh_outcome_unknown'
        : (connection?.status === 'reauthorization_required' ? 'refresh_token_rejected' : ''),
      profile: connection?.profile || {}, bodyMeasurement: connection?.body_measurement || {},
      lastSyncStartedAt: connection?.last_sync_started_at || null,
      lastSyncCompletedAt: connection?.last_sync_completed_at || null,
      lastSyncStatus: connection?.last_sync_status || '', lastSyncError: connection?.last_sync_error || '',
      lastSyncedDay: connection?.last_synced_day || null, spreadsheetUrl: sheetService.getSpreadsheetUrl(),
      deliveryMode: 'recovery_webhook_with_morning_reconciliation_and_noon_fallback',
    };
  }

  async function getDashboard(days = 90) {
    const fromDay = addDays(formatDay(now(), timezone), -Math.max(7, Math.min(730, Number(days) || 90)));
    const { data, error } = await db().from('softora_health_whoop_records').select('*').eq('owner_key', OWNER_KEY).gte('local_day', fromDay).order('local_day', { ascending: false }).limit(5000);
    if (error) throw error;
    return { records: data || [], fromDay, timezone };
  }

  return {
    acceptWebhook,
    completeAuthorization,
    createAuthorizationUrl,
    getDashboard,
    getStatus,
    processWebhookQueue,
    reconcileToday,
    sync,
    syncTodayFallback,
    verifyWebhookSignature,
  };
}

module.exports = { addDays, createWhoopHealthService, formatDay };

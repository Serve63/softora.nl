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
const TOKEN_REFRESH_LOCK_MS = 15000;
const TOKEN_REFRESH_WAIT_MS = 6000;
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeTimingEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWhoopWebhookSignature({ rawBody, signature, timestamp, clientSecret, nowMs = Date.now() }) {
  const rawTimestamp = String(timestamp || '').trim();
  const rawSignature = String(signature || '').trim();
  const secret = String(clientSecret || '').trim();
  const timestampMs = Number(rawTimestamp);
  if (!secret || !rawSignature || !rawTimestamp || !Number.isFinite(timestampMs)) return false;
  if (Math.abs(Number(nowMs) - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(rawTimestamp, 'utf8'), body]))
    .digest('base64');
  return safeTimingEqual(expected, rawSignature);
}

class WhoopHttpError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'WhoopHttpError';
    this.status = Number(status || 0);
    this.data = data || null;
  }
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

  function today() {
    return formatDay(now(), timezone);
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

  async function releaseTokenRefreshLock(lockId) {
    if (!lockId) return;
    const { error } = await db().from('softora_health_whoop_connections').update({
      token_refresh_lock_id: null,
      token_refresh_lock_until: null,
      updated_at: now().toISOString(),
    }).eq('owner_key', OWNER_KEY).eq('token_refresh_lock_id', lockId);
    if (error) throw error;
  }

  async function tryAcquireTokenRefreshLock() {
    const lockId = crypto.randomUUID();
    const nowIso = now().toISOString();
    const lockUntil = new Date(now().getTime() + TOKEN_REFRESH_LOCK_MS).toISOString();
    const values = { token_refresh_lock_id: lockId, token_refresh_lock_until: lockUntil, updated_at: nowIso };

    let result = await db().from('softora_health_whoop_connections').update(values)
      .eq('owner_key', OWNER_KEY).is('token_refresh_lock_until', null).select('*').maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return { lockId, connection: result.data };

    result = await db().from('softora_health_whoop_connections').update(values)
      .eq('owner_key', OWNER_KEY).lte('token_refresh_lock_until', nowIso).select('*').maybeSingle();
    if (result.error) throw result.error;
    return result.data ? { lockId, connection: result.data } : null;
  }

  async function exchangeToken(payload) {
    let priorTransientError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(WHOOP_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams(payload),
        });
      } catch (error) {
        const wrapped = new WhoopHttpError(String(error.message || error), 0);
        if (attempt === 0) {
          priorTransientError = wrapped;
          await delay(500);
          continue;
        }
        throw wrapped;
      }
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.access_token) return data;
      const error = new WhoopHttpError(
        data.error_description || data.error || `WHOOP tokenfout (${response.status})`,
        response.status,
        data
      );
      const transient = response.status === 429 || response.status >= 500;
      if (attempt === 0 && transient) {
        priorTransientError = error;
        await delay(response.status === 429 ? 1000 : 500);
        continue;
      }
      if (priorTransientError && (response.status === 400 || response.status === 401)) {
        error.ambiguousRotation = true;
      }
      throw error;
    }
    throw priorTransientError || new WhoopHttpError('WHOOP tokenvernieuwing mislukt.');
  }

  function normalizeTokens(data, previous = {}) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || previous.refresh_token,
      expires_at: Date.now() + Math.max(300, Number(data.expires_in || 3600)) * 1000,
      scope: data.scope || previous.scope || WHOOP_SCOPES.join(' '),
    };
  }

  async function waitForConcurrentTokenRefresh(previousEncryptedTokens) {
    const deadline = Date.now() + TOKEN_REFRESH_WAIT_MS;
    while (Date.now() < deadline) {
      await delay(250);
      const fresh = await getConnection();
      if (!fresh?.encrypted_tokens) continue;
      if (fresh.encrypted_tokens !== previousEncryptedTokens) return fresh;
      const lockUntil = fresh.token_refresh_lock_until ? new Date(fresh.token_refresh_lock_until).getTime() : 0;
      if (!fresh.token_refresh_lock_id || lockUntil <= Date.now()) return fresh;
    }
    throw new WhoopHttpError('WHOOP tokenvernieuwing is nog bezig; verzoek wordt opnieuw geprobeerd.', 503);
  }

  async function validAccessToken(connection, depth = 0) {
    if (!connection?.encrypted_tokens) throw new Error('WHOOP-koppeling bevat geen tokens.');
    if (depth > 3) throw new WhoopHttpError('WHOOP tokenvernieuwing kon niet veilig worden afgerond.', 503);
    const tokens = decryptTokens(connection.encrypted_tokens);
    if (Number(tokens.expires_at || 0) > Date.now() + 120000) return tokens.access_token;

    const acquired = await tryAcquireTokenRefreshLock();
    if (!acquired) {
      const fresh = await waitForConcurrentTokenRefresh(connection.encrypted_tokens);
      return validAccessToken(fresh, depth + 1);
    }

    const lockId = acquired.lockId;
    const lockedConnection = acquired.connection || connection;
    try {
      const latestTokens = decryptTokens(lockedConnection.encrypted_tokens);
      if (Number(latestTokens.expires_at || 0) > Date.now() + 120000) {
        await releaseTokenRefreshLock(lockId);
        return latestTokens.access_token;
      }
      const refreshed = await exchangeToken({
        grant_type: 'refresh_token', refresh_token: latestTokens.refresh_token, client_id: clientId,
        client_secret: clientSecret, scope: 'offline',
      });
      const next = normalizeTokens(refreshed, latestTokens);
      await patchConnection({
        encrypted_tokens: encryptTokens(next),
        status: 'connected',
        last_sync_error: null,
        token_refresh_lock_id: null,
        token_refresh_lock_until: null,
      });
      return next.access_token;
    } catch (error) {
      await releaseTokenRefreshLock(lockId).catch(() => {});
      const status = Number(error?.status || 0);
      if (status === 400 || status === 401) {
        const fresh = await getConnection();
        if (fresh?.encrypted_tokens && fresh.encrypted_tokens !== lockedConnection.encrypted_tokens) {
          return validAccessToken(fresh, depth + 1);
        }
        await patchConnection({
          status: 'error',
          last_sync_status: 'failed',
          last_sync_error: error.ambiguousRotation
            ? 'WHOOP refresh-token is waarschijnlijk geroteerd tijdens een tijdelijke tokenserverfout; opnieuw koppelen is vereist.'
            : String(error.message || error).slice(0, 1000),
        });
      }
      throw error;
    }
  }

  async function whoopRequest(path, token) {
    const response = await fetchImpl(`${WHOOP_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new WhoopHttpError(data.message || data.error || `WHOOP API-fout (${response.status})`, response.status, data);
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
    return Number.isNaN(date.getTime()) ? today() : formatDay(date, timezone);
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

  async function writeRecords(records) {
    if (!records.length) return;
    const { error } = await db().from('softora_health_whoop_records').upsert(records, { onConflict: 'owner_key,source_type,source_id' });
    if (error) throw error;
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
      oauth_state_expires_at: null, last_sync_error: null, token_refresh_lock_id: null,
      token_refresh_lock_until: null,
    });
    await db().from('softora_health_whoop_webhook_events').update({
      status: 'pending', next_attempt_at: now().toISOString(), last_error: null,
    }).in('status', ['blocked', 'retry']);
    return { ok: true, userId: Number(profile.user_id) };
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

  async function syncSheet() {
    try {
      return await sheetService.syncSnapshot(await getSheetSnapshot());
    } catch (sheetError) {
      return { ok: false, error: String(sheetError.message || sheetError) };
    }
  }

  async function createSyncRun(targetDay, mode = 'manual') {
    const startedAt = now().toISOString();
    const { data: run, error } = await db().from('softora_health_sync_runs').insert({
      owner_key: OWNER_KEY, target_day: targetDay, mode, status: 'running', started_at: startedAt,
    }).select('*').single();
    if (error) throw error;
    await patchConnection({ last_sync_started_at: startedAt, last_sync_status: 'running', last_sync_error: null });
    return run;
  }

  async function finishSyncRun(run, { targetDay, records, sheetResult, advanceSyncedDay }) {
    const completedAt = now().toISOString();
    const sheetStatus = sheetResult.ok === false ? 'failed' : (sheetResult.skipped ? 'skipped' : 'completed');
    await db().from('softora_health_sync_runs').update({
      target_day: targetDay,
      status: 'completed',
      records_seen: records.length,
      records_upserted: records.length,
      completed_at: completedAt,
      sheet_status: sheetStatus,
      error: sheetResult.error || null,
    }).eq('id', run.id);
    const patch = {
      last_sync_completed_at: completedAt,
      last_sync_status: 'completed',
      last_sync_error: sheetResult.error || null,
    };
    if (advanceSyncedDay) patch.last_synced_day = targetDay;
    await patchConnection(patch);
    return completedAt;
  }

  async function failSyncRun(run, error) {
    const message = String(error.message || error).slice(0, 1000);
    await db().from('softora_health_sync_runs').update({
      status: 'failed', error: message, completed_at: now().toISOString(),
    }).eq('id', run.id);
    const connection = await getConnection().catch(() => null);
    await patchConnection({
      last_sync_status: 'failed',
      last_sync_error: message,
      status: connection?.status === 'error' ? 'error' : 'connected',
    }).catch(() => {});
  }

  async function sync(options = {}) {
    const mode = ['daily', 'backfill', 'manual'].includes(options.mode) ? options.mode : 'manual';
    const connection = await getConnection();
    const targetDay = String(options.targetDay || today());
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now()));
    const enforceScheduleHour = Number(options.enforceScheduleHour);
    if (Number.isFinite(enforceScheduleHour) && localHour !== enforceScheduleHour) {
      return { ok: true, skipped: true, reason: `outside_local_${enforceScheduleHour}_hour` };
    }
    if (!connection?.encrypted_tokens || connection.status !== 'connected') return { ok: true, skipped: true, reason: 'whoop_not_connected' };
    if (mode === 'daily' && connection.last_synced_day === targetDay && connection.last_sync_status === 'completed') {
      return { ok: true, skipped: true, reason: 'day_already_synced', targetDay };
    }

    const run = await createSyncRun(targetDay, mode);
    try {
      const token = await validAccessToken(connection);
      let range;
      let fromDay = targetDay;
      let toDay = targetDay;
      if (mode === 'backfill') {
        fromDay = String(options.fromDay || (connection.last_synced_day ? addDays(connection.last_synced_day, 1) : addDays(today(), -30)));
        toDay = String(options.toDay || today());
        range = {
          start: new Date(`${addDays(fromDay, -1)}T00:00:00Z`).toISOString(),
          end: new Date(`${addDays(toDay, 2)}T00:00:00Z`).toISOString(),
        };
      } else {
        range = {
          start: new Date(`${addDays(targetDay, -1)}T00:00:00Z`).toISOString(),
          end: new Date(`${addDays(targetDay, 2)}T00:00:00Z`).toISOString(),
        };
      }
      const batches = await Promise.all([
        collection('/cycle', token, range), collection('/recovery', token, range),
        collection('/activity/sleep', token, range), collection('/activity/workout', token, range),
      ]);
      let records = ['cycle', 'recovery', 'sleep', 'workout'].flatMap((type, index) => batches[index].map((item) => mapRecord(type, item)));
      if (mode === 'backfill') {
        records = records.filter((record) => record.local_day >= fromDay && record.local_day <= toDay);
      } else {
        records = records.filter((record) => record.local_day === targetDay);
      }
      await writeRecords(records);
      const sheetResult = await syncSheet();
      const finalTargetDay = mode === 'backfill' ? toDay : targetDay;
      await finishSyncRun(run, {
        targetDay: finalTargetDay,
        records,
        sheetResult,
        advanceSyncedDay: true,
      });
      return { ok: true, targetDay: finalTargetDay, records: records.length, sheet: sheetResult };
    } catch (error) {
      await failSyncRun(run, error);
      throw error;
    }
  }

  async function syncRecoveryEvent(event = {}) {
    const connection = await getConnection();
    if (!connection?.encrypted_tokens || connection.status !== 'connected') {
      throw new Error('WHOOP-koppeling moet opnieuw worden geautoriseerd.');
    }
    if (Number(event.user_id || 0) !== Number(connection.whoop_user_id || 0)) {
      throw new Error('WHOOP-webhook hoort niet bij de gekoppelde gebruiker.');
    }
    const run = await createSyncRun(today(), 'manual');
    try {
      const token = await validAccessToken(connection);
      const sleepId = String(event.id || '').trim();
      if (!sleepId) throw new Error('WHOOP-webhook bevat geen sleep-id.');
      const sleep = await whoopRequest(`/activity/sleep/${encodeURIComponent(sleepId)}`, token);
      const cycleId = Number(sleep.cycle_id || 0);
      if (!cycleId) throw new Error('WHOOP-slaap heeft geen cycle-id.');
      const [recovery, cycle] = await Promise.all([
        whoopRequest(`/cycle/${cycleId}/recovery`, token),
        whoopRequest(`/cycle/${cycleId}`, token),
      ]);
      const records = [
        mapRecord('cycle', cycle),
        mapRecord('recovery', recovery),
        mapRecord('sleep', sleep),
      ];
      await writeRecords(records);
      const targetDay = localDayFor('recovery', recovery);
      const sheetResult = await syncSheet();
      await finishSyncRun(run, { targetDay, records, sheetResult, advanceSyncedDay: false });
      return { ok: true, targetDay, records: records.length, sheet: sheetResult };
    } catch (error) {
      await failSyncRun(run, error);
      throw error;
    }
  }

  function verifyWebhookRequest({ rawBody, signature, timestamp }) {
    return verifyWhoopWebhookSignature({
      rawBody,
      signature,
      timestamp,
      clientSecret,
      nowMs: now().getTime(),
    });
  }

  async function enqueueWebhookEvent(event = {}) {
    const type = String(event.type || '').trim();
    if (type !== 'recovery.updated') return { ok: true, ignored: true, type };
    const traceId = String(event.trace_id || '').trim();
    const resourceId = String(event.id || '').trim();
    const whoopUserId = Number(event.user_id || 0);
    if (!traceId || !resourceId || !whoopUserId) throw new Error('WHOOP-webhook is onvolledig.');
    const connection = await getConnection();
    if (!connection?.whoop_user_id || Number(connection.whoop_user_id) !== whoopUserId) {
      throw new Error('WHOOP-webhook hoort niet bij de gekoppelde gebruiker.');
    }
    const receivedAt = now().toISOString();
    const { error } = await db().from('softora_health_whoop_webhook_events').insert({
      trace_id: traceId,
      whoop_user_id: whoopUserId,
      resource_id: resourceId,
      event_type: type,
      status: 'pending',
      attempts: 0,
      next_attempt_at: receivedAt,
      received_at: receivedAt,
    });
    if (error && String(error.code || '') !== '23505') throw error;
    return { ok: true, duplicate: Boolean(error), traceId };
  }

  async function processWebhookEvents(limit = 5) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
    const { data: rows, error } = await db().from('softora_health_whoop_webhook_events')
      .select('*')
      .in('status', ['pending', 'retry'])
      .lte('next_attempt_at', now().toISOString())
      .order('received_at', { ascending: true })
      .limit(safeLimit);
    if (error) throw error;
    let processed = 0;
    let failed = 0;
    for (const row of rows || []) {
      const attempts = Number(row.attempts || 0) + 1;
      const { data: claimed, error: claimError } = await db().from('softora_health_whoop_webhook_events')
        .update({ status: 'processing', attempts })
        .eq('trace_id', row.trace_id)
        .in('status', ['pending', 'retry'])
        .select('*')
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;
      try {
        await syncRecoveryEvent({
          trace_id: claimed.trace_id,
          user_id: claimed.whoop_user_id,
          id: claimed.resource_id,
          type: claimed.event_type,
        });
        await db().from('softora_health_whoop_webhook_events').update({
          status: 'completed', processed_at: now().toISOString(), last_error: null,
        }).eq('trace_id', claimed.trace_id);
        processed += 1;
      } catch (eventError) {
        const connection = await getConnection().catch(() => null);
        const blocked = connection?.status === 'error';
        const retryMinutes = Math.min(60, 2 ** Math.min(attempts, 5));
        await db().from('softora_health_whoop_webhook_events').update({
          status: blocked ? 'blocked' : 'retry',
          next_attempt_at: new Date(now().getTime() + retryMinutes * 60 * 1000).toISOString(),
          last_error: String(eventError.message || eventError).slice(0, 1000),
        }).eq('trace_id', claimed.trace_id);
        failed += 1;
      }
    }
    return { ok: true, processed, failed, seen: (rows || []).length };
  }

  async function repairGap() {
    const connection = await getConnection();
    if (!connection?.encrypted_tokens || connection.status !== 'connected') {
      return { ok: true, skipped: true, reason: 'whoop_not_connected' };
    }
    const toDay = today();
    const fromDay = connection.last_synced_day ? addDays(connection.last_synced_day, 1) : addDays(toDay, -30);
    if (fromDay > toDay) return { ok: true, skipped: true, reason: 'no_gap' };
    return sync({ mode: 'backfill', fromDay, toDay, targetDay: toDay });
  }

  async function getStatus() {
    const connection = await getConnection();
    return {
      configured: Boolean(clientId && clientSecret && redirectUri && encryptionSecret),
      connected: Boolean(connection?.status === 'connected' && connection.encrypted_tokens),
      needsReauthorization: Boolean(connection?.status === 'error' && connection.encrypted_tokens),
      profile: connection?.profile || {}, bodyMeasurement: connection?.body_measurement || {},
      lastSyncStartedAt: connection?.last_sync_started_at || null,
      lastSyncCompletedAt: connection?.last_sync_completed_at || null,
      lastSyncStatus: connection?.last_sync_status || '', lastSyncError: connection?.last_sync_error || '',
      lastSyncedDay: connection?.last_synced_day || null, spreadsheetUrl: sheetService.getSpreadsheetUrl(),
    };
  }

  async function getDashboard(days = 90) {
    const fromDay = addDays(today(), -Math.max(7, Math.min(730, Number(days) || 90)));
    const { data, error } = await db().from('softora_health_whoop_records').select('*').eq('owner_key', OWNER_KEY).gte('local_day', fromDay).order('local_day', { ascending: false }).limit(5000);
    if (error) throw error;
    return { records: data || [], fromDay, timezone };
  }

  return {
    completeAuthorization,
    createAuthorizationUrl,
    enqueueWebhookEvent,
    getDashboard,
    getStatus,
    processWebhookEvents,
    repairGap,
    sync,
    syncRecoveryEvent,
    verifyWebhookRequest,
  };
}

module.exports = { addDays, createWhoopHealthService, formatDay, verifyWhoopWebhookSignature };

const crypto = require('crypto');
const {
  AUTH_REQUIRED_RETRY_DELAY_MS, DATA_SYNC_MIN_TOKEN_VALIDITY_MS, TOKEN_REFRESH_AHEAD_MS,
  TOKEN_REFRESH_LOCK_MS, TOKEN_REQUEST_TIMEOUT_MS, TOKEN_WORKER_RETRY_DELAY_MS,
  hasActiveLease, isAuthBlockedReason, isOperationFenceConflict,
} = require('./whoop-token-policy');
const { isCompleteRecoveryRecord, latestContiguousRecoveryDay } = require('./whoop-recovery-completeness');

const OWNER_KEY = 'serve';
const TIMEZONE = 'Europe/Amsterdam';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_WEBHOOK_TABLE = 'softora_health_whoop_webhook_events';
const API_REQUEST_TIMEOUT_MS = 20000;
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
  const sleepImpl = deps.sleep || sleep;
  const random = deps.random || Math.random;
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

  function errorCode(error) {
    return String(error?.code || 'WHOOP_SYNC_FAILED').slice(0, 120);
  }

  function retryDelayMs(attempt, retryAfter = '') {
    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(10000, retryAfterSeconds * 1000);
    }
    const jitter = Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * 150);
    return Math.min(5000, 250 * (2 ** Math.max(0, attempt - 1)) + jitter);
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
      expires_at: now().getTime() + Math.max(300, Number(data.expires_in || 3600)) * 1000,
      scope: data.scope || previous.scope || WHOOP_SCOPES.join(' '),
    };
  }

  async function claimTokenRefreshLock() {
    const lockId = crypto.randomUUID();
    const { data, error } = await db().rpc('softora_claim_whoop_refresh_lock', {
      p_owner_key: OWNER_KEY,
      p_lock_id: lockId,
      p_lock_ttl_seconds: Math.ceil(TOKEN_REFRESH_LOCK_MS / 1000),
    });
    if (error) {
      if (isOperationFenceConflict(error, 'WHOOP_SYNC_ACTIVE')) return null;
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.acquired !== true || String(result.claimed_lock_id || '') !== lockId) return null;
    return {
      lockId,
      connection: {
        encrypted_tokens: result.encrypted_tokens,
        status: result.connection_status,
        token_refresh_lock_id: result.claimed_lock_id,
        token_refresh_lock_until: result.lock_expires_at,
      },
    };
  }

  async function releaseTokenRefreshLock(lockId) {
    if (!lockId) return;
    const { error } = await db().rpc('softora_finish_whoop_refresh', {
      p_owner_key: OWNER_KEY,
      p_lock_id: lockId,
      p_outcome: 'released',
      p_encrypted_tokens: null,
      p_error_code: null,
      p_error_message: null,
    });
    if (error) console.warn('[WHOOP] token refresh lock vrijgeven mislukt:', error.message || error);
  }

  async function waitForPeerRefresh(previousEncryptedTokens) {
    let observedActiveLease = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleepImpl(250);
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
        if (Number(tokens.expires_at || 0) > now().getTime() + 30000) return tokens.access_token;
      }
      const lockUntil = new Date(fresh.token_refresh_lock_until || 0).getTime();
      if (Number.isFinite(lockUntil) && lockUntil > Date.now()) {
        observedActiveLease = true;
        continue;
      }
      const leaseError = new Error(
        observedActiveLease
          ? 'WHOOP-tokenvernieuwing verloor de lease zonder bevestigde token; de sync probeert veilig opnieuw te claimen.'
          : 'WHOOP-tokenvernieuwing had geen actieve lease meer; de sync probeert veilig opnieuw te claimen.'
      );
      leaseError.code = 'WHOOP_REFRESH_LEASE_EXPIRED';
      throw leaseError;
    }
    const error = new Error('WHOOP-tokenvernieuwing is nog bezig; probeer de sync zo opnieuw.');
    error.code = 'WHOOP_REFRESH_BUSY';
    throw error;
  }

  async function finishTokenRefresh(lockId, values = {}) {
    const { data, error } = await db().rpc('softora_finish_whoop_refresh', {
      p_owner_key: OWNER_KEY,
      p_lock_id: lockId,
      p_outcome: values.outcome,
      p_encrypted_tokens: values.encryptedTokens || null,
      p_error_code: values.errorCode || null,
      p_error_message: values.errorMessage || null,
    });
    if (error) throw error;
    if (data !== true) {
      const lockError = new Error('WHOOP-tokenlock verliep voordat de refresh veilig kon worden opgeslagen.');
      lockError.code = 'WHOOP_REFRESH_FENCE_LOST';
      throw lockError;
    }
    return true;
  }

  async function validAccessToken(connection, options = {}) {
    const refreshIfExpiresWithinMs = Math.max(
      30000,
      Number(options.refreshIfExpiresWithinMs || DATA_SYNC_MIN_TOKEN_VALIDITY_MS)
        || DATA_SYNC_MIN_TOKEN_VALIDITY_MS
    );
    const initialTokens = decryptTokens(connection.encrypted_tokens);
    if (Number(initialTokens.expires_at || 0) > now().getTime() + refreshIfExpiresWithinMs) {
      return initialTokens.access_token;
    }
    if (options.allowRefresh === false) {
      const error = new Error('WHOOP-tokenvernieuwing wordt uitsluitend door de aparte tokenworker uitgevoerd.');
      error.code = 'WHOOP_TOKEN_REFRESH_DEFERRED';
      throw error;
    }

    for (let claimAttempt = 0; claimAttempt < 2; claimAttempt += 1) {
      const lock = await claimTokenRefreshLock();
      if (!lock) {
        const fresh = await getConnection();
        if (hasActiveLease(fresh?.sync_lock_id, fresh?.sync_lock_until, now().getTime())) {
          const error = new Error('WHOOP-tokenvernieuwing wacht tot de actieve datasync is afgerond.');
          error.code = 'WHOOP_TOKEN_REFRESH_DEFERRED';
          throw error;
        }
        try {
          return await waitForPeerRefresh(connection.encrypted_tokens);
        } catch (error) {
          if (error?.code === 'WHOOP_REFRESH_LEASE_EXPIRED' && claimAttempt === 0) continue;
          throw error;
        }
      }

      let finalized = false;
      try {
        const lockedConnection = await getConnection();
        if (hasActiveLease(lockedConnection?.sync_lock_id, lockedConnection?.sync_lock_until, now().getTime())) {
          const error = new Error('WHOOP-tokenvernieuwing wacht tot de actieve datasync is afgerond.');
          error.code = 'WHOOP_TOKEN_REFRESH_DEFERRED';
          throw error;
        }
        const lockedTokens = decryptTokens(lockedConnection.encrypted_tokens);
        if (Number(lockedTokens.expires_at || 0) > now().getTime() + refreshIfExpiresWithinMs) {
          return lockedTokens.access_token;
        }

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
            await finishTokenRefresh(lock.lockId, {
              outcome: 'reauthorization_required',
              errorCode: 'WHOOP_REAUTHORIZATION_REQUIRED',
              errorMessage: String(error.message || error).slice(0, 1000),
            });
            finalized = true;
            error.code = 'WHOOP_REAUTHORIZATION_REQUIRED';
          } else if (error?.code === 'WHOOP_TOKEN_ERROR' && error.outcomeUnknown) {
            await finishTokenRefresh(lock.lockId, {
              outcome: 'refresh_uncertain',
              errorCode: 'WHOOP_REFRESH_OUTCOME_UNKNOWN',
              errorMessage: String(error.message || error).slice(0, 1000),
            });
            finalized = true;
            error.code = 'WHOOP_REFRESH_OUTCOME_UNKNOWN';
          }
          throw error;
        }

        const next = normalizeTokens(refreshed, lockedTokens);
        try {
          await finishTokenRefresh(lock.lockId, {
            outcome: 'completed',
            encryptedTokens: encryptTokens(next),
          });
          finalized = true;
        } catch (finishError) {
          if (finishError?.code === 'WHOOP_REFRESH_FENCE_LOST') {
            try {
              await finishTokenRefresh(lock.lockId, {
                outcome: 'refresh_uncertain',
                errorCode: 'WHOOP_REFRESH_FENCE_LOST',
                errorMessage: 'WHOOP-tokenvernieuwing verloor de lease voordat de nieuwe token veilig kon worden opgeslagen.',
              });
              finalized = true;
            } catch (_ignored) {
              // Een nieuwere eigenaar is dan leidend; deze refresh mag niets meer muteren.
            }
          }
          throw finishError;
        }
        return next.access_token;
      } finally {
        if (!finalized) await releaseTokenRefreshLock(lock.lockId);
      }
    }
    throw new Error('WHOOP-tokenvernieuwing kon binnen de veilige leasegrens niet worden bevestigd.');
  }

  async function maintainToken() {
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

    const before = decryptTokens(connection.encrypted_tokens);
    if (Number(before.expires_at || 0) > now().getTime() + TOKEN_REFRESH_AHEAD_MS) {
      return { ok: true, skipped: true, reason: 'token_current', expiresAt: before.expires_at };
    }

    await validAccessToken(connection, {
      allowRefresh: true,
      refreshIfExpiresWithinMs: TOKEN_REFRESH_AHEAD_MS,
    });
    const fresh = await getConnection();
    const after = decryptTokens(fresh.encrypted_tokens);
    return {
      ok: true,
      refreshed: fresh.encrypted_tokens !== connection.encrypted_tokens,
      expiresAt: after.expires_at,
    };
  }

  async function whoopRequest(path, token) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
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
      } catch (networkError) {
        if (attempt < 3) {
          await sleepImpl(retryDelayMs(attempt));
          continue;
        }
        const requestError = new Error('WHOOP-provider is tijdelijk niet bereikbaar.');
        requestError.code = 'WHOOP_PROVIDER_UNAVAILABLE';
        requestError.cause = networkError;
        throw requestError;
      } finally {
        clearTimeout(timeout);
      }
      if (response.ok) return data;
      const status = Number(response.status || 0);
      const retriable = status === 429 || status >= 500;
      if (retriable && attempt < 3) {
        const retryAfter = response.headers && typeof response.headers.get === 'function'
          ? response.headers.get('retry-after')
          : '';
        await sleepImpl(retryDelayMs(attempt, retryAfter));
        continue;
      }
      const providerError = new Error(
        String(data.message || data.error || `WHOOP API-fout (${status || 'onbekend'})`).slice(0, 300)
      );
      providerError.code = status === 429
        ? 'WHOOP_PROVIDER_RATE_LIMITED'
        : (status >= 500 ? 'WHOOP_PROVIDER_UNAVAILABLE' : 'WHOOP_PROVIDER_REJECTED');
      providerError.status = status;
      throw providerError;
    }
    const unreachableError = new Error('WHOOP-provider is tijdelijk niet bereikbaar.');
    unreachableError.code = 'WHOOP_PROVIDER_UNAVAILABLE';
    throw unreachableError;
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

  function expectedDataDay() {
    return localHour() >= 8 ? today() : addDays(today(), -1);
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

  async function resumeDeferredWebhookEvents() {
    const { error } = await db().from(WHOOP_WEBHOOK_TABLE).update({
      status: 'retry',
      attempts: 0,
      next_attempt_at: now().toISOString(),
      processed_at: null,
      last_error: null,
    }).in('status', ['retry', 'dead']).in('last_error', [
      'whoop_not_connected',
      'whoop_reauthorization_required',
      'whoop_refresh_outcome_unknown',
      'WHOOP_REAUTHORIZATION_REQUIRED',
      'WHOOP_REFRESH_OUTCOME_UNKNOWN',
      'WHOOP-tokenvernieuwing is nog bezig; probeer de sync zo opnieuw.',
    ]);
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
      last_sync_error_code: null, last_sync_status: null, last_sync_attempt: 0,
      last_synced_day: null, next_retry_at: null,
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
    await resumeDeferredWebhookEvents();
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

  async function hasCompleteRecoveryForDay(targetDay) {
    const { data, error } = await db()
      .from('softora_health_whoop_records')
      .select('source_id')
      .eq('owner_key', OWNER_KEY)
      .eq('source_type', 'recovery')
      .eq('local_day', targetDay)
      .in('score_state', ['SCORED', 'UNSCORABLE'])
      .limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async function claimSyncRun({ mode, targetDay, attempt }) {
    const lockId = crypto.randomUUID();
    const { data, error } = await db().rpc('softora_claim_whoop_sync_run', {
      p_owner_key: OWNER_KEY,
      p_lock_id: lockId,
      p_lock_ttl_seconds: Math.ceil(SYNC_LOCK_MS / 1000),
      p_mode: mode,
      p_target_day: targetDay,
      p_attempt: attempt,
    });
    if (error) {
      if (isOperationFenceConflict(error, 'WHOOP_TOKEN_REFRESH_ACTIVE')) return null;
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.acquired !== true || String(result.claimed_lock_id || '') !== lockId) return null;
    const connection = await getConnection();
    if (!connection || connection.sync_lock_id !== lockId || String(connection.last_sync_run_id || '') !== String(result.run_id || '')) {
      const lockError = new Error('WHOOP-synclock kon na de atomaire claim niet worden bevestigd.');
      lockError.code = 'WHOOP_SYNC_LOCK_FENCE_LOST';
      throw lockError;
    }
    return { lockId, runId: result.run_id, connection };
  }

  async function finishSyncRun(syncRun, values = {}) {
    const { data, error } = await db().rpc('softora_finish_whoop_sync_run', {
      p_owner_key: OWNER_KEY,
      p_lock_id: syncRun.lockId,
      p_run_id: syncRun.runId,
      p_status: values.status,
      p_records_seen: values.recordsSeen || 0,
      p_records_upserted: values.recordsUpserted || 0,
      p_error_code: values.errorCode || null,
      p_error_message: values.errorMessage || null,
      p_next_retry_at: values.nextRetryAt || null,
      p_last_synced_day: values.lastSyncedDay || null,
      p_whoop_user_id: values.whoopUserId || null,
    });
    if (error) throw error;
    if (data !== true) {
      const lockError = new Error('WHOOP-syncrun verloor de databaselease en mag niet meer afronden.');
      lockError.code = 'WHOOP_SYNC_LOCK_FENCE_LOST';
      throw lockError;
    }
    return true;
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

    const attempt = connection.last_sync_status === 'failed'
      ? Math.min(99, Math.max(1, Number(connection.last_sync_attempt || 0) + 1))
      : 1;
    const syncRun = await claimSyncRun({ mode, targetDay, attempt });
    if (!syncRun) return { ok: true, skipped: true, reason: 'sync_in_progress', targetDay };

    let finalized = false;
    try {
      const lockedConnection = syncRun.connection || connection;
      if (hasActiveLease(
        lockedConnection.token_refresh_lock_id, lockedConnection.token_refresh_lock_until, now().getTime()
      )) {
        const error = new Error('WHOOP-datasync wacht tot de aparte tokenworker is afgerond.');
        error.code = 'WHOOP_TOKEN_REFRESH_DEFERRED';
        throw error;
      }
      const token = await validAccessToken(lockedConnection, {
        allowRefresh: false,
        refreshIfExpiresWithinMs: DATA_SYNC_MIN_TOKEN_VALIDITY_MS,
      });
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
      const lastStoredDay = records.reduce(
        (latest, record) => !latest || record.local_day > latest ? record.local_day : latest,
        ''
      );
      const targetDayStored = records.some((record) => record.local_day === targetDay);
      const completeRecoveryRecords = records.filter(isCompleteRecoveryRecord);
      const lastCompleteRecoveryDay = completeRecoveryRecords.reduce(
        (latest, record) => !latest || record.local_day > latest ? record.local_day : latest,
        ''
      );
      const lastContiguousRecoveryDay = latestContiguousRecoveryDay(
        records, String(lockedConnection.last_synced_day || '')
      );
      const targetDayComplete = completeRecoveryRecords.some((record) => record.local_day === targetDay);
      const recoveryRangeComplete = lastContiguousRecoveryDay === targetDay;
      const retryAt = recoveryRangeComplete
        ? null
        : new Date(now().getTime() + 15 * 60 * 1000).toISOString();
      const syncedRecord = records.find((record) => Number(record.whoop_user_id || 0) > 0);
      await finishSyncRun(syncRun, {
        status: 'completed',
        recordsSeen: records.length,
        recordsUpserted: records.length,
        errorCode: recoveryRangeComplete ? null : 'WHOOP_RECOVERY_RANGE_INCOMPLETE',
        errorMessage: recoveryRangeComplete ? null : 'WHOOP heeft nog geen aaneengesloten complete recovery-reeks bevestigd.',
        nextRetryAt: retryAt,
        lastSyncedDay: lastContiguousRecoveryDay || null,
        whoopUserId: syncedRecord ? Number(syncedRecord.whoop_user_id) : null,
      });
      finalized = true;
      let sheetResult = { ok: true, skipped: true };
      try {
        sheetResult = await sheetService.syncSnapshot(await getSheetSnapshot());
      } catch (sheetError) {
        sheetResult = { ok: false, error: String(sheetError.message || sheetError) };
      }
      const sheetStatus = sheetResult.ok === false ? 'failed' : (sheetResult.skipped ? 'skipped' : 'completed');
      await updateSyncRun(syncRun.runId, {
        sheet_status: sheetStatus, error: sheetResult.error || null,
      });
      return {
        ok: true,
        targetDay,
        records: records.length,
        dataProgress: Boolean(lastStoredDay),
        targetDayStored,
        targetDayComplete,
        recoveryRangeComplete,
        lastStoredDay: lastStoredDay || null,
        lastCompleteRecoveryDay: lastCompleteRecoveryDay || null,
        lastContiguousRecoveryDay: lastContiguousRecoveryDay || null,
        nextRetryAt: retryAt,
        runId: syncRun.runId,
        sheet: sheetResult,
      };
    } catch (error) {
      const message = String(error.message || error).slice(0, 1000);
      if (!finalized) {
        const terminal = ['WHOOP_REAUTHORIZATION_REQUIRED', 'WHOOP_REFRESH_OUTCOME_UNKNOWN']
          .includes(errorCode(error));
        const nextRetryAt = terminal
          ? null
          : new Date(now().getTime() + Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(5, attempt - 1)))).toISOString();
        try {
          await finishSyncRun(syncRun, {
            status: 'failed',
            errorCode: errorCode(error),
            errorMessage: message,
            nextRetryAt,
          });
          finalized = true;
        } catch (finalizeError) {
          console.error('[WHOOP] fenced syncfinalisatie mislukt:', errorCode(finalizeError));
        }
      }
      throw error;
    }
  }

  async function reconcileToday(options = {}) {
    const hour = localHour();
    if (options.enforceSchedule && (hour < 5 || hour >= 12)) {
      return { ok: true, skipped: true, reason: 'outside_local_morning_window' };
    }
    const targetDay = today();
    const connection = await getConnection();
    if (connection?.last_synced_day && String(connection.last_synced_day) < expectedDataDay()) {
      return sync({
        mode: 'backfill',
        targetDay,
        startDay: addDays(String(connection.last_synced_day), 1),
      });
    }
    if (await hasCompleteRecoveryForDay(targetDay)) {
      return { ok: true, skipped: true, reason: 'today_recovery_already_synced', targetDay };
    }
    return sync({ mode: 'reconcile', targetDay });
  }

  async function syncTodayFallback(options = {}) {
    const hour = localHour();
    if (options.enforceSchedule && hour !== 12) {
      return { ok: true, skipped: true, reason: 'outside_local_12_hour' };
    }
    const targetDay = today();
    const connection = await getConnection();
    if (connection?.last_synced_day && String(connection.last_synced_day) < expectedDataDay()) {
      return sync({
        mode: 'backfill',
        targetDay,
        startDay: addDays(String(connection.last_synced_day), 1),
      });
    }
    return sync({ mode: 'daily', targetDay });
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
          if (result.reason === 'sync_in_progress') {
            await updateClaimedWebhookEvent(event, {
              status: 'retry',
              attempts: Math.max(0, attempts - 1),
              next_attempt_at: new Date(now().getTime() + 60 * 1000).toISOString(),
              last_error: 'sync_in_progress',
            });
            results.push({ traceId: event.trace_id, ok: true, deferred: true, reason: result.reason });
            continue;
          }
          if (isAuthBlockedReason(result.reason)) {
            await updateClaimedWebhookEvent(event, {
              status: 'retry',
              attempts: Math.max(0, attempts - 1),
              next_attempt_at: new Date(now().getTime() + AUTH_REQUIRED_RETRY_DELAY_MS).toISOString(),
              last_error: result.reason,
            });
            results.push({ traceId: event.trace_id, ok: true, deferred: true, reason: result.reason });
            continue;
          }
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
        const queueErrorCode = errorCode(queueError);
        const deferred = [
          'WHOOP_TOKEN_REFRESH_DEFERRED',
          'WHOOP_REAUTHORIZATION_REQUIRED',
          'WHOOP_REFRESH_OUTCOME_UNKNOWN',
        ].includes(queueErrorCode);
        if (deferred) {
          await updateClaimedWebhookEvent(event, {
            status: 'retry',
            attempts: Math.max(0, attempts - 1),
            next_attempt_at: new Date(now().getTime() + (
              queueErrorCode === 'WHOOP_TOKEN_REFRESH_DEFERRED'
                ? TOKEN_WORKER_RETRY_DELAY_MS
                : AUTH_REQUIRED_RETRY_DELAY_MS
            )).toISOString(),
            last_error: queueErrorCode,
          });
          results.push({ traceId: event.trace_id, ok: true, deferred: true, reason: queueErrorCode });
          continue;
        }
        const terminal = attempts >= 8;
        const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1)));
        await updateClaimedWebhookEvent(event, {
          status: terminal ? 'dead' : 'retry',
          next_attempt_at: new Date(now().getTime() + delaySeconds * 1000).toISOString(),
          last_error: message,
        });
        results.push({ traceId: event.trace_id, ok: false, error: message });
      }
    }

    if (results.length === 0) {
      const connection = await getConnection();
      const retryAt = new Date(connection?.next_retry_at || 0).getTime();
      const retryDue = !Number.isFinite(retryAt) || retryAt <= now().getTime();
      const expectedDay = expectedDataDay();
      const missingExpectedDay = !connection?.last_synced_day
        || String(connection.last_synced_day) < expectedDay;
      if (connection?.status === 'connected' && retryDue && missingExpectedDay) {
        try {
          const result = await sync({
            mode: 'backfill',
            targetDay: today(),
            ...(connection.last_synced_day
              ? { startDay: addDays(String(connection.last_synced_day), 1) }
              : {}),
          });
          results.push({ traceId: 'automatic-backfill-monitor', ok: true, result });
        } catch (monitorError) {
          results.push({
            traceId: 'automatic-backfill-monitor',
            ok: false,
            error: errorCode(monitorError),
          });
        }
      }
    }

    return {
      ok: true,
      processed: results.filter((result) => result.traceId !== 'automatic-backfill-monitor').length,
      monitoring: results.find((result) => result.traceId === 'automatic-backfill-monitor') || null,
      results,
    };
  }

  async function getStatus() {
    const connection = await getConnection();
    const [{ data: latestRuns, error: latestRunError }, { data: queuedRetries, error: queuedRetryError }] = await Promise.all([
      db().from('softora_health_sync_runs')
        .select('id,mode,status,target_day,attempt,error_code,started_at,completed_at,next_retry_at')
        .eq('owner_key', OWNER_KEY)
        .order('started_at', { ascending: false })
        .limit(1),
      db().from(WHOOP_WEBHOOK_TABLE)
        .select('status,next_attempt_at,attempts,event_type')
        .in('status', ['pending', 'retry', 'processing'])
        .order('next_attempt_at', { ascending: true })
        .limit(1),
    ]);
    if (latestRunError) throw latestRunError;
    if (queuedRetryError) throw queuedRetryError;
    const latestRun = Array.isArray(latestRuns) ? (latestRuns[0] || null) : null;
    const queuedRetry = Array.isArray(queuedRetries) ? (queuedRetries[0] || null) : null;
    const nowMs = now().getTime();
    const tokenRefreshLockUntil = new Date(connection?.token_refresh_lock_until || 0).getTime();
    const syncLockUntil = new Date(connection?.sync_lock_until || 0).getTime();
    const tokenRefreshInProgress = Boolean(
      connection?.token_refresh_lock_id && Number.isFinite(tokenRefreshLockUntil) && tokenRefreshLockUntil > nowMs
    );
    const syncInProgress = Boolean(
      connection?.sync_lock_id && Number.isFinite(syncLockUntil) && syncLockUntil > nowMs
    );
    const expectedDay = expectedDataDay();
    const missingExpectedDay = Boolean(
      connection?.status === 'connected'
      && (!connection?.last_synced_day || String(connection.last_synced_day) < expectedDay)
    );
    const staleSyncStatus = !syncInProgress && (
      connection?.last_sync_status === 'running' ||
      /WHOOP-tokenvernieuwing is nog bezig/i.test(String(connection?.last_sync_error || '')) ||
      missingExpectedDay
    );
    const connectionNeedsReauthorization = ['reauthorization_required', 'refresh_uncertain'].includes(connection?.status);
    const providerUnavailable = ['WHOOP_PROVIDER_UNAVAILABLE', 'WHOOP_PROVIDER_RATE_LIMITED']
      .includes(String(connection?.last_sync_error_code || latestRun?.error_code || ''));
    const nextRetryAt = connection?.next_retry_at || queuedRetry?.next_attempt_at || null;
    const retryScheduled = Boolean(nextRetryAt && new Date(nextRetryAt).getTime() > nowMs);
    const current = Boolean(
      connection?.status === 'connected'
      && !syncInProgress
      && !tokenRefreshInProgress
      && !missingExpectedDay
      && String(connection?.last_sync_status || '') === 'completed'
    );
    const syncState = connectionNeedsReauthorization
      ? 'needs_reauthorization'
      : (tokenRefreshInProgress || syncInProgress)
          ? 'syncing'
          : providerUnavailable
            ? 'provider_unavailable'
            : retryScheduled
              ? 'retry_scheduled'
              : staleSyncStatus
                ? 'stale'
                : current
                  ? 'current'
                  : (connection?.last_sync_status || 'idle');
    const alerts = [];
    if (missingExpectedDay) alerts.push('expected_day_missing');
    if (staleSyncStatus) alerts.push('stale_sync_state');
    if (providerUnavailable) alerts.push('provider_unavailable');
    if (connectionNeedsReauthorization) alerts.push('reauthorization_required');
    const safeLastSyncError = String(connection?.last_sync_error || '')
      .replace(/[A-Za-z0-9_-]{40,}/g, '[afgeschermd]')
      .slice(0, 500);
    return {
      configured: Boolean(clientId && clientSecret && redirectUri && encryptionSecret),
      connected: Boolean(connection?.status === 'connected' && connection.encrypted_tokens),
      connectionStatus: connection?.status || 'disconnected',
      needsReauthorization: connectionNeedsReauthorization,
      reauthorizationReason: connection?.status === 'refresh_uncertain'
        ? 'refresh_outcome_unknown'
        : (connection?.status === 'reauthorization_required' ? 'refresh_token_rejected' : ''),
      profileAvailable: Boolean(connection?.profile && Object.keys(connection.profile).length),
      bodyMeasurementAvailable: Boolean(connection?.body_measurement && Object.keys(connection.body_measurement).length),
      lastSyncStartedAt: connection?.last_sync_started_at || null,
      lastSyncCompletedAt: connection?.last_sync_completed_at || null,
      lastSyncStatus: connection?.last_sync_status || '',
      lastSyncErrorCode: connection?.last_sync_error_code || latestRun?.error_code || '',
      lastSyncError: safeLastSyncError,
      syncState,
      current,
      expectedDay,
      missingExpectedDay,
      retryScheduled,
      nextRetryAt,
      providerUnavailable,
      alerts,
      syncInProgress,
      tokenRefreshInProgress,
      tokenRefreshLockUntil: tokenRefreshInProgress ? connection.token_refresh_lock_until : null,
      syncLockUntil: syncInProgress ? connection.sync_lock_until : null,
      staleSyncStatus,
      latestRun: latestRun ? {
        id: latestRun.id,
        mode: latestRun.mode,
        status: latestRun.status,
        targetDay: latestRun.target_day,
        attempt: Number(latestRun.attempt || 1),
        errorCode: latestRun.error_code || '',
        startedAt: latestRun.started_at || null,
        completedAt: latestRun.completed_at || null,
        nextRetryAt: latestRun.next_retry_at || null,
      } : null,
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
    maintainToken,
    reconcileToday,
    sync,
    syncTodayFallback,
    verifyWebhookSignature,
  };
}

module.exports = { addDays, createWhoopHealthService, formatDay };

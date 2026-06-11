const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_REST_TIMEOUT_MS = 1500;

function createSupabaseStateStore(deps = {}) {
  const {
    supabaseUrl = '',
    supabaseServiceRoleKey = '',
    supabaseStateTable = '',
    supabaseStateKey = '',
    supabaseCallUpdateStateKeyPrefix = '',
    supabaseCallUpdateRowsFetchLimit = 1000,
    supabaseRestTimeoutMs = DEFAULT_SUPABASE_REST_TIMEOUT_MS,
    supabaseRestFailureCooldownMs = 60_000,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    createClient = createSupabaseClient,
    fetchImpl = globalThis.fetch,
  } = deps;

  const supabaseClientByPolicy = new Map();
  const timedSupabaseFetchByPolicy = new Map();
  let restFailureCooldownUntilMs = 0;
  let restFailureCooldownReason = '';

  function isSupabaseConfigured() {
    return Boolean(supabaseUrl && supabaseServiceRoleKey);
  }

  function getSafeSupabaseTimeoutMs(timeoutOverrideMs = null) {
    const rawTimeout =
      timeoutOverrideMs === null || timeoutOverrideMs === undefined
        ? supabaseRestTimeoutMs
        : timeoutOverrideMs;
    return Math.max(
      1000,
      Math.min(
        60000,
        Number(rawTimeout) || DEFAULT_SUPABASE_REST_TIMEOUT_MS
      )
    );
  }

  function getSafeRestFailureCooldownMs() {
    return Math.max(0, Math.min(5 * 60_000, Number(supabaseRestFailureCooldownMs) || 0));
  }

  function buildRestCooldownError() {
    const secondsLeft = Math.max(1, Math.ceil((restFailureCooldownUntilMs - Date.now()) / 1000));
    return `Supabase REST tijdelijk overgeslagen na timeout/504 (${secondsLeft}s cooldown${restFailureCooldownReason ? `, ${restFailureCooldownReason}` : ''}).`;
  }

  function isRestFailureCooldownActive() {
    return Date.now() < restFailureCooldownUntilMs;
  }

  function openRestFailureCooldown(reason, options = {}) {
    if (options && options.suppressFailureCooldown) return;
    const cooldownMs = getSafeRestFailureCooldownMs();
    if (!cooldownMs) return;
    restFailureCooldownUntilMs = Date.now() + cooldownMs;
    restFailureCooldownReason = truncateText(normalizeString(reason), 160);
  }

  function shouldOpenRestFailureCooldownFromError(error) {
    const text = normalizeString(error && (error.message || error.name || error.code || error));
    return /abort|timeout|timed out|504|fetch failed|network|econnreset|etimedout|connection terminated/i.test(text);
  }

  function normalizeSupabaseClientFetchOptions(options = {}) {
    return {
      timeoutMs: getSafeSupabaseTimeoutMs(options.timeoutMs),
      ignoreFailureCooldown: Boolean(options.ignoreFailureCooldown),
      suppressFailureCooldown: Boolean(options.suppressFailureCooldown),
    };
  }

  function buildSupabaseClientPolicyKey(policy) {
    return JSON.stringify([
      policy.timeoutMs,
      policy.ignoreFailureCooldown ? 1 : 0,
      policy.suppressFailureCooldown ? 1 : 0,
    ]);
  }

  function redactSupabaseUrlForDebug(url = supabaseUrl) {
    const raw = normalizeString(url || '');
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return truncateText(raw, 80);
    }
  }

  function buildRestHeaders(extraHeaders = {}) {
    return {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      ...extraHeaders,
    };
  }

  function getTimedSupabaseFetch(fetchOptions = {}) {
    if (typeof fetchImpl !== 'function') return null;
    const policy = normalizeSupabaseClientFetchOptions(fetchOptions);
    const policyKey = buildSupabaseClientPolicyKey(policy);
    const cachedFetch = timedSupabaseFetchByPolicy.get(policyKey);
    if (cachedFetch) return cachedFetch;

    const timedSupabaseFetch = async (url, options = {}) => {
      if (!policy.ignoreFailureCooldown && isRestFailureCooldownActive()) {
        const error = new Error(buildRestCooldownError());
        error.code = 'SUPABASE_REST_COOLDOWN';
        throw error;
      }

      const timeoutMs = policy.timeoutMs;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const upstreamSignal = options?.signal;
      let timeout = null;
      let abortListener = null;

      if (controller && upstreamSignal && typeof upstreamSignal.addEventListener === 'function') {
        if (upstreamSignal.aborted) {
          controller.abort(upstreamSignal.reason);
        } else {
          abortListener = () => controller.abort(upstreamSignal.reason);
          upstreamSignal.addEventListener('abort', abortListener, { once: true });
        }
      }

      if (controller) {
        timeout = setTimeout(() => {
          const timeoutError = new Error(
            `Supabase client timeout na ${timeoutMs}ms`
          );
          timeoutError.name = 'AbortError';
          controller.abort(timeoutError);
        }, timeoutMs);
      }

      try {
        const response = await fetchImpl(url, {
          ...options,
          signal: controller ? controller.signal : upstreamSignal,
        });
        if (response && response.status >= 500) {
          openRestFailureCooldown(`status ${response.status}`, policy);
        }
        return response;
      } catch (error) {
        if (shouldOpenRestFailureCooldownFromError(error)) {
          openRestFailureCooldown(error?.message || error?.name || 'fetch timeout', policy);
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener && typeof upstreamSignal?.removeEventListener === 'function') {
          upstreamSignal.removeEventListener('abort', abortListener);
        }
      }
    };

    timedSupabaseFetchByPolicy.set(policyKey, timedSupabaseFetch);
    return timedSupabaseFetch;
  }

  async function performRestRequest(url, options = {}, requestOptions = {}) {
    if (!isSupabaseConfigured()) {
      return { ok: false, status: null, body: null, error: 'Supabase niet geconfigureerd.' };
    }
    if (typeof fetchImpl !== 'function') {
      return { ok: false, status: null, body: null, error: 'Fetch is niet beschikbaar.' };
    }
    const ignoreFailureCooldown = Boolean(requestOptions && requestOptions.ignoreFailureCooldown);
    if (!ignoreFailureCooldown && isRestFailureCooldownActive()) {
      return { ok: false, status: null, body: null, error: buildRestCooldownError() };
    }

    const timeoutMs = getSafeSupabaseTimeoutMs(requestOptions && requestOptions.timeoutMs);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller ? controller.signal : options.signal,
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      if (!response.ok && response.status >= 500) {
        openRestFailureCooldown(`status ${response.status}`, requestOptions);
      }
      return { ok: response.ok, status: response.status, body, error: null };
    } catch (error) {
      if (shouldOpenRestFailureCooldownFromError(error)) {
        openRestFailureCooldown(error?.message || error?.name || 'REST timeout', requestOptions);
      }
      return {
        ok: false,
        status: null,
        body: null,
        error: truncateText(
          error?.name === 'AbortError'
            ? `Supabase REST timeout na ${timeoutMs}ms`
            : (error?.message || String(error)),
          500
        ),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function fetchStateRowViaRest(selectColumns = 'payload,updated_at', requestOptions = {}) {
    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url =
      `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}` +
      `?select=${encodeURIComponent(selectColumns)}` +
      `&state_key=eq.${encodeURIComponent(supabaseStateKey)}` +
      '&limit=1';

    return performRestRequest(
      url,
      {
        method: 'GET',
        headers: buildRestHeaders(),
      },
      requestOptions
    );
  }

  async function upsertStateRowViaRest(row, requestOptions = {}) {
    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?on_conflict=state_key`;

    return performRestRequest(
      url,
      {
        method: 'POST',
        headers: buildRestHeaders({
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify([row]),
      },
      requestOptions
    );
  }

  async function fetchRowByKeyViaRest(rowKey, selectColumns = 'payload,updated_at', requestOptions = {}) {
    const normalizedRowKey = normalizeString(rowKey);
    if (!normalizedRowKey) {
      return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
    }

    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url =
      `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}` +
      `?select=${encodeURIComponent(selectColumns)}` +
      `&state_key=eq.${encodeURIComponent(normalizedRowKey)}` +
      '&limit=1';

    return performRestRequest(
      url,
      {
        method: 'GET',
        headers: buildRestHeaders(),
      },
      requestOptions
    );
  }

  async function upsertRowViaRest(row, requestOptions = {}) {
    const stateKey = normalizeString(row?.state_key || '');
    if (!stateKey) {
      return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
    }

    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?on_conflict=state_key`;

    return performRestRequest(
      url,
      {
        method: 'POST',
        headers: buildRestHeaders({
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify([row]),
      },
      requestOptions
    );
  }

  function buildSupabaseCallUpdateStateKey(callId) {
    const normalizedCallId = normalizeString(callId || '');
    if (!normalizedCallId) return '';
    return `${supabaseCallUpdateStateKeyPrefix}${normalizedCallId}`;
  }

  function extractCallIdFromSupabaseCallUpdateStateKey(stateKey) {
    const normalizedStateKey = normalizeString(stateKey || '');
    if (!normalizedStateKey) return '';
    if (!normalizedStateKey.startsWith(supabaseCallUpdateStateKeyPrefix)) return '';
    return normalizeString(normalizedStateKey.slice(supabaseCallUpdateStateKeyPrefix.length));
  }

  async function fetchSupabaseCallUpdateRowsViaRest(limit = supabaseCallUpdateRowsFetchLimit) {
    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || supabaseCallUpdateRowsFetchLimit));
    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const likePattern = `${supabaseCallUpdateStateKeyPrefix}%`;
    const url =
      `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}` +
      `?select=${encodeURIComponent('state_key,payload,updated_at')}` +
      `&state_key=like.${encodeURIComponent(likePattern)}` +
      '&order=updated_at.desc' +
      `&limit=${safeLimit}`;

    return performRestRequest(url, {
      method: 'GET',
      headers: buildRestHeaders(),
    });
  }

  async function fetchSupabaseRowsByStateKeyPrefixViaRest(
    prefix,
    limit = 100,
    selectColumns = 'state_key,payload,updated_at',
    offset = 0
  ) {
    const normalizedPrefix = normalizeString(prefix || '');
    if (!normalizedPrefix) {
      return { ok: false, status: null, body: null, error: 'Ongeldige state key-prefix.' };
    }
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const likePattern = `${normalizedPrefix}%`;
    const url =
      `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}` +
      `?select=${encodeURIComponent(selectColumns)}` +
      `&state_key=like.${encodeURIComponent(likePattern)}` +
      '&order=updated_at.desc' +
      `&limit=${safeLimit}` +
      `&offset=${safeOffset}`;

    return performRestRequest(url, {
      method: 'GET',
      headers: buildRestHeaders(),
    });
  }

  async function deleteSupabaseRowByStateKeyViaRest(rowKey) {
    const normalizedRowKey = normalizeString(rowKey || '');
    if (!normalizedRowKey) {
      return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
    }

    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url =
      `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}` +
      `?state_key=eq.${encodeURIComponent(normalizedRowKey)}`;

    return performRestRequest(url, {
      method: 'DELETE',
      headers: buildRestHeaders({
        Prefer: 'return=minimal',
      }),
    });
  }

  function getSupabaseClient(options = {}) {
    if (!isSupabaseConfigured()) return null;
    const policy = normalizeSupabaseClientFetchOptions(options);
    const policyKey = buildSupabaseClientPolicyKey(policy);
    const cachedClient = supabaseClientByPolicy.get(policyKey);
    if (cachedClient) return cachedClient;
    const clientOptions = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    const fetchWithTimeout = getTimedSupabaseFetch(policy);
    if (fetchWithTimeout) {
      clientOptions.global = { fetch: fetchWithTimeout };
    }
    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions);
    supabaseClientByPolicy.set(policyKey, supabaseClient);
    return supabaseClient;
  }

  return {
    buildSupabaseCallUpdateStateKey,
    extractCallIdFromSupabaseCallUpdateStateKey,
    fetchSupabaseCallUpdateRowsViaRest,
    fetchSupabaseRowsByStateKeyPrefixViaRest,
    deleteSupabaseRowByStateKeyViaRest,
    fetchSupabaseRowByKeyViaRest: fetchRowByKeyViaRest,
    fetchSupabaseStateRowViaRest: fetchStateRowViaRest,
    getSupabaseClient,
    isSupabaseConfigured,
    redactSupabaseUrlForDebug,
    upsertSupabaseRowViaRest: upsertRowViaRest,
    upsertSupabaseStateRowViaRest: upsertStateRowViaRest,
  };
}

module.exports = {
  createSupabaseStateStore,
};

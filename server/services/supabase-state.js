const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_REST_TIMEOUT_MS = 1500;
const DEFAULT_SUPABASE_REST_MAX_RESPONSE_BYTES = 1_000_000;

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
    supabaseRestMaxResponseBytes = DEFAULT_SUPABASE_REST_MAX_RESPONSE_BYTES,
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
    const timeout = Number(rawTimeout);
    if (!Number.isFinite(timeout) || timeout <= 0) return DEFAULT_SUPABASE_REST_TIMEOUT_MS;
    if (timeout <= 1000) return 1000;
    if (timeout <= DEFAULT_SUPABASE_REST_TIMEOUT_MS) return DEFAULT_SUPABASE_REST_TIMEOUT_MS;
    if (timeout <= 5000) return 5000;
    if (timeout <= 8000) return 8000;
    if (timeout <= 15000) return 15000;
    if (timeout <= 30000) return 30000;
    return 60000;
  }

  function getSafeSupabaseRestMaxResponseBytes() {
    const maxBytes = Number(supabaseRestMaxResponseBytes);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      return DEFAULT_SUPABASE_REST_MAX_RESPONSE_BYTES;
    }
    return Math.max(16, Math.min(5_000_000, Math.floor(maxBytes)));
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

  function isAllowedLocalSupabaseHost(hostname) {
    const normalizedHostname = normalizeString(hostname).toLowerCase();
    return (
      normalizedHostname === 'localhost' ||
      normalizedHostname === '127.0.0.1' ||
      normalizedHostname === '::1'
    );
  }

  function getSafeSupabaseOrigin() {
    const raw = normalizeString(supabaseUrl || '');
    if (!raw) return { ok: false, origin: '', error: 'Supabase URL ontbreekt.' };
    try {
      const parsed = new URL(raw);
      const hostname = parsed.hostname.toLowerCase();
      const isHostedSupabase =
        parsed.protocol === 'https:' &&
        hostname.endsWith('.supabase.co') &&
        /^[a-z0-9-]+\.supabase\.co$/.test(hostname);
      const isLocalSupabase =
        parsed.protocol === 'http:' && isAllowedLocalSupabaseHost(hostname);

      if (parsed.username || parsed.password) {
        return { ok: false, origin: '', error: 'Supabase URL mag geen credentials bevatten.' };
      }
      if (!isHostedSupabase && !isLocalSupabase) {
        return { ok: false, origin: '', error: 'Supabase URL host is niet toegestaan.' };
      }
      return { ok: true, origin: `${parsed.protocol}//${parsed.host}`, error: '' };
    } catch {
      return { ok: false, origin: '', error: 'Supabase URL is ongeldig.' };
    }
  }

  function buildRestRequestError(error) {
    return { ok: false, status: null, body: null, error };
  }

  function buildSupabaseStateTableRestUrl(queryParams = {}) {
    const safeOrigin = getSafeSupabaseOrigin();
    if (!safeOrigin.ok) return safeOrigin;

    const tableName = normalizeString(supabaseStateTable || '');
    if (!tableName) {
      return { ok: false, origin: '', error: 'Supabase state table ontbreekt.' };
    }

    const url = new URL('/rest/v1/', safeOrigin.origin);
    url.pathname = `/rest/v1/${encodeURIComponent(tableName)}`;
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      url.searchParams.set(key, String(value));
    });
    return { ok: true, url, error: '' };
  }

  function getFetchUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function normalizeSupabaseRequestUrl(input, options = {}) {
    const safeOrigin = getSafeSupabaseOrigin();
    if (!safeOrigin.ok) return safeOrigin;
    const rawUrl = getFetchUrl(input);
    if (!rawUrl) {
      return { ok: false, url: '', error: 'Supabase request URL ontbreekt.' };
    }

    try {
      const parsed = new URL(rawUrl);
      if (parsed.origin !== safeOrigin.origin) {
        return { ok: false, url: '', error: 'Supabase request URL host is niet toegestaan.' };
      }
      if (options.requireRestPath && !parsed.pathname.startsWith('/rest/v1/')) {
        return { ok: false, url: '', error: 'Supabase REST-pad is niet toegestaan.' };
      }
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      return { ok: true, url: parsed.href, error: '' };
    } catch {
      return { ok: false, url: '', error: 'Supabase request URL is ongeldig.' };
    }
  }

  function getHeaderValue(headers, name) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const normalizedName = name.toLowerCase();
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName);
    return entry ? String(entry[1] || '') : '';
  }

  async function readBoundedRestResponseText(response) {
    const maxBytes = getSafeSupabaseRestMaxResponseBytes();
    const contentLength = Number(getHeaderValue(response && response.headers, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Supabase REST response te groot (${contentLength} bytes).`);
    }

    if (
      response &&
      response.body &&
      typeof response.body.getReader === 'function' &&
      typeof TextDecoder === 'function'
    ) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0;
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkBytes =
          value && typeof value.byteLength === 'number'
            ? value.byteLength
            : Buffer.byteLength(String(value || ''), 'utf8');
        totalBytes += chunkBytes;
        if (totalBytes > maxBytes) {
          throw new Error(`Supabase REST response te groot (${totalBytes} bytes).`);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    }

    const text = await response.text();
    const responseBytes = Buffer.byteLength(text || '', 'utf8');
    if (responseBytes > maxBytes) {
      throw new Error(`Supabase REST response te groot (${responseBytes} bytes).`);
    }
    return text;
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
      const safeRequest = normalizeSupabaseRequestUrl(url);
      if (!safeRequest.ok) {
        const error = new Error(safeRequest.error);
        error.code = 'SUPABASE_REQUEST_URL_BLOCKED';
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
        const response = await fetchImpl(safeRequest.url, {
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

    if (!(url instanceof URL)) {
      return buildRestRequestError('Supabase request URL is ongeldig.');
    }
    const safeOrigin = getSafeSupabaseOrigin();
    if (!safeOrigin.ok) return buildRestRequestError(safeOrigin.error);
    if (url.origin !== safeOrigin.origin || !url.pathname.startsWith('/rest/v1/')) {
      return buildRestRequestError('Supabase REST-pad is niet toegestaan.');
    }
    const timeoutMs = getSafeSupabaseTimeoutMs(requestOptions && requestOptions.timeoutMs);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller ? controller.signal : options.signal,
      });
      const text = await readBoundedRestResponseText(response);
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
    const requestUrl = buildSupabaseStateTableRestUrl({
      select: selectColumns,
      state_key: `eq.${supabaseStateKey}`,
      limit: 1,
    });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(
      requestUrl.url,
      {
        method: 'GET',
        headers: buildRestHeaders(),
      },
      requestOptions
    );
  }

  async function upsertStateRowViaRest(row, requestOptions = {}) {
    const requestUrl = buildSupabaseStateTableRestUrl({ on_conflict: 'state_key' });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(
      requestUrl.url,
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

    const requestUrl = buildSupabaseStateTableRestUrl({
      select: selectColumns,
      state_key: `eq.${normalizedRowKey}`,
      limit: 1,
    });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(
      requestUrl.url,
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

    const requestUrl = buildSupabaseStateTableRestUrl({ on_conflict: 'state_key' });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(
      requestUrl.url,
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
    const likePattern = `${supabaseCallUpdateStateKeyPrefix}%`;
    const requestUrl = buildSupabaseStateTableRestUrl({
      select: 'state_key,payload,updated_at',
      state_key: `like.${likePattern}`,
      order: 'updated_at.desc',
      limit: safeLimit,
    });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(requestUrl.url, {
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
    const likePattern = `${normalizedPrefix}%`;
    const requestUrl = buildSupabaseStateTableRestUrl({
      select: selectColumns,
      state_key: `like.${likePattern}`,
      order: 'updated_at.desc',
      limit: safeLimit,
      offset: safeOffset,
    });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(requestUrl.url, {
      method: 'GET',
      headers: buildRestHeaders(),
    });
  }

  async function deleteSupabaseRowByStateKeyViaRest(rowKey) {
    const normalizedRowKey = normalizeString(rowKey || '');
    if (!normalizedRowKey) {
      return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
    }

    const requestUrl = buildSupabaseStateTableRestUrl({
      state_key: `eq.${normalizedRowKey}`,
    });
    if (!requestUrl.ok) return buildRestRequestError(requestUrl.error);

    return performRestRequest(requestUrl.url, {
      method: 'DELETE',
      headers: buildRestHeaders({
        Prefer: 'return=minimal',
      }),
    });
  }

  function getSupabaseClient(options = {}) {
    if (!isSupabaseConfigured()) return null;
    const safeOrigin = getSafeSupabaseOrigin();
    if (!safeOrigin.ok) return null;
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
    const supabaseClient = createClient(safeOrigin.origin, supabaseServiceRoleKey, clientOptions);
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

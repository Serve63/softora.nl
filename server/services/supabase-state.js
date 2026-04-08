const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

function createSupabaseStateStore(deps = {}) {
  const {
    supabaseUrl = '',
    supabaseServiceRoleKey = '',
    supabaseStateTable = '',
    supabaseStateKey = '',
    supabaseCallUpdateStateKeyPrefix = '',
    supabaseCallUpdateRowsFetchLimit = 1000,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    createClient = createSupabaseClient,
    fetchImpl = globalThis.fetch,
  } = deps;

  let supabaseClient = null;

  function isSupabaseConfigured() {
    return Boolean(supabaseUrl && supabaseServiceRoleKey);
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

  async function performRestRequest(url, options = {}) {
    if (!isSupabaseConfigured()) {
      return { ok: false, status: null, body: null, error: 'Supabase niet geconfigureerd.' };
    }
    if (typeof fetchImpl !== 'function') {
      return { ok: false, status: null, body: null, error: 'Fetch is niet beschikbaar.' };
    }

    try {
      const response = await fetchImpl(url, options);
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      return { ok: response.ok, status: response.status, body, error: null };
    } catch (error) {
      return {
        ok: false,
        status: null,
        body: null,
        error: truncateText(error?.message || String(error), 500),
      };
    }
  }

  async function fetchStateRowViaRest(selectColumns = 'payload,updated_at') {
    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url =
      `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}` +
      `?select=${encodeURIComponent(selectColumns)}` +
      `&state_key=eq.${encodeURIComponent(supabaseStateKey)}` +
      '&limit=1';

    return performRestRequest(url, {
      method: 'GET',
      headers: buildRestHeaders(),
    });
  }

  async function upsertStateRowViaRest(row) {
    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?on_conflict=state_key`;

    return performRestRequest(url, {
      method: 'POST',
      headers: buildRestHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify([row]),
    });
  }

  async function fetchRowByKeyViaRest(rowKey, selectColumns = 'payload,updated_at') {
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

    return performRestRequest(url, {
      method: 'GET',
      headers: buildRestHeaders(),
    });
  }

  async function upsertRowViaRest(row) {
    const stateKey = normalizeString(row?.state_key || '');
    if (!stateKey) {
      return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
    }

    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?on_conflict=state_key`;

    return performRestRequest(url, {
      method: 'POST',
      headers: buildRestHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify([row]),
    });
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

  function getSupabaseClient() {
    if (!isSupabaseConfigured()) return null;
    if (supabaseClient) return supabaseClient;
    supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return supabaseClient;
  }

  return {
    buildSupabaseCallUpdateStateKey,
    extractCallIdFromSupabaseCallUpdateStateKey,
    fetchSupabaseCallUpdateRowsViaRest,
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

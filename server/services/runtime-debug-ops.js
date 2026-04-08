function createRuntimeDebugOpsCoordinator(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    supabaseUrl = '',
    supabaseStateTable = '',
    supabaseStateKey = '',
    supabaseServiceRoleKey = '',
    redactSupabaseUrlForDebug = (value) => String(value || ''),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    fetchImpl = (...args) => fetch(...args),
    getBeforeState = () => ({}),
    persistRuntimeStateToSupabase = async () => false,
    resetHydrationState = () => {},
    ensureRuntimeStateHydratedFromSupabase = async () => false,
    getAfterState = () => ({}),
  } = deps;

  async function sendSupabaseProbeResponse(_req, res) {
    if (!isSupabaseConfigured()) {
      return res.status(200).json({
        ok: false,
        configured: false,
        error: 'Supabase niet geconfigureerd.',
      });
    }

    const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(
      supabaseStateTable
    )}?select=state_key&limit=1`;

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
        },
      });

      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = truncateText(text, 800);
      }

      return res.status(200).json({
        ok: response.ok,
        configured: true,
        status: response.status,
        supabaseHost: redactSupabaseUrlForDebug(supabaseUrl),
        table: supabaseStateTable,
        stateKey: supabaseStateKey,
        hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
        body,
      });
    } catch (error) {
      return res.status(200).json({
        ok: false,
        configured: true,
        status: null,
        supabaseHost: redactSupabaseUrlForDebug(supabaseUrl),
        table: supabaseStateTable,
        stateKey: supabaseStateKey,
        hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
        error: truncateText(error?.message || String(error), 500),
      });
    }
  }

  async function sendRuntimeSyncNowResponse(_req, res) {
    const before = getBeforeState();
    const persistOk = await persistRuntimeStateToSupabase('debug_runtime_sync_now');

    resetHydrationState();
    const hydratedOk = await ensureRuntimeStateHydratedFromSupabase();

    return res.status(200).json({
      ok: Boolean(persistOk && hydratedOk),
      before,
      after: getAfterState(),
      persistOk,
      hydratedOk,
      supabase: {
        host: redactSupabaseUrlForDebug(supabaseUrl),
        table: supabaseStateTable,
        stateKey: supabaseStateKey,
      },
    });
  }

  return {
    sendRuntimeSyncNowResponse,
    sendSupabaseProbeResponse,
  };
}

module.exports = {
  createRuntimeDebugOpsCoordinator,
};

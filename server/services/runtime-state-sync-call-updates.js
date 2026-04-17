function createRuntimeStateSyncCallUpdateHelpers(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    fetchSupabaseCallUpdateRowsViaRest = async () => ({ ok: false }),
    upsertSupabaseRowViaRest = async () => ({ ok: false }),
    supabaseStateTable = '',
    supabaseCallUpdateStateKeyPrefix = '',
    supabaseCallUpdateRowsFetchLimit = 500,
    supabaseClientPersistTimeoutMs = 12000,
    runtimeStateSupabaseSyncCooldownMs = 4000,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    parseNumberSafe = (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    buildSupabaseCallUpdateStateKey = () => '',
    extractSupabaseCallUpdateFromRow = () => null,
    buildSupabaseCallUpdatePayload = () => null,
    compactRuntimeSnapshotCallUpdate = (item) => item,
    upsertRecentCallUpdate = () => null,
    getRuntimeSnapshotItemTimestampMs = () => 0,
    awaitWithTimeout = async (promise) => await promise,
    logError = () => {},
    recentCallUpdates = [],
    callUpdatesById = new Map(),
    runtimeState = {},
  } = deps;

  async function fetchSupabaseCallUpdateRows(limit = supabaseCallUpdateRowsFetchLimit) {
    if (!isSupabaseConfigured()) {
      return { ok: false, status: null, rows: [], error: 'Supabase niet geconfigureerd.' };
    }

    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || supabaseCallUpdateRowsFetchLimit));
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client
          .from(supabaseStateTable)
          .select('state_key,payload,updated_at')
          .like('state_key', `${supabaseCallUpdateStateKeyPrefix}%`)
          .order('updated_at', { ascending: false })
          .limit(safeLimit);
        if (!error) {
          return {
            ok: true,
            status: 200,
            rows: Array.isArray(data) ? data : [],
            error: null,
          };
        }
      } catch {
        // Val terug op REST wanneer client query faalt.
      }
    }

    const fallback = await fetchSupabaseCallUpdateRowsViaRest(safeLimit);
    return {
      ok: Boolean(fallback.ok),
      status: fallback.status,
      rows: Array.isArray(fallback.body) ? fallback.body : [],
      error: fallback.error || null,
    };
  }

  function buildCallUpdateRowPersistMeta(callUpdate, reason = 'call_update_row') {
    return {
      reason: truncateText(normalizeString(reason || ''), 80) || 'call_update_row',
      callId: truncateText(normalizeString(callUpdate?.callId || ''), 140),
      status: truncateText(normalizeString(callUpdate?.status || ''), 80),
      provider: truncateText(normalizeString(callUpdate?.provider || ''), 40),
      updatedAt: normalizeString(callUpdate?.updatedAt || '') || new Date().toISOString(),
    };
  }

  async function persistSingleCallUpdateRowToSupabase(callUpdate, reason = 'call_update_row') {
    if (!isSupabaseConfigured()) return false;
    const compact = compactRuntimeSnapshotCallUpdate(callUpdate || {});
    const callId = normalizeString(compact?.callId || '');
    if (!callId || callId.startsWith('demo-')) return false;

    const stateKey = buildSupabaseCallUpdateStateKey(callId);
    if (!stateKey) return false;

    const payload = buildSupabaseCallUpdatePayload(compact, reason);
    if (!payload) return false;

    const updatedAt = normalizeString(compact?.updatedAt || '') || new Date().toISOString();
    const row = {
      state_key: stateKey,
      payload,
      updated_at: updatedAt,
      meta: buildCallUpdateRowPersistMeta(compact, reason),
    };

    const client = getSupabaseClient();
    if (client) {
      try {
        const result = await awaitWithTimeout(
          client.from(supabaseStateTable).upsert(row, {
            onConflict: 'state_key',
          }),
          supabaseClientPersistTimeoutMs,
          `Supabase call-update persist timeout na ${Math.round(
            Math.max(1000, Math.min(60000, Number(supabaseClientPersistTimeoutMs) || 12000)) / 1000
          )}s`
        );
        const error = result?.error || null;
        if (!error) {
          runtimeState.supabaseLastCallUpdatePersistError = '';
          return true;
        }
        const fallback = await upsertSupabaseRowViaRest(row);
        if (fallback.ok) {
          runtimeState.supabaseLastCallUpdatePersistError = '';
          return true;
        }
        const fallbackMsg = fallback.error
          ? ` | REST fallback: ${fallback.error}`
          : fallback.status
            ? ` | REST fallback status: ${fallback.status}`
            : '';
        runtimeState.supabaseLastCallUpdatePersistError = truncateText(
          `${error.message || String(error)}${fallbackMsg}`,
          500
        );
        return false;
      } catch (error) {
        const fallback = await upsertSupabaseRowViaRest(row);
        if (fallback.ok) {
          runtimeState.supabaseLastCallUpdatePersistError = '';
          return true;
        }
        const fallbackMsg = fallback.error
          ? ` | REST fallback: ${fallback.error}`
          : fallback.status
            ? ` | REST fallback status: ${fallback.status}`
            : '';
        runtimeState.supabaseLastCallUpdatePersistError = truncateText(
          `${error?.message || String(error)}${fallbackMsg}`,
          500
        );
        return false;
      }
    }

    const fallback = await upsertSupabaseRowViaRest(row);
    if (fallback.ok) {
      runtimeState.supabaseLastCallUpdatePersistError = '';
      return true;
    }
    runtimeState.supabaseLastCallUpdatePersistError = truncateText(
      fallback.error || `REST fallback status: ${fallback.status || 'onbekend'}`,
      500
    );
    return false;
  }

  function queueCallUpdateRowPersist(callUpdate, reason = 'call_update_row') {
    if (!isSupabaseConfigured()) return Promise.resolve(false);
    const callId = normalizeString(callUpdate?.callId || '');
    if (!callId || callId.startsWith('demo-')) return Promise.resolve(false);

    runtimeState.supabaseCallUpdatePersistChain = runtimeState.supabaseCallUpdatePersistChain
      .catch(() => null)
      .then(() => persistSingleCallUpdateRowToSupabase(callUpdate, reason))
      .catch((error) => {
        runtimeState.supabaseLastCallUpdatePersistError = truncateText(error?.message || String(error), 500);
        return false;
      });

    return runtimeState.supabaseCallUpdatePersistChain;
  }

  async function waitForQueuedCallUpdateRowPersist() {
    if (!isSupabaseConfigured()) return false;
    try {
      return Boolean(await runtimeState.supabaseCallUpdatePersistChain);
    } catch (error) {
      logError('[Supabase][CallUpdatePersistAwaitError]', error?.message || error);
      return false;
    }
  }

  function mergeCallUpdatesFromSupabaseRows(rows = []) {
    let touched = 0;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const callUpdate = extractSupabaseCallUpdateFromRow(row);
      if (!callUpdate) return;
      const before = callUpdatesById.get(callUpdate.callId) || null;
      const after = upsertRecentCallUpdate(callUpdate, {
        persistRuntimeState: false,
        persistCallUpdateRow: false,
      });
      if (!after) return;
      const beforeMs = getRuntimeSnapshotItemTimestampMs(before || {});
      const afterMs = getRuntimeSnapshotItemTimestampMs(after || {});
      if (!before || afterMs > beforeMs) {
        touched += 1;
      }
    });
    return touched;
  }

  async function syncCallUpdatesFromSupabaseRows(options = {}) {
    if (!isSupabaseConfigured()) return false;

    const force = Boolean(options?.force);
    const maxAgeMs = Math.max(
      0,
      parseNumberSafe(options?.maxAgeMs, runtimeStateSupabaseSyncCooldownMs) || runtimeStateSupabaseSyncCooldownMs
    );
    const nowMs = Date.now();

    if (
      !force &&
      runtimeState.supabaseCallUpdatesLastSyncCheckMs > 0 &&
      nowMs - runtimeState.supabaseCallUpdatesLastSyncCheckMs < maxAgeMs
    ) {
      return false;
    }

    await waitForQueuedCallUpdateRowPersist();
    const rowsResult = await fetchSupabaseCallUpdateRows(supabaseCallUpdateRowsFetchLimit);
    runtimeState.supabaseCallUpdatesLastSyncCheckMs = Date.now();
    if (!rowsResult.ok) {
      if (rowsResult.error) {
        runtimeState.supabaseLastHydrateError = truncateText(rowsResult.error, 500);
      }
      return false;
    }

    const touched = mergeCallUpdatesFromSupabaseRows(rowsResult.rows || []);
    return touched > 0;
  }

  return {
    buildCallUpdateRowPersistMeta,
    fetchSupabaseCallUpdateRows,
    mergeCallUpdatesFromSupabaseRows,
    persistSingleCallUpdateRowToSupabase,
    queueCallUpdateRowPersist,
    syncCallUpdatesFromSupabaseRows,
    waitForQueuedCallUpdateRowPersist,
  };
}

module.exports = {
  createRuntimeStateSyncCallUpdateHelpers,
};

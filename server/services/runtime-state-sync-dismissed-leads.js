function createRuntimeStateSyncDismissedLeadHelpers(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    supabaseDismissedLeadsStateKey = '',
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false }),
    upsertSupabaseRowViaRest = async () => ({ ok: false }),
    normalizeString = (value) => String(value || '').trim(),
    logError = () => {},
    dismissedInterestedLeadCallIds = new Set(),
    dismissedInterestedLeadKeys = new Set(),
    dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map(),
    runtimeState = {},
  } = deps;

  async function readRemoteDismissedLeadsState() {
    if (!isSupabaseConfigured() || !supabaseDismissedLeadsStateKey) return null;
    try {
      const result = await fetchSupabaseRowByKeyViaRest(supabaseDismissedLeadsStateKey, 'payload');
      if (!result?.ok) return null;
      const row = Array.isArray(result.body) ? result.body[0] || null : result.body;
      if (!row?.payload || typeof row.payload !== 'object') return null;

      const callIds = new Set();
      (Array.isArray(row.payload.callIds) ? row.payload.callIds : []).forEach((item) => {
        const value = normalizeString(item);
        if (value) callIds.add(value);
      });

      const leadKeys = new Set();
      (Array.isArray(row.payload.leadKeys) ? row.payload.leadKeys : []).forEach((item) => {
        const value = normalizeString(item);
        if (value) leadKeys.add(value);
      });

      const fallbackUpdatedAtMs =
        Date.parse(normalizeString(row?.payload?.updatedAt || row?.updated_at || row?.updatedAt || '')) || 0;
      const rawMap =
        row.payload.leadKeyUpdatedAtMsByKey && typeof row.payload.leadKeyUpdatedAtMsByKey === 'object'
          ? row.payload.leadKeyUpdatedAtMsByKey
          : {};
      const leadKeyUpdatedAtMsByKey = new Map();
      leadKeys.forEach((leadKey) => {
        const raw = Number(rawMap?.[leadKey] || fallbackUpdatedAtMs || 0);
        if (Number.isFinite(raw) && raw > 0) {
          leadKeyUpdatedAtMsByKey.set(leadKey, Math.round(raw));
        }
      });

      return { callIds, leadKeys, leadKeyUpdatedAtMsByKey };
    } catch (error) {
      logError('[Supabase][DismissedLeadsReadError]', error?.message || error);
      return null;
    }
  }

  async function hydrateDismissedLeadsFromSupabase() {
    const remoteState = await readRemoteDismissedLeadsState();
    if (!remoteState) return false;

    remoteState.callIds.forEach((callId) => {
      dismissedInterestedLeadCallIds.add(callId);
    });
    remoteState.leadKeys.forEach((leadKey) => {
      dismissedInterestedLeadKeys.add(leadKey);
    });
    remoteState.leadKeyUpdatedAtMsByKey.forEach((updatedAtMs, leadKey) => {
      const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(leadKey) || 0);
      if (updatedAtMs >= currentMs) {
        dismissedInterestedLeadKeyUpdatedAtMsByKey.set(leadKey, Math.round(updatedAtMs));
      }
    });
    runtimeState.dismissedLeadsLastHydrateAtMs = Date.now();
    return true;
  }

  async function ensureDismissedLeadsFreshFromSupabase(options = {}) {
    if (!isSupabaseConfigured() || !supabaseDismissedLeadsStateKey) return false;
    const force = Boolean(options?.force);
    const maxAgeMs = Math.max(0, Number.isFinite(Number(options?.maxAgeMs)) ? Number(options.maxAgeMs) : 2000);
    const lastMs = Number(runtimeState.dismissedLeadsLastHydrateAtMs || 0);
    const nowMs = Date.now();
    if (!force && lastMs > 0 && nowMs - lastMs < maxAgeMs) {
      return false;
    }
    return hydrateDismissedLeadsFromSupabase();
  }

  async function persistDismissedLeadsToSupabase(reason = 'dismissed_leads_persist') {
    if (!isSupabaseConfigured() || !supabaseDismissedLeadsStateKey) return false;

    const maxAttempts = 3;
    let lastResultOk = false;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      const remoteState = await readRemoteDismissedLeadsState();
      const remoteCallIds = remoteState?.callIds instanceof Set ? remoteState.callIds : new Set();
      const remoteLeadKeys = remoteState?.leadKeys instanceof Set ? remoteState.leadKeys : new Set();
      const remoteLeadKeyUpdatedAtMs =
        remoteState?.leadKeyUpdatedAtMsByKey instanceof Map ? remoteState.leadKeyUpdatedAtMsByKey : new Map();

      const mergedCallIds = new Set();
      dismissedInterestedLeadCallIds.forEach((id) => {
        const value = normalizeString(id);
        if (value) mergedCallIds.add(value);
      });
      remoteCallIds.forEach((id) => {
        const value = normalizeString(id);
        if (value) mergedCallIds.add(value);
      });

      const mergedLeadKeys = new Set();
      dismissedInterestedLeadKeys.forEach((key) => {
        const value = normalizeString(key);
        if (value) mergedLeadKeys.add(value);
      });
      remoteLeadKeys.forEach((key) => {
        const value = normalizeString(key);
        if (value) mergedLeadKeys.add(value);
      });

      const mergedLeadKeyUpdatedAtMs = new Map();
      mergedLeadKeys.forEach((key) => {
        const localMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(key) || 0);
        const remoteMs = Number(remoteLeadKeyUpdatedAtMs.get(key) || 0);
        const best = Math.max(
          Number.isFinite(localMs) && localMs > 0 ? localMs : 0,
          Number.isFinite(remoteMs) && remoteMs > 0 ? remoteMs : 0
        );
        if (best > 0) mergedLeadKeyUpdatedAtMs.set(key, Math.round(best));
      });

      mergedCallIds.forEach((id) => dismissedInterestedLeadCallIds.add(id));
      mergedLeadKeys.forEach((key) => dismissedInterestedLeadKeys.add(key));
      mergedLeadKeyUpdatedAtMs.forEach((ms, key) => {
        const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(key) || 0);
        if (ms > currentMs) {
          dismissedInterestedLeadKeyUpdatedAtMsByKey.set(key, ms);
        }
      });

      const callIds = Array.from(mergedCallIds).slice(0, 1000);
      const leadKeys = Array.from(mergedLeadKeys).slice(0, 2000);
      const leadKeyUpdatedAtMsByKey = Object.fromEntries(
        leadKeys
          .map((leadKey) => [leadKey, Number(mergedLeadKeyUpdatedAtMs.get(leadKey) || 0)])
          .filter(([, ms]) => Number.isFinite(ms) && ms > 0)
      );
      if (!callIds.length && !leadKeys.length) return true;

      let writeOk = false;
      try {
        const updatedAt = new Date().toISOString();
        const result = await upsertSupabaseRowViaRest({
          state_key: supabaseDismissedLeadsStateKey,
          payload: {
            callIds,
            leadKeys,
            leadKeyUpdatedAtMsByKey,
            updatedAt,
            reason,
            attempt,
          },
          updated_at: updatedAt,
        });
        writeOk = Boolean(result?.ok);
        lastResultOk = writeOk;
      } catch (error) {
        logError('[Supabase][DismissedLeadsPersistError]', error?.message || error);
        writeOk = false;
        lastResultOk = false;
      }

      if (!writeOk) {
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
          continue;
        }
        return false;
      }

      const verification = await readRemoteDismissedLeadsState();
      if (!verification) {
        runtimeState.dismissedLeadsLastHydrateAtMs = Date.now();
        return true;
      }

      const verifyCallIds = verification.callIds;
      const verifyLeadKeys = verification.leadKeys;

      let allCallIdsPresent = true;
      for (const id of dismissedInterestedLeadCallIds) {
        if (!verifyCallIds.has(id)) {
          allCallIdsPresent = false;
          break;
        }
      }
      let allLeadKeysPresent = true;
      if (allCallIdsPresent) {
        for (const key of dismissedInterestedLeadKeys) {
          if (!verifyLeadKeys.has(key)) {
            allLeadKeysPresent = false;
            break;
          }
        }
      }

      if (allCallIdsPresent && allLeadKeysPresent) {
        runtimeState.dismissedLeadsLastHydrateAtMs = Date.now();
        return true;
      }

      logError('[Supabase][DismissedLeadsRaceDetected]', `attempt ${attempt}/${maxAttempts}, retry merge & write`);
      verifyCallIds.forEach((id) => dismissedInterestedLeadCallIds.add(id));
      verifyLeadKeys.forEach((key) => dismissedInterestedLeadKeys.add(key));
      verification.leadKeyUpdatedAtMsByKey.forEach((ms, key) => {
        const currentMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(key) || 0);
        if (ms > currentMs) {
          dismissedInterestedLeadKeyUpdatedAtMsByKey.set(key, ms);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }

    return lastResultOk;
  }

  return {
    ensureDismissedLeadsFreshFromSupabase,
    hydrateDismissedLeadsFromSupabase,
    persistDismissedLeadsToSupabase,
    readRemoteDismissedLeadsState,
  };
}

module.exports = {
  createRuntimeStateSyncDismissedLeadHelpers,
};

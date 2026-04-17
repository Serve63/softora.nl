function createCallUpdateStore(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLen = 80) => String(value || '').slice(0, maxLen),
    resolveCallUpdateTimestamp = (update) => ({
      updatedAt: normalizeString(update?.updatedAt || ''),
      updatedAtMs: Number(update?.updatedAtMs || 0) || 0,
    }),
    callUpdatesById = new Map(),
    recentCallUpdates = [],
    isTerminalColdcallingStatus = () => false,
    retellCallStatusRefreshByCallId = new Map(),
    queueRuntimeStatePersist = () => null,
    queueCallUpdateRowPersist = () => null,
  } = deps;

  function resolveMergedNonNegativeNumber(nextValue, previousValue, decimals = null) {
    const next = Number(nextValue);
    if (Number.isFinite(next) && next >= 0) {
      if (Number.isFinite(decimals) && decimals >= 0) {
        const factor = 10 ** decimals;
        return Math.round(next * factor) / factor;
      }
      return next;
    }

    const previous = Number(previousValue);
    if (Number.isFinite(previous) && previous >= 0) {
      if (Number.isFinite(decimals) && decimals >= 0) {
        const factor = 10 ** decimals;
        return Math.round(previous * factor) / factor;
      }
      return previous;
    }

    return null;
  }

  function upsertRecentCallUpdate(update, options = {}) {
    if (!update) return null;

    const normalizedCallId = normalizeString(update?.callId || '');
    if (!normalizedCallId) return null;

    const persistRuntimeState = options?.persistRuntimeState !== false;
    const persistCallUpdateRow = options?.persistCallUpdateRow !== false;
    const persistReason = truncateText(normalizeString(options?.persistReason || ''), 80) || 'call_update';

    const existing = callUpdatesById.get(normalizedCallId);
    const { updatedAt: resolvedUpdatedAt, updatedAtMs: resolvedUpdatedAtMs } = resolveCallUpdateTimestamp(
      update,
      existing
    );

    const normalizedUpdate = {
      ...update,
      callId: normalizedCallId,
      updatedAt: resolvedUpdatedAt,
      updatedAtMs: resolvedUpdatedAtMs,
    };

    const merged = existing
      ? {
          ...existing,
          ...normalizedUpdate,
          phone: normalizedUpdate.phone || existing.phone || '',
          company: normalizedUpdate.company || existing.company || '',
          branche: normalizedUpdate.branche || existing.branche || '',
          region: normalizedUpdate.region || existing.region || '',
          province: normalizedUpdate.province || existing.province || '',
          address: normalizedUpdate.address || existing.address || '',
          name: normalizedUpdate.name || existing.name || '',
          status: normalizedUpdate.status || existing.status || '',
          summary: normalizedUpdate.summary || existing.summary || '',
          transcriptSnippet: normalizedUpdate.transcriptSnippet || existing.transcriptSnippet || '',
          transcriptFull: normalizedUpdate.transcriptFull || existing.transcriptFull || '',
          endedReason: normalizedUpdate.endedReason || existing.endedReason || '',
          startedAt: normalizedUpdate.startedAt || existing.startedAt || '',
          endedAt: normalizedUpdate.endedAt || existing.endedAt || '',
          durationSeconds:
            Number.isFinite(Number(normalizedUpdate.durationSeconds)) && Number(normalizedUpdate.durationSeconds) > 0
              ? Math.round(Number(normalizedUpdate.durationSeconds))
              : Number.isFinite(Number(existing.durationSeconds)) && Number(existing.durationSeconds) > 0
                ? Math.round(Number(existing.durationSeconds))
                : null,
          recordingUrl: normalizedUpdate.recordingUrl || existing.recordingUrl || '',
          recordingSid: normalizedUpdate.recordingSid || existing.recordingSid || '',
          recordingUrlProxy: normalizedUpdate.recordingUrlProxy || existing.recordingUrlProxy || '',
          provider: normalizedUpdate.provider || existing.provider || '',
          direction: normalizedUpdate.direction || existing.direction || '',
          stack: normalizedUpdate.stack || existing.stack || '',
          stackLabel: normalizedUpdate.stackLabel || existing.stackLabel || '',
          messageType: normalizedUpdate.messageType || existing.messageType || '',
          costUsd: resolveMergedNonNegativeNumber(normalizedUpdate.costUsd, existing.costUsd, 3),
          costUsdMilli: resolveMergedNonNegativeNumber(
            normalizedUpdate.costUsdMilli,
            existing.costUsdMilli
          ),
          updatedAt: resolvedUpdatedAt,
          updatedAtMs: resolvedUpdatedAtMs,
        }
      : normalizedUpdate;

    callUpdatesById.set(merged.callId, merged);

    if (isTerminalColdcallingStatus(merged.status, merged.endedReason)) {
      retellCallStatusRefreshByCallId.delete(merged.callId);
    }

    const existingIndex = recentCallUpdates.findIndex((item) => item.callId === merged.callId);
    if (existingIndex >= 0) {
      recentCallUpdates.splice(existingIndex, 1);
    }
    recentCallUpdates.unshift(merged);
    if (recentCallUpdates.length > 500) {
      const removed = recentCallUpdates.pop();
      if (removed) {
        callUpdatesById.delete(removed.callId);
      }
    }

    if (persistRuntimeState) {
      queueRuntimeStatePersist(persistReason);
    }
    if (persistCallUpdateRow) {
      queueCallUpdateRowPersist(merged, persistReason);
    }

    return merged;
  }

  return {
    upsertRecentCallUpdate,
  };
}

module.exports = {
  createCallUpdateStore,
};

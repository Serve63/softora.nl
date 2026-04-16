const {
  logLeadTrace,
  summarizeLeadRow,
} = require('./lead-trace');

function createAgendaInterestedLeadStateService(deps = {}) {
  const {
    dismissedInterestedLeadCallIds = new Set(),
    dismissedInterestedLeadKeys = new Set(),
    dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map(),
    normalizeString = (value) => String(value || '').trim(),
    buildLeadFollowUpCandidateKey = () => '',
    queueRuntimeStatePersist = () => null,
    persistDismissedLeadsToSupabase = async () => false,
    getGeneratedAgendaAppointments = () => [],
    mapAppointmentToConfirmationTask = () => null,
    setGeneratedAgendaAppointmentAtIndex = () => null,
  } = deps;

  function getInterestedLeadRowTimestampMs(rowLike = {}) {
    const explicitMs = Number(rowLike?.updatedAtMs || 0);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

    const candidateFields = [
      rowLike?.confirmationTaskCreatedAt,
      rowLike?.createdAt,
      rowLike?.updatedAt,
      rowLike?.endedAt,
      rowLike?.analyzedAt,
      rowLike?.startedAt,
    ];

    for (const candidate of candidateFields) {
      const parsedMs = Date.parse(normalizeString(candidate || ''));
      if (Number.isFinite(parsedMs) && parsedMs > 0) return parsedMs;
    }

    return 0;
  }

  function addDismissedInterestedLeadCallId(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId || dismissedInterestedLeadCallIds.has(normalizedCallId)) return false;
    dismissedInterestedLeadCallIds.add(normalizedCallId);
    return true;
  }

  function addDismissedInterestedLeadKey(leadKey) {
    const normalizedLeadKey = normalizeString(leadKey);
    if (!normalizedLeadKey || dismissedInterestedLeadKeys.has(normalizedLeadKey)) return false;
    dismissedInterestedLeadKeys.add(normalizedLeadKey);
    return true;
  }

  function isInterestedLeadDismissed(callId) {
    const normalizedCallId = normalizeString(callId);
    if (normalizedCallId && dismissedInterestedLeadCallIds.has(normalizedCallId)) return true;
    return false;
  }

  function isInterestedLeadDismissedByKey(leadKey) {
    const normalizedLeadKey = normalizeString(leadKey);
    return Boolean(normalizedLeadKey && dismissedInterestedLeadKeys.has(normalizedLeadKey));
  }

  function getInterestedLeadKeyDismissedAtMs(leadKey) {
    const normalizedLeadKey = normalizeString(leadKey);
    if (!normalizedLeadKey) return 0;
    const storedMs = Number(dismissedInterestedLeadKeyUpdatedAtMsByKey.get(normalizedLeadKey) || 0);
    return Number.isFinite(storedMs) && storedMs > 0 ? storedMs : 0;
  }

  function upsertDismissedInterestedLeadKeyTimestamp(leadKey, updatedAtMs = Date.now()) {
    const normalizedLeadKey = normalizeString(leadKey);
    const nextMs = Number(updatedAtMs || 0);
    if (!normalizedLeadKey || !Number.isFinite(nextMs) || nextMs <= 0) return false;
    const currentMs = getInterestedLeadKeyDismissedAtMs(normalizedLeadKey);
    if (currentMs >= nextMs) return false;
    dismissedInterestedLeadKeyUpdatedAtMsByKey.set(normalizedLeadKey, Math.round(nextMs));
    return true;
  }

  function isInterestedLeadDismissedForRow(callId, rowLike) {
    const normalizedCallId = normalizeString(callId);
    const leadKey = buildLeadFollowUpCandidateKey(rowLike || {});
    const dismissedByKey = isInterestedLeadDismissedByKey(leadKey);
    if (normalizedCallId) {
      const dismissedByCallId = isInterestedLeadDismissed(normalizedCallId);
      if (dismissedByCallId) return true;
      if (!dismissedByCallId && dismissedByKey) {
        const dismissedAtMs = getInterestedLeadKeyDismissedAtMs(leadKey);
        const rowTimestampMs = getInterestedLeadRowTimestampMs(rowLike || {});
        if (dismissedAtMs > 0 && rowTimestampMs <= 0) {
          logLeadTrace('dismiss-state', 'call-id-hidden-while-key-dismissed-without-row-timestamp', {
            callId: normalizedCallId,
            leadKey,
            dismissedAtMs,
            rowTimestampMs: 0,
            row: summarizeLeadRow(rowLike),
          });
          return true;
        }
        if (dismissedAtMs > 0 && rowTimestampMs > 0 && rowTimestampMs <= dismissedAtMs) {
          return true;
        }
        logLeadTrace('dismiss-state', 'call-id-visible-while-key-dismissed', {
          callId: normalizedCallId,
          leadKey,
          dismissedAtMs: dismissedAtMs || 0,
          rowTimestampMs: rowTimestampMs || 0,
          row: summarizeLeadRow(rowLike),
        });
      }
      return false;
    }
    return dismissedByKey;
  }

  function dismissInterestedLeadCallId(callId, reason = 'interested_lead_dismissed') {
    const changed = addDismissedInterestedLeadCallId(callId);
    if (!changed) return false;
    queueRuntimeStatePersist(reason);
    return true;
  }

  function dismissInterestedLeadKey(leadKey, reason = 'interested_lead_dismissed') {
    const changed = addDismissedInterestedLeadKey(leadKey);
    const timestampChanged = changed ? upsertDismissedInterestedLeadKeyTimestamp(leadKey) : false;
    if (!changed && !timestampChanged) return false;
    queueRuntimeStatePersist(reason);
    return true;
  }

  function dismissInterestedLeadIdentity(callId, rowLike, reason = 'interested_lead_dismissed', options = {}) {
    const relatedCallIds = Array.isArray(options?.relatedCallIds) ? options.relatedCallIds : [];
    const normalizedCallIds = Array.from(
      new Set([callId].concat(relatedCallIds).map((item) => normalizeString(item || '')).filter(Boolean))
    );
    const leadKey = buildLeadFollowUpCandidateKey(rowLike || {});
    const dismissedAtMs = Math.max(Date.now(), getInterestedLeadRowTimestampMs(rowLike || {}));
    let callIdsChanged = false;
    normalizedCallIds.forEach((id) => {
      if (addDismissedInterestedLeadCallId(id)) callIdsChanged = true;
    });
    const keyChanged = addDismissedInterestedLeadKey(leadKey);
    let changed = callIdsChanged || keyChanged;
    if (changed && upsertDismissedInterestedLeadKeyTimestamp(leadKey, dismissedAtMs)) {
      changed = true;
    }
    if (changed) {
      logLeadTrace('dismiss-state', 'identity-dismissed', {
        reason,
        callId: normalizeString(callId || ''),
        relatedCallIds: normalizedCallIds,
        leadKey,
        dismissedAtMs,
        row: summarizeLeadRow(rowLike),
      });
      queueRuntimeStatePersist(reason);
      persistDismissedLeadsToSupabase(reason).catch(() => {});
    }
    return changed;
  }

  function clearDismissedInterestedLeadCallId(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return false;
    return dismissedInterestedLeadCallIds.delete(normalizedCallId);
  }

  function cancelOpenLeadFollowUpTasksByIdentity(
    callId,
    rowLike,
    actor = '',
    reason = 'interested_lead_dismissed_manual_cancel'
  ) {
    const normalizedCallId = normalizeString(callId || '');
    const identityKey = buildLeadFollowUpCandidateKey(rowLike || {});
    if (!normalizedCallId && !identityKey) return 0;

    const nowIso = new Date().toISOString();
    let cancelledCount = 0;
    getGeneratedAgendaAppointments().forEach((appointment, idx) => {
      if (!appointment || !mapAppointmentToConfirmationTask(appointment)) return;
      const appointmentCallId = normalizeString(appointment?.callId || '');
      const appointmentKey = buildLeadFollowUpCandidateKey(appointment);
      const matchesCallId = Boolean(normalizedCallId && appointmentCallId && appointmentCallId === normalizedCallId);
      const matchesKey = Boolean(identityKey && appointmentKey && appointmentKey === identityKey);
      if (!matchesCallId && !matchesKey) return;

      setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          confirmationResponseReceived: false,
          confirmationResponseReceivedAt: null,
          confirmationResponseReceivedBy: null,
          confirmationAppointmentCancelled: true,
          confirmationAppointmentCancelledAt: nowIso,
          confirmationAppointmentCancelledBy: actor || null,
        },
        reason
      );
      cancelledCount += 1;
    });

    return cancelledCount;
  }

  return {
    cancelOpenLeadFollowUpTasksByIdentity,
    clearDismissedInterestedLeadCallId,
    dismissInterestedLeadCallId,
    dismissInterestedLeadIdentity,
    dismissInterestedLeadKey,
    isInterestedLeadDismissed,
    isInterestedLeadDismissedByKey,
    isInterestedLeadDismissedForRow,
    getInterestedLeadKeyDismissedAtMs,
  };
}

module.exports = {
  createAgendaInterestedLeadStateService,
};

function createRuntimeStateSnapshotHelpers(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    normalizeLeadOwnerRecord = () => null,
    compactRuntimeSnapshotWebhookEvent = (item) => item,
    compactRuntimeSnapshotCallUpdate = (item) => item,
    compactRuntimeSnapshotAiInsight = (item) => item,
    compactRuntimeSnapshotDashboardActivity = (item) => item,
    compactRuntimeSnapshotSecurityAuditEvent = (item) => item,
    compactRuntimeSnapshotGeneratedAgendaAppointment = (item) => item,
  } = deps;

  function getRuntimeSnapshotItemTimestampMs(item) {
    const explicitMs = Number(item?.updatedAtMs || 0);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

    const candidateFields = [
      item?.updatedAt,
      item?.analyzedAt,
      item?.receivedAt,
      item?.endedAt,
      item?.startedAt,
      item?.confirmationEmailSentAt,
      item?.confirmationResponseReceivedAt,
      item?.confirmationAppointmentCancelledAt,
      item?.postCallUpdatedAt,
      item?.createdAt,
    ];

    for (const candidate of candidateFields) {
      const parsedMs = Date.parse(normalizeString(candidate || ''));
      if (Number.isFinite(parsedMs) && parsedMs > 0) return parsedMs;
    }

    return 0;
  }

  function chooseRuntimeSnapshotValue(primaryValue, fallbackValue) {
    if (primaryValue === undefined || primaryValue === null) return fallbackValue;
    if (typeof primaryValue === 'string') {
      return primaryValue.trim() ? primaryValue : fallbackValue;
    }
    if (Array.isArray(primaryValue)) {
      return primaryValue.length > 0
        ? primaryValue.slice()
        : Array.isArray(fallbackValue)
          ? fallbackValue.slice()
          : primaryValue.slice();
    }
    return primaryValue;
  }

  function mergeRuntimeSnapshotObjects(primary, fallback) {
    const safePrimary = primary && typeof primary === 'object' ? primary : {};
    const safeFallback = fallback && typeof fallback === 'object' ? fallback : {};
    const merged = { ...safeFallback };
    const keys = new Set([...Object.keys(safeFallback), ...Object.keys(safePrimary)]);
    keys.forEach((key) => {
      merged[key] = chooseRuntimeSnapshotValue(safePrimary[key], safeFallback[key]);
    });
    return merged;
  }

  function mergeRuntimeSnapshotArraysByKey(localItems, remoteItems, keyFn, limit = 500) {
    const mergedByKey = new Map();
    const append = (items) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const key = normalizeString(keyFn(item) || '');
        if (!key) return;
        const existing = mergedByKey.get(key) || null;
        if (!existing) {
          mergedByKey.set(key, item);
          return;
        }
        const existingTs = getRuntimeSnapshotItemTimestampMs(existing);
        const incomingTs = getRuntimeSnapshotItemTimestampMs(item);
        const primary = incomingTs >= existingTs ? item : existing;
        const fallback = incomingTs >= existingTs ? existing : item;
        mergedByKey.set(key, mergeRuntimeSnapshotObjects(primary, fallback));
      });
    };

    append(remoteItems);
    append(localItems);

    return Array.from(mergedByKey.values())
      .sort((a, b) => getRuntimeSnapshotItemTimestampMs(b) - getRuntimeSnapshotItemTimestampMs(a))
      .slice(0, limit);
  }

  function mergeRuntimeSnapshotPayloads(localPayload, remotePayload) {
    const safeLocal = localPayload && typeof localPayload === 'object' ? localPayload : {};
    const safeRemote = remotePayload && typeof remotePayload === 'object' ? remotePayload : {};
    const localLeadOwnerAssignments = (
      Array.isArray(safeLocal.leadOwnerAssignments) ? safeLocal.leadOwnerAssignments : []
    )
      .map((item) => ({
        callId: normalizeString(item?.callId || ''),
        owner: normalizeLeadOwnerRecord(item?.owner || {}),
      }))
      .filter((item) => item.callId && item.owner);
    const remoteLeadOwnerAssignments = (
      Array.isArray(safeRemote.leadOwnerAssignments) ? safeRemote.leadOwnerAssignments : []
    )
      .map((item) => ({
        callId: normalizeString(item?.callId || ''),
        owner: normalizeLeadOwnerRecord(item?.owner || {}),
      }))
      .filter((item) => item.callId && item.owner);
    const localGeneratedAgendaAppointments = (
      Array.isArray(safeLocal.generatedAgendaAppointments) ? safeLocal.generatedAgendaAppointments : []
    )
      .map(compactRuntimeSnapshotGeneratedAgendaAppointment)
      .filter(Boolean);
    const remoteGeneratedAgendaAppointments = (
      Array.isArray(safeRemote.generatedAgendaAppointments) ? safeRemote.generatedAgendaAppointments : []
    )
      .map(compactRuntimeSnapshotGeneratedAgendaAppointment)
      .filter(Boolean);
    const localWebhookEvents = (
      Array.isArray(safeLocal.recentWebhookEvents) ? safeLocal.recentWebhookEvents : []
    ).map(compactRuntimeSnapshotWebhookEvent);
    const remoteWebhookEvents = (
      Array.isArray(safeRemote.recentWebhookEvents) ? safeRemote.recentWebhookEvents : []
    ).map(compactRuntimeSnapshotWebhookEvent);
    const localCallUpdates = (
      Array.isArray(safeLocal.recentCallUpdates) ? safeLocal.recentCallUpdates : []
    )
      .map(compactRuntimeSnapshotCallUpdate)
      .filter((item) => normalizeString(item?.callId || ''));
    const remoteCallUpdates = (
      Array.isArray(safeRemote.recentCallUpdates) ? safeRemote.recentCallUpdates : []
    )
      .map(compactRuntimeSnapshotCallUpdate)
      .filter((item) => normalizeString(item?.callId || ''));
    const localAiCallInsights = (
      Array.isArray(safeLocal.recentAiCallInsights) ? safeLocal.recentAiCallInsights : []
    )
      .map(compactRuntimeSnapshotAiInsight)
      .filter((item) => normalizeString(item?.callId || ''));
    const remoteAiCallInsights = (
      Array.isArray(safeRemote.recentAiCallInsights) ? safeRemote.recentAiCallInsights : []
    )
      .map(compactRuntimeSnapshotAiInsight)
      .filter((item) => normalizeString(item?.callId || ''));
    const localDashboardActivities = (
      Array.isArray(safeLocal.recentDashboardActivities) ? safeLocal.recentDashboardActivities : []
    )
      .map(compactRuntimeSnapshotDashboardActivity)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const remoteDashboardActivities = (
      Array.isArray(safeRemote.recentDashboardActivities) ? safeRemote.recentDashboardActivities : []
    )
      .map(compactRuntimeSnapshotDashboardActivity)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const localSecurityAuditEvents = (
      Array.isArray(safeLocal.recentSecurityAuditEvents) ? safeLocal.recentSecurityAuditEvents : []
    )
      .map(compactRuntimeSnapshotSecurityAuditEvent)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const remoteSecurityAuditEvents = (
      Array.isArray(safeRemote.recentSecurityAuditEvents) ? safeRemote.recentSecurityAuditEvents : []
    )
      .map(compactRuntimeSnapshotSecurityAuditEvent)
      .filter((item) => normalizeString(item?.id || item?.type || item?.createdAt || ''));
    const remoteDismissedCallIds = (
      Array.isArray(safeRemote.dismissedInterestedLeadCallIds)
        ? safeRemote.dismissedInterestedLeadCallIds
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const localDismissedCallIds = (
      Array.isArray(safeLocal.dismissedInterestedLeadCallIds)
        ? safeLocal.dismissedInterestedLeadCallIds
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const remoteDismissedLeadKeys = (
      Array.isArray(safeRemote.dismissedInterestedLeadKeys)
        ? safeRemote.dismissedInterestedLeadKeys
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const localDismissedLeadKeys = (
      Array.isArray(safeLocal.dismissedInterestedLeadKeys)
        ? safeLocal.dismissedInterestedLeadKeys
        : []
    )
      .map((item) => normalizeString(item))
      .filter(Boolean);
    const localDismissedLeadKeyUpdatedAtMsByKey =
      safeLocal.dismissedInterestedLeadKeyUpdatedAtMsByKey &&
      typeof safeLocal.dismissedInterestedLeadKeyUpdatedAtMsByKey === 'object'
        ? safeLocal.dismissedInterestedLeadKeyUpdatedAtMsByKey
        : safeLocal.dismissedLeadKeyUpdatedAtMsByKey && typeof safeLocal.dismissedLeadKeyUpdatedAtMsByKey === 'object'
          ? safeLocal.dismissedLeadKeyUpdatedAtMsByKey
          : {};
    const remoteDismissedLeadKeyUpdatedAtMsByKey =
      safeRemote.dismissedInterestedLeadKeyUpdatedAtMsByKey &&
      typeof safeRemote.dismissedInterestedLeadKeyUpdatedAtMsByKey === 'object'
        ? safeRemote.dismissedInterestedLeadKeyUpdatedAtMsByKey
        : safeRemote.dismissedLeadKeyUpdatedAtMsByKey &&
            typeof safeRemote.dismissedLeadKeyUpdatedAtMsByKey === 'object'
          ? safeRemote.dismissedLeadKeyUpdatedAtMsByKey
          : {};

    const leadOwnerAssignments = mergeRuntimeSnapshotArraysByKey(
      localLeadOwnerAssignments,
      remoteLeadOwnerAssignments,
      (item) => item?.callId || '',
      5000
    );

    const mergedAppointments = mergeRuntimeSnapshotArraysByKey(
      localGeneratedAgendaAppointments,
      remoteGeneratedAgendaAppointments,
      (item) => String(item?.id || item?.callId || ''),
      5000
    );

    const mergedWebhookEvents = mergeRuntimeSnapshotArraysByKey(
      localWebhookEvents,
      remoteWebhookEvents,
      (item) =>
        `${normalizeString(item?.receivedAt || '')}|${normalizeString(item?.messageType || '')}|${normalizeString(item?.callId || '')}`,
      80
    );

    const mergedCallUpdates = mergeRuntimeSnapshotArraysByKey(
      localCallUpdates,
      remoteCallUpdates,
      (item) => item?.callId || '',
      500
    );

    const mergedAiCallInsights = mergeRuntimeSnapshotArraysByKey(
      localAiCallInsights,
      remoteAiCallInsights,
      (item) => item?.callId || '',
      500
    );

    const mergedDashboardActivities = mergeRuntimeSnapshotArraysByKey(
      localDashboardActivities,
      remoteDashboardActivities,
      (item) => item?.id || '',
      500
    );

    const mergedSecurityAuditEvents = mergeRuntimeSnapshotArraysByKey(
      localSecurityAuditEvents,
      remoteSecurityAuditEvents,
      (item) => item?.id || '',
      500
    );

    const mergedDismissedCallIds = Array.from(
      new Set([...remoteDismissedCallIds, ...localDismissedCallIds].filter(Boolean))
    ).slice(0, 1000);
    const mergedDismissedLeadKeys = Array.from(
      new Set([...remoteDismissedLeadKeys, ...localDismissedLeadKeys].filter(Boolean))
    ).slice(0, 2000);
    const mergedDismissedLeadKeyUpdatedAtMsByKey = Object.fromEntries(
      mergedDismissedLeadKeys
        .map((leadKey) => {
          const localMs = Number(localDismissedLeadKeyUpdatedAtMsByKey?.[leadKey] || 0);
          const remoteMs = Number(remoteDismissedLeadKeyUpdatedAtMsByKey?.[leadKey] || 0);
          const nextMs = Math.max(localMs, remoteMs);
          return [leadKey, Number.isFinite(nextMs) && nextMs > 0 ? Math.round(nextMs) : 0];
        })
        .filter(([, updatedAtMs]) => Number.isFinite(updatedAtMs) && updatedAtMs > 0)
    );

    return {
      version: Math.max(Number(safeLocal.version || 0), Number(safeRemote.version || 0), 5),
      savedAt: new Date().toISOString(),
      recentWebhookEvents: mergedWebhookEvents,
      recentCallUpdates: mergedCallUpdates,
      recentAiCallInsights: mergedAiCallInsights,
      recentDashboardActivities: mergedDashboardActivities,
      recentSecurityAuditEvents: mergedSecurityAuditEvents,
      generatedAgendaAppointments: mergedAppointments,
      dismissedInterestedLeadCallIds: mergedDismissedCallIds,
      dismissedInterestedLeadKeys: mergedDismissedLeadKeys,
      dismissedInterestedLeadKeyUpdatedAtMsByKey: mergedDismissedLeadKeyUpdatedAtMsByKey,
      leadOwnerAssignments,
      nextLeadOwnerRotationIndex: Math.max(
        0,
        Number(safeLocal.nextLeadOwnerRotationIndex || 0),
        Number(safeRemote.nextLeadOwnerRotationIndex || 0)
      ),
      nextGeneratedAgendaAppointmentId: Math.max(
        100000,
        Number(safeLocal.nextGeneratedAgendaAppointmentId || 0),
        Number(safeRemote.nextGeneratedAgendaAppointmentId || 0),
        ...mergedAppointments
          .map((item) => Number(item?.id || 0) + 1)
          .filter((value) => Number.isFinite(value) && value > 0)
      ),
    };
  }

  function resolveRuntimeStateVersionMs(updatedAt = '', payload = null) {
    const candidates = [normalizeString(updatedAt), normalizeString(payload?.savedAt || '')];
    for (const candidate of candidates) {
      const parsedMs = Date.parse(candidate);
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        return parsedMs;
      }
    }
    return 0;
  }

  return {
    getRuntimeSnapshotItemTimestampMs,
    mergeRuntimeSnapshotPayloads,
    resolveRuntimeStateVersionMs,
  };
}

module.exports = {
  createRuntimeStateSnapshotHelpers,
};

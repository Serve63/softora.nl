const { createRuntimeBackupCoordinator } = require('./runtime-backup');
const { createRuntimeStateSyncCoordinator } = require('./runtime-state-sync');
const { createCallUpdateStore } = require('./call-update-store');

function createRuntimeSyncRuntime(deps = {}) {
  const {
    normalizeString,
    truncateText,
    parseNumberSafe,
    toBooleanSafe,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    resolveCallDurationSeconds,
    normalizeLeadOwnerRecord,
    recentWebhookEvents,
    recentCallUpdates,
    recentAiCallInsights,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    getNextLeadOwnerRotationIndex,
    getNextGeneratedAgendaAppointmentId,
    getPublicFeatureFlags,
    routeManifest,
    appName,
    appVersion,
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseStateRowViaRest,
    upsertSupabaseStateRowViaRest,
    fetchSupabaseCallUpdateRowsViaRest,
    upsertSupabaseRowViaRest,
    fetchSupabaseRowByKeyViaRest,
    supabaseStateTable,
    supabaseStateKey,
    supabaseDismissedLeadsStateKey,
    supabaseCallUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit,
    runtimeStateSupabaseSyncCooldownMs,
    runtimeStateRemoteNewerThresholdMs,
    buildSupabaseCallUpdateStateKey,
    extractCallIdFromSupabaseCallUpdateStateKey,
    callUpdatesById,
    aiCallInsightsByCallId,
    agendaAppointmentIdByCallId,
    resolveCallUpdateTimestamp,
    logger = console,
    runtimeState,
    isTerminalColdcallingStatus,
    retellCallStatusRefreshByCallId,
  } = deps;

  let upsertRecentCallUpdate = () => null;

  const runtimeBackupCoordinator = createRuntimeBackupCoordinator({
    normalizeString,
    truncateText,
    parseNumberSafe,
    toBooleanSafe,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    resolveCallDurationSeconds,
    normalizeLeadOwnerRecord,
    recentWebhookEvents,
    recentCallUpdates,
    recentAiCallInsights,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    getNextLeadOwnerRotationIndex,
    getNextGeneratedAgendaAppointmentId,
    appName,
    appVersion,
    getPublicFeatureFlags,
    routeManifest,
  });

  const {
    buildRuntimeBackupForOps,
    buildRuntimeStateSnapshotPayloadWithLimits,
    buildSupabaseCallUpdatePayload,
    compactRuntimeSnapshotAiInsight,
    compactRuntimeSnapshotCallUpdate,
    compactRuntimeSnapshotDashboardActivity,
    compactRuntimeSnapshotGeneratedAgendaAppointment,
    compactRuntimeSnapshotSecurityAuditEvent,
    compactRuntimeSnapshotWebhookEvent,
    extractSupabaseCallUpdateFromRow: extractSupabaseCallUpdateFromRowFromSnapshot,
  } = runtimeBackupCoordinator;

  function extractSupabaseCallUpdateFromRow(row) {
    return extractSupabaseCallUpdateFromRowFromSnapshot(row, {
      extractCallIdFromStateKey: extractCallIdFromSupabaseCallUpdateStateKey,
    });
  }

  const runtimeStateSyncCoordinator = createRuntimeStateSyncCoordinator({
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseStateRowViaRest,
    upsertSupabaseStateRowViaRest,
    fetchSupabaseCallUpdateRowsViaRest,
    upsertSupabaseRowViaRest,
    fetchSupabaseRowByKeyViaRest,
    supabaseStateTable,
    supabaseStateKey,
    supabaseDismissedLeadsStateKey,
    supabaseCallUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit,
    runtimeStateSupabaseSyncCooldownMs,
    runtimeStateRemoteNewerThresholdMs,
    normalizeString,
    truncateText,
    parseNumberSafe,
    buildSupabaseCallUpdateStateKey,
    extractSupabaseCallUpdateFromRow,
    buildSupabaseCallUpdatePayload,
    buildRuntimeStateSnapshotPayloadWithLimits,
    compactRuntimeSnapshotWebhookEvent,
    compactRuntimeSnapshotCallUpdate,
    compactRuntimeSnapshotAiInsight,
    compactRuntimeSnapshotDashboardActivity,
    compactRuntimeSnapshotSecurityAuditEvent,
    compactRuntimeSnapshotGeneratedAgendaAppointment,
    normalizeLeadOwnerRecord,
    recentWebhookEvents,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    upsertRecentCallUpdate: (...args) => upsertRecentCallUpdate(...args),
    logger,
    runtimeState,
  });

  const {
    applyRuntimeStateSnapshotPayload,
    buildCallUpdateRowPersistMeta,
    ensureDismissedLeadsFreshFromSupabase,
    ensureRuntimeStateHydratedFromSupabase,
    forceHydrateRuntimeStateWithRetries,
    hydrateDismissedLeadsFromSupabase,
    invalidateSupabaseSyncTimestamp,
    persistRuntimeStateToSupabase,
    queueCallUpdateRowPersist,
    syncCallUpdatesFromSupabaseRows,
    syncRuntimeStateFromSupabaseIfNewer,
    waitForQueuedCallUpdateRowPersist,
    waitForQueuedRuntimeSnapshotPersist,
    waitForQueuedRuntimeStatePersist,
    persistDismissedLeadsToSupabase,
  } = runtimeStateSyncCoordinator;

  const queueRuntimeStatePersist = (reason = 'unknown') =>
    runtimeStateSyncCoordinator.queueRuntimeStatePersist(reason);

  const buildRuntimeStateSnapshotPayload = () => buildRuntimeStateSnapshotPayloadWithLimits();

  const callUpdateStore = createCallUpdateStore({
    normalizeString,
    truncateText,
    resolveCallUpdateTimestamp,
    callUpdatesById,
    recentCallUpdates,
    isTerminalColdcallingStatus,
    retellCallStatusRefreshByCallId,
    queueRuntimeStatePersist,
    queueCallUpdateRowPersist,
  });

  upsertRecentCallUpdate = (...args) => callUpdateStore.upsertRecentCallUpdate(...args);

  return {
    applyRuntimeStateSnapshotPayload,
    buildCallUpdateRowPersistMeta,
    buildRuntimeBackupForOps,
    buildRuntimeStateSnapshotPayload,
    buildRuntimeStateSnapshotPayloadWithLimits,
    ensureDismissedLeadsFreshFromSupabase,
    ensureRuntimeStateHydratedFromSupabase,
    extractSupabaseCallUpdateFromRow,
    forceHydrateRuntimeStateWithRetries,
    hydrateDismissedLeadsFromSupabase,
    invalidateSupabaseSyncTimestamp,
    persistDismissedLeadsToSupabase,
    persistRuntimeStateToSupabase,
    queueCallUpdateRowPersist,
    queueRuntimeStatePersist,
    syncCallUpdatesFromSupabaseRows,
    syncRuntimeStateFromSupabaseIfNewer,
    upsertRecentCallUpdate,
    waitForQueuedCallUpdateRowPersist,
    waitForQueuedRuntimeSnapshotPersist,
    waitForQueuedRuntimeStatePersist,
  };
}

module.exports = {
  createRuntimeSyncRuntime,
};

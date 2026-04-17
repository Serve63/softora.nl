function createRuntimeMemoryState() {
  const recentWebhookEvents = [];
  const recentCallUpdates = [];
  const callUpdatesById = new Map();
  const retellCallStatusRefreshByCallId = new Map();
  const recentAiCallInsights = [];
  const recentDashboardActivities = [];
  const recentSecurityAuditEvents = [];
  const inMemoryUiStateByScope = new Map();
  const aiCallInsightsByCallId = new Map();
  const aiAnalysisFingerprintByCallId = new Map();
  const aiAnalysisInFlightCallIds = new Set();
  const callRecordingTranscriptionPromiseByCallId = new Map();
  const generatedAgendaAppointments = [];
  const agendaAppointmentIdByCallId = new Map();
  const dismissedInterestedLeadCallIds = new Set();
  const dismissedInterestedLeadKeys = new Set();
  const dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map();
  const leadOwnerAssignmentsByCallId = new Map();
  const sequentialDispatchQueues = new Map();
  const sequentialDispatchQueueIdByCallId = new Map();

  let nextLeadOwnerRotationIndex = 0;
  let nextGeneratedAgendaAppointmentId = 100000;
  let nextSequentialDispatchQueueId = 1;

  const confirmationMailRuntimeState = {
    smtpTransporter: null,
    inboundConfirmationMailSyncPromise: null,
    inboundConfirmationMailSyncNotBeforeMs: 0,
    inboundConfirmationMailSyncLastResult: null,
  };

  let supabaseStateHydrationPromise = null;
  let supabaseStateHydrated = false;
  let supabasePersistChain = Promise.resolve(true);
  let supabaseCallUpdatePersistChain = Promise.resolve(true);
  let supabaseHydrateRetryNotBeforeMs = 0;
  let supabaseLastHydrateError = '';
  let supabaseLastPersistError = '';
  let supabaseLastCallUpdatePersistError = '';
  let runtimeStateObservedAtMs = 0;
  let runtimeStateLastSupabaseSyncCheckMs = 0;
  let supabaseCallUpdatesLastSyncCheckMs = 0;

  const runtimeStateSyncState = {
    get supabaseStateHydrationPromise() {
      return supabaseStateHydrationPromise;
    },
    set supabaseStateHydrationPromise(value) {
      supabaseStateHydrationPromise = value;
    },
    get supabaseStateHydrated() {
      return supabaseStateHydrated;
    },
    set supabaseStateHydrated(value) {
      supabaseStateHydrated = Boolean(value);
    },
    get supabasePersistChain() {
      return supabasePersistChain;
    },
    set supabasePersistChain(value) {
      supabasePersistChain = value;
    },
    get supabaseCallUpdatePersistChain() {
      return supabaseCallUpdatePersistChain;
    },
    set supabaseCallUpdatePersistChain(value) {
      supabaseCallUpdatePersistChain = value;
    },
    get supabaseHydrateRetryNotBeforeMs() {
      return supabaseHydrateRetryNotBeforeMs;
    },
    set supabaseHydrateRetryNotBeforeMs(value) {
      supabaseHydrateRetryNotBeforeMs = Number(value) || 0;
    },
    get supabaseLastHydrateError() {
      return supabaseLastHydrateError;
    },
    set supabaseLastHydrateError(value) {
      supabaseLastHydrateError = String(value || '');
    },
    get supabaseLastPersistError() {
      return supabaseLastPersistError;
    },
    set supabaseLastPersistError(value) {
      supabaseLastPersistError = String(value || '');
    },
    get supabaseLastCallUpdatePersistError() {
      return supabaseLastCallUpdatePersistError;
    },
    set supabaseLastCallUpdatePersistError(value) {
      supabaseLastCallUpdatePersistError = String(value || '');
    },
    get runtimeStateObservedAtMs() {
      return runtimeStateObservedAtMs;
    },
    set runtimeStateObservedAtMs(value) {
      runtimeStateObservedAtMs = Number(value) || 0;
    },
    get runtimeStateLastSupabaseSyncCheckMs() {
      return runtimeStateLastSupabaseSyncCheckMs;
    },
    set runtimeStateLastSupabaseSyncCheckMs(value) {
      runtimeStateLastSupabaseSyncCheckMs = Number(value) || 0;
    },
    get supabaseCallUpdatesLastSyncCheckMs() {
      return supabaseCallUpdatesLastSyncCheckMs;
    },
    set supabaseCallUpdatesLastSyncCheckMs(value) {
      supabaseCallUpdatesLastSyncCheckMs = Number(value) || 0;
    },
    get nextLeadOwnerRotationIndex() {
      return nextLeadOwnerRotationIndex;
    },
    set nextLeadOwnerRotationIndex(value) {
      nextLeadOwnerRotationIndex = Number(value) || 0;
    },
    get nextGeneratedAgendaAppointmentId() {
      return nextGeneratedAgendaAppointmentId;
    },
    set nextGeneratedAgendaAppointmentId(value) {
      nextGeneratedAgendaAppointmentId = Number(value) || 0;
    },
  };

  return {
    recentWebhookEvents,
    recentCallUpdates,
    callUpdatesById,
    retellCallStatusRefreshByCallId,
    recentAiCallInsights,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    inMemoryUiStateByScope,
    aiCallInsightsByCallId,
    aiAnalysisFingerprintByCallId,
    aiAnalysisInFlightCallIds,
    callRecordingTranscriptionPromiseByCallId,
    generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId,
    confirmationMailRuntimeState,
    runtimeStateSyncState,
    getNextLeadOwnerRotationIndex: () => nextLeadOwnerRotationIndex,
    setNextLeadOwnerRotationIndex: (value) => {
      nextLeadOwnerRotationIndex = Number(value) || 0;
    },
    getNextGeneratedAgendaAppointmentId: () => nextGeneratedAgendaAppointmentId,
    takeNextGeneratedAgendaAppointmentId: () => nextGeneratedAgendaAppointmentId++,
    createSequentialDispatchQueueId: () => `seq-${nextSequentialDispatchQueueId++}`,
  };
}

module.exports = {
  createRuntimeMemoryState,
};

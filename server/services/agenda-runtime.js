const { createAgendaInterestedLeadStateService } = require('./agenda-interested-lead-state');
const { createAgendaInterestedLeadReadService } = require('./agenda-interested-lead-read');
const { createAgendaLeadFollowUpService } = require('./agenda-lead-follow-up');
const { createAgendaAppointmentUpsertService } = require('./agenda-appointment-upsert');
const { createAgendaInterestedLeadsCoordinator } = require('./agenda-interested-leads');
const { createAgendaManualAppointmentCoordinator } = require('./agenda-manual-appointment');
const { createAgendaPostCallCoordinator } = require('./agenda-post-call');
const { createAgendaConfirmationCoordinator } = require('./agenda-confirmation');
const { createAgendaReadCoordinator } = require('./agenda-read');
const { createAgendaRetellCoordinator } = require('./agenda-retell');
const { createAgendaPageBootstrapService } = require('./agenda-page-bootstrap');
const { createCustomersPageBootstrapService } = require('./customers-page-bootstrap');
const { createLeadsPageBootstrapService } = require('./leads-page-bootstrap');
const { createColdcallingDashboardBootstrapService } = require('./coldcalling-dashboard-bootstrap');

function normalizePostCallStatus(value, normalizeString, truncateText) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return 'customer_wants_to_proceed';
  if (raw === 'customer_wants_to_proceed') return raw;
  if (raw === 'klant_wil_door') return 'customer_wants_to_proceed';
  return truncateText(raw, 80);
}

function sanitizePostCallText(value, normalizeString, truncateText, maxLen = 20000) {
  return truncateText(normalizeString(value || ''), maxLen);
}

function createAgendaRuntime(deps = {}) {
  const {
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    recentCallUpdates,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    runtimeStateSyncState,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe,
    normalizeColdcallingStack,
    getColdcallingStackLabel,
    buildGeneratedLeadFollowUpFromCall,
    buildLeadOwnerFields,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    resolvePreferredRecordingUrl,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    resolveAgendaLocationValue,
    queueRuntimeStatePersist,
    persistDismissedLeadsToSupabase,
    mapAppointmentToConfirmationTask,
    compareConfirmationTasks,
    getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex,
    buildConfirmationEmailDraftFallback,
    takeNextGeneratedAgendaAppointmentId,
    normalizeEmailAddress,
    isSupabaseConfigured,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    getLatestCallUpdateByCallId,
    formatEuroLabel,
    appendDashboardActivity,
    buildRuntimeStateSnapshotPayload,
    applyRuntimeStateSnapshotPayload,
    waitForQueuedRuntimeSnapshotPersist,
    invalidateSupabaseSyncTimestamp,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    agendaPostCallHelpers,
    getUiStateValues,
    setUiStateValues,
    premiumActiveOrdersScope,
    premiumActiveCustomOrdersKey,
    openAiApiBaseUrl,
    openAiModel,
    runtimeSyncCooldownMs,
    pickReadableConversationSummaryForLeadDetail,
    getAppointmentTranscriptText,
    resolveAppointmentCallId,
    inferCallProvider,
    refreshCallUpdateFromTwilioStatusApi,
    refreshCallUpdateFromRetellStatusApi,
    buildCallBackedLeadDetail,
    buildConversationSummaryForLeadDetail,
    getOpenAiApiKey,
    fetchJsonWithTimeout,
    extractOpenAiTextContent,
    isImapMailConfigured,
    syncInboundConfirmationEmailsFromImap,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    isLikelyValidEmail,
    isSmtpMailConfigured,
    getMissingSmtpMailEnv,
    sendConfirmationEmailViaSmtp,
    buildLeadToAgendaSummary,
    extractTwilioRecordingSidFromUrl,
    isTwilioStatusApiConfigured,
    fetchTwilioRecordingsByCallId,
    choosePreferredTwilioRecording,
    buildTwilioRecordingMediaUrl,
    fetchBinaryWithTimeout,
    getTwilioBasicAuthorizationHeader,
    buildRecordingFileNameForTranscription,
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    getOpenAiTranscriptionModelCandidates,
    parseJsonLoose,
    demoConfirmationTaskEnabled,
    ensureDismissedLeadsFreshFromSupabase,
    refreshAgendaAppointmentCallSourcesIfNeeded,
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
    refreshGeneratedAgendaSummariesIfNeeded,
    isGeneratedAppointmentVisibleForAgenda,
    compareAgendaAppointments,
  } = deps;

  async function syncConfirmationMailResponse(req, res) {
    if (isSupabaseConfigured() && !runtimeStateSyncState.supabaseStateHydrated) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    const result = await syncInboundConfirmationEmailsFromImap({
      force: true,
      maxMessages: Math.max(10, Math.min(400, deps.parseIntSafe(req.body?.maxMessages, 120))),
    });
    return res.status(result?.ok === false && !result?.skipped ? 500 : 200).json({
      ok: result?.ok !== false,
      sync: result || null,
    });
  }

  let agendaInterestedLeadReadService = null;
  let agendaInterestedLeadStateService = null;

  agendaInterestedLeadStateService = createAgendaInterestedLeadStateService({
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    normalizeString,
    buildLeadFollowUpCandidateKey: (...args) =>
      agendaInterestedLeadReadService?.buildLeadFollowUpCandidateKey(...args) || '',
    queueRuntimeStatePersist,
    persistDismissedLeadsToSupabase,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    mapAppointmentToConfirmationTask,
    setGeneratedAgendaAppointmentAtIndex,
  });

  const {
    cancelOpenLeadFollowUpTasksByIdentity,
    dismissInterestedLeadIdentity,
    isInterestedLeadDismissedForRow,
  } = agendaInterestedLeadStateService;

  agendaInterestedLeadReadService = createAgendaInterestedLeadReadService({
    getRecentCallUpdates: () => recentCallUpdates,
    getRecentAiCallInsights: () => recentAiCallInsights,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    mapAppointmentToConfirmationTask,
    compareConfirmationTasks,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe,
    normalizeColdcallingStack,
    getColdcallingStackLabel,
    buildGeneratedLeadFollowUpFromCall,
    buildLeadOwnerFields,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    resolvePreferredRecordingUrl,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    resolveAgendaLocationValue,
    isInterestedLeadDismissedForRow: (...args) =>
      agendaInterestedLeadStateService.isInterestedLeadDismissedForRow(...args),
    hasNegativeInterestSignal: deps.hasNegativeInterestSignal,
    hasPositiveInterestSignal: deps.hasPositiveInterestSignal,
  });

  const {
    buildAllInterestedLeadRows,
    collectInterestedLeadCallIdsByIdentity,
    buildLatestInterestedLeadRowsByKey,
    buildLeadFollowUpCandidateKey,
    findInterestedLeadRowByCallId,
    getLeadLikeRecencyTimestamp,
  } = agendaInterestedLeadReadService;

  const agendaLeadFollowUpService = createAgendaLeadFollowUpService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    mapAppointmentToConfirmationTask,
    normalizeString,
    buildLeadFollowUpCandidateKey,
    getLeadLikeRecencyTimestamp,
    buildLatestInterestedLeadRowsByKey,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    sanitizeAppointmentWhatsappInfo,
    resolvePreferredRecordingUrl,
    normalizeColdcallingStack,
    queueRuntimeStatePersist,
  });

  const {
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    findReusableLeadFollowUpAppointmentIndex,
  } = agendaLeadFollowUpService;

  const agendaAppointmentUpsertService = createAgendaAppointmentUpsertService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex,
    findReusableLeadFollowUpAppointmentIndex,
    buildConfirmationEmailDraftFallback,
    takeNextGeneratedAgendaAppointmentId,
    queueRuntimeStatePersist,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    toBooleanSafe,
    normalizeEmailAddress,
  });

  const { upsertGeneratedAgendaAppointment } = agendaAppointmentUpsertService;

  const agendaManualAppointmentCoordinator = createAgendaManualAppointmentCoordinator({
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex,
    upsertGeneratedAgendaAppointment,
    appendDashboardActivity,
    buildRuntimeStateSnapshotPayload,
    applyRuntimeStateSnapshotPayload,
    waitForQueuedRuntimeSnapshotPersist,
    invalidateSupabaseSyncTimestamp,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
    truncateText,
  });

  const agendaInterestedLeadsCoordinator = createAgendaInterestedLeadsCoordinator({
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    toBooleanSafe,
    agendaAppointmentIdByCallId,
    getGeneratedAppointmentIndexById,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    findInterestedLeadRowByCallId,
    buildAllInterestedLeadRows,
    buildLeadFollowUpCandidateKey,
    collectInterestedLeadCallIdsByIdentity,
    getLatestCallUpdateByCallId,
    aiCallInsightsByCallId,
    buildGeneratedLeadFollowUpFromCall,
    normalizeColdcallingStack,
    getColdcallingStackLabel,
    buildLeadOwnerFields,
    normalizeEmailAddress,
    formatEuroLabel,
    truncateText,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    resolvePreferredRecordingUrl,
    resolveAgendaLocationValue,
    upsertGeneratedAgendaAppointment,
    buildLeadToAgendaSummary,
    setGeneratedAgendaAppointmentAtIndex,
    dismissInterestedLeadIdentity,
    persistDismissedLeadsToSupabase,
    ensureDismissedLeadsFreshFromSupabase,
    appendDashboardActivity,
    cancelOpenLeadFollowUpTasksByIdentity,
    buildRuntimeStateSnapshotPayload,
    applyRuntimeStateSnapshotPayload,
    waitForQueuedRuntimeSnapshotPersist,
    invalidateSupabaseSyncTimestamp,
  });

  const agendaPostCallCoordinator = createAgendaPostCallCoordinator({
    normalizeString,
    truncateText,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    sanitizePostCallText: (value, maxLen) =>
      sanitizePostCallText(value, normalizeString, truncateText, maxLen),
    normalizePostCallStatus: (value) => normalizePostCallStatus(value, normalizeString, truncateText),
    getGeneratedAppointmentIndexById,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    setGeneratedAgendaAppointmentAtIndex,
    appendDashboardActivity,
    getUiStateValues,
    setUiStateValues,
    premiumActiveOrdersScope,
    premiumActiveCustomOrdersKey,
    helpers: agendaPostCallHelpers,
  });

  const agendaConfirmationCoordinator = createAgendaConfirmationCoordinator({
    openAiApiBaseUrl,
    openAiModel,
    runtimeSyncCooldownMs,
    aiCallInsightsByCallId,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex,
    mapAppointmentToConfirmationTask,
    getLatestCallUpdateByCallId,
    pickReadableConversationSummaryForLeadDetail,
    getAppointmentTranscriptText,
    resolvePreferredRecordingUrl,
    sanitizeAppointmentLocation,
    resolveAgendaLocationValue,
    sanitizeAppointmentWhatsappInfo,
    resolveCallDurationSeconds,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    normalizeEmailAddress,
    truncateText,
    toBooleanSafe,
    resolveAppointmentCallId,
    inferCallProvider,
    refreshCallUpdateFromTwilioStatusApi,
    refreshCallUpdateFromRetellStatusApi,
    buildCallBackedLeadDetail,
    buildConversationSummaryForLeadDetail,
    buildConfirmationEmailDraftFallback,
    getOpenAiApiKey,
    fetchJsonWithTimeout,
    extractOpenAiTextContent,
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    isImapMailConfigured,
    syncInboundConfirmationEmailsFromImap,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    isLikelyValidEmail,
    isSmtpMailConfigured,
    getMissingSmtpMailEnv,
    sendConfirmationEmailViaSmtp,
    appendDashboardActivity,
    buildLeadToAgendaSummary,
    dismissInterestedLeadIdentity,
    extractTwilioRecordingSidFromUrl,
    isTwilioStatusApiConfigured,
    fetchTwilioRecordingsByCallId,
    choosePreferredTwilioRecording,
    buildTwilioRecordingMediaUrl,
    fetchBinaryWithTimeout,
    getTwilioBasicAuthorizationHeader,
    buildRecordingFileNameForTranscription,
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    getOpenAiTranscriptionModelCandidates,
    parseJsonLoose,
    buildRuntimeStateSnapshotPayload,
    applyRuntimeStateSnapshotPayload,
    waitForQueuedRuntimeSnapshotPersist,
    invalidateSupabaseSyncTimestamp,
  });

  const agendaReadCoordinator = createAgendaReadCoordinator({
    runtimeSyncCooldownMs,
    demoConfirmationTaskEnabled,
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    ensureDismissedLeadsFreshFromSupabase,
    isImapMailConfigured,
    syncInboundConfirmationEmailsFromImap,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    refreshAgendaAppointmentCallSourcesIfNeeded,
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
    refreshGeneratedAgendaSummariesIfNeeded,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    isGeneratedAppointmentVisibleForAgenda,
    compareAgendaAppointments,
    mapAppointmentToConfirmationTask,
    ensureConfirmationEmailDraftAtIndex:
      agendaConfirmationCoordinator.ensureConfirmationEmailDraftAtIndex,
    compareConfirmationTasks,
    buildAllInterestedLeadRows,
    isInterestedLeadDismissedForRow: (...args) =>
      agendaInterestedLeadStateService.isInterestedLeadDismissedForRow(...args),
    normalizeString,
  });

  const agendaPageBootstrapService = createAgendaPageBootstrapService({
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    isGeneratedAppointmentVisibleForAgenda,
    compareAgendaAppointments,
  });

  const customersPageBootstrapService = createCustomersPageBootstrapService({
    getUiStateValues,
    normalizeString,
    customerScope: deps.premiumCustomersScope,
    customerKey: deps.premiumCustomersKey,
    orderScope: premiumActiveOrdersScope,
    orderKey: premiumActiveCustomOrdersKey,
  });

  const leadsPageBootstrapService = createLeadsPageBootstrapService({
    agendaReadCoordinator,
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    getUiStateValues,
    normalizeString,
    leadDatabaseUiScope: deps.leadDatabaseUiScope,
    leadDatabaseRowsStorageKey: deps.leadDatabaseRowsStorageKey,
  });

  const coldcallingDashboardBootstrapService = createColdcallingDashboardBootstrapService({
    agendaReadCoordinator,
    getUiStateValues,
    getRecentCallUpdates: () => recentCallUpdates,
    getRecentAiCallInsights: () => recentAiCallInsights,
    normalizeString,
  });

  const agendaRetellCoordinator = createAgendaRetellCoordinator({
    isSupabaseConfigured,
    getSupabaseStateHydrated: () => runtimeStateSyncState.supabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    isGeneratedAppointmentVisibleForAgenda,
    compareAgendaAppointments,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
  });

  async function buildRuntimeHtmlPageBootstrapData(_req, fileName) {
    if (fileName === 'premium-personeel-agenda.html') {
      return {
        marker: 'SOFTORA_AGENDA_BOOTSTRAP',
        scriptId: 'softoraAgendaBootstrap',
        data: await agendaPageBootstrapService.buildAgendaBootstrapPayload({ limit: 250 }),
      };
    }

    if (fileName === 'premium-klanten.html' || fileName === 'premium-database.html') {
      return {
        marker: 'SOFTORA_CUSTOMERS_BOOTSTRAP',
        scriptId: 'softoraCustomersBootstrap',
        data: await customersPageBootstrapService.buildCustomersBootstrapPayload(),
      };
    }

    if (fileName === 'premium-ai-coldmailing.html') {
      const leadsPayload = await leadsPageBootstrapService.buildLeadsBootstrapPayload();
      return {
        marker: 'SOFTORA_LEADS_BOOTSTRAP',
        scriptId: 'softoraLeadsBootstrap',
        data: leadsPayload,
        htmlReplacements: leadsPageBootstrapService.buildLeadsPageHtmlReplacements(leadsPayload),
      };
    }

    if (fileName === 'premium-ai-lead-generator.html') {
      const dashboardPayload = await coldcallingDashboardBootstrapService.buildBootstrapPayload();
      return {
        marker: 'SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP',
        scriptId: 'softoraColdcallingDashboardBootstrap',
        data: dashboardPayload,
        htmlReplacements: coldcallingDashboardBootstrapService.buildDashboardHtmlReplacements(
          dashboardPayload
        ),
      };
    }

    return null;
  }

  return {
    agendaInterestedLeadReadService,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    upsertGeneratedAgendaAppointment,
    buildRuntimeHtmlPageBootstrapData,
    retellRouteDeps: {
      ensureRetellAgendaRequestAuthorized:
        agendaRetellCoordinator.ensureRetellAgendaRequestAuthorized,
      sendRetellAgendaAvailabilityResponse:
        agendaRetellCoordinator.sendRetellAgendaAvailabilityResponse,
    },
    readRouteDeps: {
      readCoordinator: agendaReadCoordinator,
      sendConfirmationTaskDetailResponse:
        agendaConfirmationCoordinator.sendConfirmationTaskDetailResponse,
    },
    mutationRouteDeps: {
      createManualAgendaAppointmentResponse:
        agendaManualAppointmentCoordinator.createManualAgendaAppointmentResponse,
      updateAgendaAppointmentPostCallDataById:
        agendaPostCallCoordinator.updateAgendaAppointmentPostCallDataById,
      addAgendaAppointmentToPremiumActiveOrders:
        agendaPostCallCoordinator.addAgendaAppointmentToPremiumActiveOrders,
      setInterestedLeadInAgendaResponse:
        agendaInterestedLeadsCoordinator.setInterestedLeadInAgendaResponse,
      dismissInterestedLeadResponse:
        agendaInterestedLeadsCoordinator.dismissInterestedLeadResponse,
      syncConfirmationMailResponse,
      sendConfirmationTaskDraftEmailResponse:
        agendaConfirmationCoordinator.sendConfirmationTaskDraftEmailResponse,
      sendConfirmationTaskEmailResponse:
        agendaConfirmationCoordinator.sendConfirmationTaskEmailResponse,
      markConfirmationTaskSentById: agendaConfirmationCoordinator.markConfirmationTaskSentById,
      setLeadTaskInAgendaById: agendaConfirmationCoordinator.setLeadTaskInAgendaById,
      markConfirmationTaskResponseReceivedById:
        agendaConfirmationCoordinator.markConfirmationTaskResponseReceivedById,
      markLeadTaskCancelledById: agendaConfirmationCoordinator.markLeadTaskCancelledById,
      completeConfirmationTaskById: agendaConfirmationCoordinator.completeConfirmationTaskById,
    },
  };
}

module.exports = {
  createAgendaRuntime,
  normalizePostCallStatus,
  sanitizePostCallText,
};

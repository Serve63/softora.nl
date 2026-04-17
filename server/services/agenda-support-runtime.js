const { createAiCallInsightRuntime } = require('./ai-call-insights');
const { createAgendaAppointmentStateService } = require('./agenda-appointment-state');
const { createAgendaMetadataService } = require('./agenda-metadata');
const { createAgendaTaskHelpers } = require('./agenda-task-helpers');
const { createConfirmationMailService } = require('./confirmation-mail');

function createAgendaSupportRuntime(deps = {}) {
  let agendaMetadataService = null;

  const {
    normalizeString,
    truncateText,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    normalizeColdcallingStack,
    parseNumberSafe,
    toBooleanSafe,
    formatEuroLabel,
    getColdcallingStackLabel,
    resolvePreferredRecordingUrl,
    getOpenAiApiKey,
    fetchJsonWithTimeout,
    extractOpenAiTextContent,
    parseJsonLoose,
    openAiApiBaseUrl,
    openAiModel,
    buildLeadOwnerFields,
    queueRuntimeStatePersist,
    upsertRecentCallUpdate,
    upsertGeneratedAgendaAppointment,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    aiAnalysisFingerprintByCallId,
    aiAnalysisInFlightCallIds,
    agendaAppointmentIdByCallId,
    generatedAgendaAppointments,
    recentDashboardActivities,
    summaryContainsEnglishMarkers,
    generateTextSummaryWithAi,
    refreshCallUpdateFromTwilioStatusApi,
    refreshCallUpdateFromRetellStatusApi,
    confirmationMailRuntimeState,
    appendDashboardActivity,
    mailConfig,
    resolveAppointmentCallId,
  } = deps;

  const {
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    buildGeneratedAgendaAppointmentFromAiInsight,
    buildGeneratedLeadFollowUpFromCall,
    ensureRuleBasedInsightAndAppointment,
    extractAddressLikeLocationFromText,
    getLatestCallUpdateByCallId,
    hasNegativeInterestSignal,
    hasPositiveInterestSignal,
    isGeneratedAppointmentConfirmedForAgenda,
    isWeakAppointmentLocationText,
    maybeAnalyzeCallUpdateWithAi,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    upsertAiCallInsight,
  } = createAiCallInsightRuntime({
    normalizeString,
    truncateText,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    normalizeColdcallingStack,
    normalizeEmailAddress: (value) => normalizeString(String(value || '').trim().toLowerCase()),
    parseNumberSafe,
    toBooleanSafe,
    formatEuroLabel,
    getColdcallingStackLabel,
    resolvePreferredRecordingUrl,
    getOpenAiApiKey,
    fetchJsonWithTimeout,
    extractOpenAiTextContent: (...args) => extractOpenAiTextContent(...args),
    parseJsonLoose: (...args) => parseJsonLoose(...args),
    openAiApiBaseUrl,
    openAiModel,
    buildLeadOwnerFields,
    queueRuntimeStatePersist,
    upsertRecentCallUpdate,
    upsertGeneratedAgendaAppointment: (...args) => upsertGeneratedAgendaAppointment(...args),
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls: (...args) =>
      backfillOpenLeadFollowUpAppointmentsFromLatestCalls(...args),
    repairAgendaAppointmentsFromDashboardActivities: (...args) =>
      repairAgendaAppointmentsFromDashboardActivities(...args),
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    aiAnalysisFingerprintByCallId,
    aiAnalysisInFlightCallIds,
    agendaAppointmentIdByCallId,
    logger: console,
  });

  const agendaTaskHelpers = createAgendaTaskHelpers({
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe,
    normalizeEmailAddress: (value) => normalizeString(String(value || '').trim().toLowerCase()),
    getLatestCallUpdateByCallId,
    resolveAppointmentCallId,
    normalizeColdcallingStack,
    getColdcallingStackLabel,
    resolveAgendaLocationValue: (...args) =>
      agendaMetadataService?.resolveAgendaLocationValue(...args) ||
      truncateText(normalizeString(args[0] || ''), 220),
    resolveCallDurationSeconds,
    buildLeadOwnerFields,
  });

  const {
    compareConfirmationTasks,
    formatDateTimeLabelNl,
    mapAppointmentToConfirmationTask,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
  } = agendaTaskHelpers;

  const agendaAppointmentStateService = createAgendaAppointmentStateService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    getRecentDashboardActivities: () => recentDashboardActivities,
    queueRuntimeStatePersist,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
  });

  const {
    extractAgendaScheduleFromDashboardActivity,
    getGeneratedAppointmentIndexById,
    repairAgendaAppointmentsFromDashboardActivities,
    setGeneratedAgendaAppointmentAtIndex,
  } = agendaAppointmentStateService;

  agendaMetadataService = createAgendaMetadataService({
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    isWeakAppointmentLocationText,
    extractAddressLikeLocationFromText,
    summaryContainsEnglishMarkers,
    getOpenAiApiKey,
    generateTextSummaryWithAi,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    setGeneratedAgendaAppointmentAtIndex,
    queueRuntimeStatePersist,
    agendaAppointmentIdByCallId,
    getLatestCallUpdateByCallId,
    aiCallInsightsByCallId,
    resolveAppointmentLocation,
    resolvePreferredRecordingUrl,
    resolveCallDurationSeconds,
    refreshCallUpdateFromTwilioStatusApi,
    refreshCallUpdateFromRetellStatusApi,
  });

  const {
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
    buildLeadToAgendaSummary,
    compareAgendaAppointments,
    isGeneratedAppointmentVisibleForAgenda,
    refreshAgendaAppointmentCallSourcesIfNeeded,
    refreshGeneratedAgendaSummariesIfNeeded,
    resolveAgendaLocationValue,
  } = agendaMetadataService;

  const confirmationMailService = createConfirmationMailService({
    mailConfig,
    runtimeState: confirmationMailRuntimeState,
    generatedAgendaAppointments,
    appendDashboardActivity,
    getGeneratedAppointmentIndexById,
    mapAppointmentToConfirmationTask,
    normalizeDateYyyyMmDd,
    normalizeString,
    normalizeTimeHhMm,
    setGeneratedAgendaAppointmentAtIndex,
    formatDateTimeLabelNl,
    truncateText,
  });

  const {
    buildConfirmationEmailDraftFallback,
    getMissingImapMailEnv,
    getMissingSmtpMailEnv,
    isImapMailConfigured,
    isLikelyValidEmail,
    isSmtpMailConfigured,
    normalizeEmailAddress,
    sendConfirmationEmailViaSmtp,
    syncInboundConfirmationEmailsFromImap,
  } = confirmationMailService;

  return {
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    buildConfirmationEmailDraftFallback,
    buildGeneratedAgendaAppointmentFromAiInsight,
    buildGeneratedLeadFollowUpFromCall,
    buildLeadToAgendaSummary,
    compareAgendaAppointments,
    compareConfirmationTasks,
    ensureRuleBasedInsightAndAppointment,
    extractAgendaScheduleFromDashboardActivity,
    extractAddressLikeLocationFromText,
    formatDateTimeLabelNl,
    getGeneratedAppointmentIndexById,
    getLatestCallUpdateByCallId,
    getMissingImapMailEnv,
    getMissingSmtpMailEnv,
    hasNegativeInterestSignal,
    hasPositiveInterestSignal,
    isGeneratedAppointmentConfirmedForAgenda,
    isGeneratedAppointmentVisibleForAgenda,
    isImapMailConfigured,
    isLikelyValidEmail,
    isSmtpMailConfigured,
    isWeakAppointmentLocationText,
    mapAppointmentToConfirmationTask,
    maybeAnalyzeCallUpdateWithAi,
    normalizeEmailAddress,
    refreshAgendaAppointmentCallSourcesIfNeeded,
    refreshGeneratedAgendaSummariesIfNeeded,
    repairAgendaAppointmentsFromDashboardActivities,
    resolveAgendaLocationValue,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    sendConfirmationEmailViaSmtp,
    setGeneratedAgendaAppointmentAtIndex,
    syncInboundConfirmationEmailsFromImap,
    upsertAiCallInsight,
  };
}

module.exports = {
  createAgendaSupportRuntime,
};

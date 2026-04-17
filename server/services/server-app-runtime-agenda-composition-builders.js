const {
  buildServerAppAgendaWiringContext,
} = require('./server-app-runtime-composition-options');
const {
  buildAgendaSupportRuntimeOptions,
} = require('./server-app-runtime-feature-options');

function buildAgendaSupportRuntimeCompositionOptions({
  envConfig,
  runtimeMemory,
  platformRuntime,
  securityRuntime,
  runtimeSyncRuntime,
  upsertRecentCallUpdate,
  upsertGeneratedAgendaAppointment,
  backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
  summaryContainsEnglishMarkers,
  generateTextSummaryWithAi,
  shared,
}) {
  return buildAgendaSupportRuntimeOptions({
    normalizeString: shared.normalizeString,
    truncateText: shared.truncateText,
    normalizeDateYyyyMmDd: platformRuntime.normalizeDateYyyyMmDd,
    normalizeTimeHhMm: platformRuntime.normalizeTimeHhMm,
    normalizeColdcallingStack: shared.normalizeColdcallingStack,
    parseNumberSafe: shared.parseNumberSafe,
    toBooleanSafe: platformRuntime.toBooleanSafe,
    formatEuroLabel: platformRuntime.formatEuroLabel,
    getColdcallingStackLabel: platformRuntime.getColdcallingStackLabel,
    resolvePreferredRecordingUrl: platformRuntime.resolvePreferredRecordingUrl,
    getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
    fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
    extractOpenAiTextContent: shared.extractOpenAiTextContent,
    parseJsonLoose: shared.parseJsonLoose,
    openAiApiBaseUrl: envConfig.OPENAI_API_BASE_URL,
    openAiModel: envConfig.OPENAI_MODEL,
    buildLeadOwnerFields: securityRuntime.buildLeadOwnerFields,
    queueRuntimeStatePersist: runtimeSyncRuntime.queueRuntimeStatePersist,
    upsertRecentCallUpdate,
    upsertGeneratedAgendaAppointment,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    recentCallUpdates: runtimeMemory.recentCallUpdates,
    callUpdatesById: runtimeMemory.callUpdatesById,
    recentAiCallInsights: runtimeMemory.recentAiCallInsights,
    aiCallInsightsByCallId: runtimeMemory.aiCallInsightsByCallId,
    aiAnalysisFingerprintByCallId: runtimeMemory.aiAnalysisFingerprintByCallId,
    aiAnalysisInFlightCallIds: runtimeMemory.aiAnalysisInFlightCallIds,
    agendaAppointmentIdByCallId: runtimeMemory.agendaAppointmentIdByCallId,
    generatedAgendaAppointments: runtimeMemory.generatedAgendaAppointments,
    recentDashboardActivities: runtimeMemory.recentDashboardActivities,
    summaryContainsEnglishMarkers,
    generateTextSummaryWithAi,
    refreshCallUpdateFromTwilioStatusApi:
      platformRuntime.refreshCallUpdateFromTwilioStatusApi,
    refreshCallUpdateFromRetellStatusApi:
      platformRuntime.refreshCallUpdateFromRetellStatusApi,
    confirmationMailRuntimeState: runtimeMemory.confirmationMailRuntimeState,
    appendDashboardActivity: securityRuntime.appendDashboardActivity,
    mailConfig: {
      smtpHost: envConfig.MAIL_SMTP_HOST,
      smtpPort: envConfig.MAIL_SMTP_PORT,
      smtpSecure: envConfig.MAIL_SMTP_SECURE,
      smtpUser: envConfig.MAIL_SMTP_USER,
      smtpPass: envConfig.MAIL_SMTP_PASS,
      mailFromAddress: envConfig.MAIL_FROM_ADDRESS,
      mailFromName: envConfig.MAIL_FROM_NAME,
      mailReplyTo: envConfig.MAIL_REPLY_TO,
      imapHost: envConfig.MAIL_IMAP_HOST,
      imapPort: envConfig.MAIL_IMAP_PORT,
      imapSecure: envConfig.MAIL_IMAP_SECURE,
      imapUser: envConfig.MAIL_IMAP_USER,
      imapPass: envConfig.MAIL_IMAP_PASS,
      imapMailbox: envConfig.MAIL_IMAP_MAILBOX,
      imapExtraMailboxes: envConfig.MAIL_IMAP_EXTRA_MAILBOXES,
      imapPollCooldownMs: envConfig.MAIL_IMAP_POLL_COOLDOWN_MS,
    },
    resolveAppointmentCallId: platformRuntime.resolveAppointmentCallId,
  });
}

function buildAgendaLeadDetailServiceOptions({
  env,
  envConfig,
  runtimeMemory,
  platformRuntime,
  agendaSupportRuntime,
  aiHelpers,
  upsertRecentCallUpdate,
  upsertAiCallInsight,
  ensureRuleBasedInsightAndAppointment,
  maybeAnalyzeCallUpdateWithAi,
  summaryContainsEnglishMarkers,
  generateTextSummaryWithAi,
  findInterestedLeadRowByCallId,
  shared,
}) {
  return {
    openAiApiBaseUrl: envConfig.OPENAI_API_BASE_URL,
    openAiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL || '',
    openAiAudioTranscriptionModel: env.OPENAI_AUDIO_TRANSCRIPTION_MODEL || '',
    publicBaseUrl: envConfig.PUBLIC_BASE_URL,
    recentWebhookEvents: runtimeMemory.recentWebhookEvents,
    recentCallUpdates: runtimeMemory.recentCallUpdates,
    transcriptionPromiseByCallId: runtimeMemory.callRecordingTranscriptionPromiseByCallId,
    aiCallInsightsByCallId: runtimeMemory.aiCallInsightsByCallId,
    normalizeString: shared.normalizeString,
    truncateText: shared.truncateText,
    normalizeDateYyyyMmDd: platformRuntime.normalizeDateYyyyMmDd,
    normalizeTimeHhMm: platformRuntime.normalizeTimeHhMm,
    sanitizeAppointmentLocation: agendaSupportRuntime.sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo:
      agendaSupportRuntime.sanitizeAppointmentWhatsappInfo,
    resolveAppointmentCallId: platformRuntime.resolveAppointmentCallId,
    getLatestCallUpdateByCallId: agendaSupportRuntime.getLatestCallUpdateByCallId,
    resolvePreferredRecordingUrl: platformRuntime.resolvePreferredRecordingUrl,
    normalizeAbsoluteHttpUrl: shared.normalizeAbsoluteHttpUrl,
    inferCallProvider: platformRuntime.inferCallProvider,
    isTwilioStatusApiConfigured: platformRuntime.isTwilioStatusApiConfigured,
    fetchTwilioRecordingsByCallId: platformRuntime.fetchTwilioRecordingsByCallId,
    choosePreferredTwilioRecording: platformRuntime.choosePreferredTwilioRecording,
    buildTwilioRecordingMediaUrl: platformRuntime.buildTwilioRecordingMediaUrl,
    fetchBinaryWithTimeout: shared.fetchBinaryWithTimeout,
    getTwilioBasicAuthorizationHeader: platformRuntime.getTwilioBasicAuthorizationHeader,
    parseJsonLoose: aiHelpers.parseJsonLoose,
    getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
    upsertRecentCallUpdate,
    upsertAiCallInsight,
    ensureRuleBasedInsightAndAppointment,
    maybeAnalyzeCallUpdateWithAi,
    summaryContainsEnglishMarkers,
    generateTextSummaryWithAi,
    resolveCallDurationSeconds: agendaSupportRuntime.resolveCallDurationSeconds,
    findInterestedLeadRowByCallId,
    extractTranscriptFull: aiHelpers.extractTranscriptFull,
    extractTwilioRecordingSidFromUrl:
      platformRuntime.extractTwilioRecordingSidFromUrl,
    logger: console,
  };
}

function buildAgendaPostCallHelpersOptions({
  normalizeString,
  truncateText,
  sanitizeLaunchDomainName,
  sanitizeReferenceImages,
  sanitizePostCallText,
  normalizePostCallStatus,
}) {
  return {
    normalizeString,
    truncateText,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    sanitizePostCallText,
    normalizePostCallStatus,
  };
}

function buildServerAppAgendaWiringRuntimeContext({
  app,
  envConfig,
  bootstrapState,
  runtimeMemory,
  platformRuntime,
  securityRuntime,
  runtimeSyncRuntime,
  agendaSupportRuntime,
  agendaPostCallHelpers,
  agendaLeadDetailService,
  uiSeoRuntime,
  aiHelpers,
  getEffectivePublicBaseUrl,
  queueRuntimeStatePersist,
  buildRuntimeStateSnapshotPayload,
  shared,
}) {
  return buildServerAppAgendaWiringContext({
    app,
    agendaAppOptions: {
      dismissedInterestedLeadCallIds: runtimeMemory.dismissedInterestedLeadCallIds,
      dismissedInterestedLeadKeys: runtimeMemory.dismissedInterestedLeadKeys,
      dismissedInterestedLeadKeyUpdatedAtMsByKey:
        runtimeMemory.dismissedInterestedLeadKeyUpdatedAtMsByKey,
      recentCallUpdates: runtimeMemory.recentCallUpdates,
      recentAiCallInsights: runtimeMemory.recentAiCallInsights,
      aiCallInsightsByCallId: runtimeMemory.aiCallInsightsByCallId,
      generatedAgendaAppointments: runtimeMemory.generatedAgendaAppointments,
      agendaAppointmentIdByCallId: runtimeMemory.agendaAppointmentIdByCallId,
      runtimeStateSyncState: runtimeMemory.runtimeStateSyncState,
      normalizeString: shared.normalizeString,
      normalizeDateYyyyMmDd: platformRuntime.normalizeDateYyyyMmDd,
      normalizeTimeHhMm: platformRuntime.normalizeTimeHhMm,
      truncateText: shared.truncateText,
      toBooleanSafe: platformRuntime.toBooleanSafe,
      normalizeColdcallingStack: shared.normalizeColdcallingStack,
      getColdcallingStackLabel: platformRuntime.getColdcallingStackLabel,
      buildGeneratedLeadFollowUpFromCall:
        agendaSupportRuntime.buildGeneratedLeadFollowUpFromCall,
      buildLeadOwnerFields: securityRuntime.buildLeadOwnerFields,
      resolveAppointmentLocation: agendaSupportRuntime.resolveAppointmentLocation,
      resolveCallDurationSeconds: agendaSupportRuntime.resolveCallDurationSeconds,
      resolvePreferredRecordingUrl: platformRuntime.resolvePreferredRecordingUrl,
      sanitizeAppointmentLocation: agendaSupportRuntime.sanitizeAppointmentLocation,
      sanitizeAppointmentWhatsappInfo:
        agendaSupportRuntime.sanitizeAppointmentWhatsappInfo,
      resolveAgendaLocationValue: agendaSupportRuntime.resolveAgendaLocationValue,
      queueRuntimeStatePersist,
      persistDismissedLeadsToSupabase:
        runtimeSyncRuntime.persistDismissedLeadsToSupabase,
      mapAppointmentToConfirmationTask:
        agendaSupportRuntime.mapAppointmentToConfirmationTask,
      compareConfirmationTasks: agendaSupportRuntime.compareConfirmationTasks,
      getGeneratedAppointmentIndexById:
        agendaSupportRuntime.getGeneratedAppointmentIndexById,
      setGeneratedAgendaAppointmentAtIndex:
        agendaSupportRuntime.setGeneratedAgendaAppointmentAtIndex,
      buildConfirmationEmailDraftFallback:
        agendaSupportRuntime.buildConfirmationEmailDraftFallback,
      takeNextGeneratedAgendaAppointmentId:
        runtimeMemory.takeNextGeneratedAgendaAppointmentId,
      normalizeEmailAddress: agendaSupportRuntime.normalizeEmailAddress,
      isSupabaseConfigured: platformRuntime.isSupabaseConfigured,
      forceHydrateRuntimeStateWithRetries:
        runtimeSyncRuntime.forceHydrateRuntimeStateWithRetries,
      syncRuntimeStateFromSupabaseIfNewer:
        runtimeSyncRuntime.syncRuntimeStateFromSupabaseIfNewer,
      getLatestCallUpdateByCallId: agendaSupportRuntime.getLatestCallUpdateByCallId,
      formatEuroLabel: platformRuntime.formatEuroLabel,
      appendDashboardActivity: securityRuntime.appendDashboardActivity,
      buildRuntimeStateSnapshotPayload,
      applyRuntimeStateSnapshotPayload:
        runtimeSyncRuntime.applyRuntimeStateSnapshotPayload,
      waitForQueuedRuntimeSnapshotPersist:
        runtimeSyncRuntime.waitForQueuedRuntimeSnapshotPersist,
      invalidateSupabaseSyncTimestamp:
        runtimeSyncRuntime.invalidateSupabaseSyncTimestamp,
      sanitizeLaunchDomainName: agendaPostCallHelpers.sanitizeLaunchDomainName,
      sanitizeReferenceImages: agendaPostCallHelpers.sanitizeReferenceImages,
      agendaPostCallHelpers,
      getUiStateValues: uiSeoRuntime.getUiStateValues,
      setUiStateValues: uiSeoRuntime.setUiStateValues,
      premiumActiveOrdersScope: bootstrapState.PREMIUM_ACTIVE_ORDERS_SCOPE,
      premiumActiveCustomOrdersKey: bootstrapState.PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY,
      premiumCustomersScope: bootstrapState.PREMIUM_CUSTOMERS_SCOPE,
      premiumCustomersKey: bootstrapState.PREMIUM_CUSTOMERS_KEY,
      leadDatabaseUiScope: 'coldcalling',
      leadDatabaseRowsStorageKey: 'softora_coldcalling_lead_rows_json',
      openAiApiBaseUrl: envConfig.OPENAI_API_BASE_URL,
      openAiModel: envConfig.OPENAI_MODEL,
      runtimeSyncCooldownMs: bootstrapState.RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS,
      pickReadableConversationSummaryForLeadDetail:
        agendaLeadDetailService.pickReadableConversationSummaryForLeadDetail,
      getAppointmentTranscriptText:
        agendaLeadDetailService.getAppointmentTranscriptText,
      resolveAppointmentCallId: platformRuntime.resolveAppointmentCallId,
      inferCallProvider: platformRuntime.inferCallProvider,
      refreshCallUpdateFromTwilioStatusApi:
        platformRuntime.refreshCallUpdateFromTwilioStatusApi,
      refreshCallUpdateFromRetellStatusApi:
        platformRuntime.refreshCallUpdateFromRetellStatusApi,
      buildCallBackedLeadDetail: agendaLeadDetailService.buildCallBackedLeadDetail,
      buildConversationSummaryForLeadDetail:
        agendaLeadDetailService.buildConversationSummaryForLeadDetail,
      getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
      fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
      extractOpenAiTextContent: aiHelpers.extractOpenAiTextContent,
      isImapMailConfigured: agendaSupportRuntime.isImapMailConfigured,
      syncInboundConfirmationEmailsFromImap:
        agendaSupportRuntime.syncInboundConfirmationEmailsFromImap,
      backfillInsightsAndAppointmentsFromRecentCallUpdates:
        agendaSupportRuntime.backfillInsightsAndAppointmentsFromRecentCallUpdates,
      isLikelyValidEmail: agendaSupportRuntime.isLikelyValidEmail,
      isSmtpMailConfigured: agendaSupportRuntime.isSmtpMailConfigured,
      getMissingSmtpMailEnv: agendaSupportRuntime.getMissingSmtpMailEnv,
      sendConfirmationEmailViaSmtp:
        agendaSupportRuntime.sendConfirmationEmailViaSmtp,
      buildLeadToAgendaSummary: agendaSupportRuntime.buildLeadToAgendaSummary,
      extractTwilioRecordingSidFromUrl:
        platformRuntime.extractTwilioRecordingSidFromUrl,
      isTwilioStatusApiConfigured: platformRuntime.isTwilioStatusApiConfigured,
      fetchTwilioRecordingsByCallId: platformRuntime.fetchTwilioRecordingsByCallId,
      choosePreferredTwilioRecording: platformRuntime.choosePreferredTwilioRecording,
      buildTwilioRecordingMediaUrl: platformRuntime.buildTwilioRecordingMediaUrl,
      fetchBinaryWithTimeout: shared.fetchBinaryWithTimeout,
      getTwilioBasicAuthorizationHeader:
        platformRuntime.getTwilioBasicAuthorizationHeader,
      buildRecordingFileNameForTranscription:
        agendaLeadDetailService.buildRecordingFileNameForTranscription,
      getEffectivePublicBaseUrl,
      normalizeAbsoluteHttpUrl: shared.normalizeAbsoluteHttpUrl,
      getOpenAiTranscriptionModelCandidates:
        agendaLeadDetailService.getOpenAiTranscriptionModelCandidates,
      parseJsonLoose: aiHelpers.parseJsonLoose,
      demoConfirmationTaskEnabled: envConfig.DEMO_CONFIRMATION_TASK_ENABLED,
      ensureDismissedLeadsFreshFromSupabase:
        runtimeSyncRuntime.ensureDismissedLeadsFreshFromSupabase,
      refreshAgendaAppointmentCallSourcesIfNeeded:
        agendaSupportRuntime.refreshAgendaAppointmentCallSourcesIfNeeded,
      backfillGeneratedAgendaAppointmentsMetadataIfNeeded:
        agendaSupportRuntime.backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
      refreshGeneratedAgendaSummariesIfNeeded:
        agendaSupportRuntime.refreshGeneratedAgendaSummariesIfNeeded,
      isGeneratedAppointmentVisibleForAgenda:
        agendaSupportRuntime.isGeneratedAppointmentVisibleForAgenda,
      compareAgendaAppointments: agendaSupportRuntime.compareAgendaAppointments,
      parseIntSafe: shared.parseIntSafe,
      hasNegativeInterestSignal: agendaSupportRuntime.hasNegativeInterestSignal,
      hasPositiveInterestSignal: agendaSupportRuntime.hasPositiveInterestSignal,
    },
  });
}

module.exports = {
  buildAgendaSupportRuntimeCompositionOptions,
  buildAgendaLeadDetailServiceOptions,
  buildAgendaPostCallHelpersOptions,
  buildServerAppAgendaWiringRuntimeContext,
};

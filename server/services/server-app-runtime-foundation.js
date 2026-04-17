const { createPlatformRuntime } = require('./platform-runtime');
const { createRuntimeSyncRuntime } = require('./runtime-sync-runtime');
const { applyAppMiddleware } = require('./app-middleware-runtime');
const { createColdcallingServiceRuntime } = require('./coldcalling-service-runtime');
const { createSecurityRuntime } = require('./security-runtime');
const {
  buildAppMiddlewareOptions,
  buildColdcallingServiceRuntimeOptions,
  buildPlatformRuntimeOptions,
  buildRuntimeSyncRuntimeOptions,
  buildSecurityRuntimeOptions,
} = require('./server-app-runtime-foundation-options');

function createServerAppFoundationRuntime(context, dependencies = {}) {
  const {
    createPlatformRuntimeImpl = createPlatformRuntime,
    createSecurityRuntimeImpl = createSecurityRuntime,
  } = dependencies;

  const {
    env,
    runtimeEnv,
    runtimeMemory,
    premiumPublicHtmlFiles,
    noindexHeaderValue,
    foundationCallbacks,
    shared,
  } = context;

  const {
    app: { isProduction },
    ai: {
      retellApiBaseUrl,
      twilioApiBaseUrl,
      websiteAnthropicModel,
      anthropicModel,
      dossierAnthropicModel,
      verboseCallWebhookLogs,
      defaultTwilioMediaWsUrl,
    },
    websiteGeneration: { provider: websiteGenerationProvider },
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      stateTable: supabaseStateTable,
      stateKey: supabaseStateKey,
      dismissedLeadsStateKey: supabaseDismissedLeadsStateKey,
      callUpdateStateKeyPrefix: supabaseCallUpdateStateKeyPrefix,
      callUpdateRowsFetchLimit: supabaseCallUpdateRowsFetchLimit,
    },
    premiumAuth: {
      loginEmails: premiumLoginEmails,
      loginPassword: premiumLoginPassword,
      loginPasswordHash: premiumLoginPasswordHash,
      sessionSecret: premiumSessionSecret,
      sessionTtlHours: premiumSessionTtlHours,
      sessionCookieName,
      mfaTotpSecret,
      adminIpAllowlist: premiumAdminIpAllowlist,
      enforceSameOriginRequests,
    },
  } = runtimeEnv;

  const {
    recentWebhookEvents,
    recentCallUpdates,
    callUpdatesById,
    retellCallStatusRefreshByCallId,
    recentAiCallInsights,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    aiCallInsightsByCallId,
    agendaAppointmentIdByCallId,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId,
    getNextLeadOwnerRotationIndex,
    setNextLeadOwnerRotationIndex,
  } = runtimeMemory;

  const {
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    normalizeNlPhoneToE164,
    normalizeLeadLikePhoneKey,
    normalizePremiumSessionEmail,
    extractRetellTranscriptText,
    getLatestCallUpdateByCallId,
  } = foundationCallbacks;

  const {
    normalizeString,
    truncateText,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    fetchJsonWithTimeout,
    timingSafeEqualStrings,
    normalizeIpAddress,
    normalizeOrigin,
    getClientIpFromRequest,
    getRequestOriginFromHeaders,
    getRequestPathname,
    isSecureHttpRequest,
  } = shared;

  let runtimeSyncRuntime = null;

  const upsertRecentCallUpdate = (...args) => runtimeSyncRuntime?.upsertRecentCallUpdate(...args) || null;
  const queueRuntimeStatePersist = (reason = 'unknown') =>
    runtimeSyncRuntime?.queueRuntimeStatePersist(reason) || null;
  const buildRuntimeStateSnapshotPayload = () =>
    runtimeSyncRuntime?.buildRuntimeStateSnapshotPayload() || null;

  const platformRuntime = createPlatformRuntimeImpl(
    buildPlatformRuntimeOptions({
      env,
      normalizeString,
      normalizeColdcallingStack,
      parseNumberSafe,
      websiteAnthropicModel,
      anthropicModel,
      websiteGenerationProvider,
      dossierAnthropicModel,
      retellApiBaseUrl,
      twilioApiBaseUrl,
      defaultTwilioMediaWsUrl,
      fetchJsonWithTimeout,
      getEffectivePublicBaseUrl,
      normalizeAbsoluteHttpUrl,
      appendQueryParamsToUrl,
      normalizeNlPhoneToE164,
      parseIntSafe,
      truncateText,
      extractRetellTranscriptText,
      normalizeLeadLikePhoneKey,
      getLatestCallUpdateByCallId,
      recentCallUpdates,
      callUpdatesById,
      recentAiCallInsights,
      generatedAgendaAppointments,
      upsertRecentCallUpdate,
      retellCallStatusRefreshByCallId,
      retellStatusRefreshCooldownMs: 8000,
      supabaseUrl,
      supabaseServiceRoleKey,
      supabaseStateTable,
      supabaseStateKey,
      supabaseCallUpdateStateKeyPrefix,
      supabaseCallUpdateRowsFetchLimit,
    })
  );

  const {
    buildRetellPayload,
    buildSupabaseCallUpdateStateKey,
    buildTwilioOutboundPayload,
    buildTwilioStatusCallbackUrl,
    classifyRetellFailure,
    classifyTwilioFailure,
    createRetellOutboundCall,
    createTwilioOutboundCall,
    extractCallIdFromSupabaseCallUpdateStateKey,
    extractCallUpdateFromRetellPayload,
    extractCallUpdateFromTwilioPayload,
    fetchSupabaseCallUpdateRowsViaRest,
    fetchSupabaseRowByKeyViaRest,
    fetchSupabaseStateRowViaRest,
    getColdcallingStackLabel,
    getSupabaseClient,
    getTwilioMediaWsUrlForStack,
    isSupabaseConfigured,
    isTerminalColdcallingStatus,
    parseDateToIso,
    refreshCallUpdateFromRetellStatusApi,
    resolveColdcallingProviderForCampaign,
    toIsoFromUnixMilliseconds,
    upsertSupabaseRowViaRest,
    upsertSupabaseStateRowViaRest,
  } = platformRuntime;

  const securityRuntime = createSecurityRuntimeImpl(
    buildSecurityRuntimeOptions({
      premiumLoginEmails,
      premiumLoginPassword,
      premiumLoginPasswordHash,
      premiumSessionSecret,
      premiumAuthUsersRowKey: 'premium_auth_users',
      premiumAuthUsersVersion: 1,
      supabaseStateTable,
      normalizeString,
      truncateText,
      timingSafeEqualStrings,
      normalizePremiumSessionEmail,
      isSupabaseConfigured,
      getSupabaseClient,
      fetchSupabaseRowByKeyViaRest,
      upsertSupabaseRowViaRest,
      leadOwnerAssignmentsByCallId,
      getNextLeadOwnerRotationIndex,
      setNextLeadOwnerRotationIndex,
      queueRuntimeStatePersist,
      mfaTotpSecret,
      sessionCookieName,
      premiumSessionTtlHours,
      isProduction,
      isSecureHttpRequest,
      getRequestPathname,
      enforceSameOriginRequests,
      getEffectivePublicBaseUrl,
      premiumAdminIpAllowlist,
      normalizeIpAddress,
      recentDashboardActivities,
      recentSecurityAuditEvents,
      normalizeOrigin,
      getClientIpFromRequest,
      getRequestOriginFromHeaders,
      premiumPublicHtmlFiles,
      noindexHeaderValue,
      enableRuntimeDebugRoutes: runtimeEnv.premiumAuth.enableRuntimeDebugRoutes,
    })
  );

  const {
    appendSecurityAuditEvent,
    getPremiumAuthState,
    getStateChangingApiProtectionDecision,
    isPremiumPublicApiRequest,
    normalizeLeadOwnerRecord,
  } = securityRuntime;

  return {
    buildRuntimeStateSnapshotPayload,
    bindRuntimeSyncRuntime: (value) => {
      runtimeSyncRuntime = value;
    },
    platformRuntime,
    queueRuntimeStatePersist,
    securityRuntime,
    upsertRecentCallUpdate,
  };
}

function createServerAppOperationalRuntime(context, dependencies = {}) {
  const {
    createRuntimeSyncRuntimeImpl = createRuntimeSyncRuntime,
    applyAppMiddlewareImpl = applyAppMiddleware,
    createColdcallingServiceRuntimeImpl = createColdcallingServiceRuntime,
  } = dependencies;

  const {
    app,
    env,
    express,
    runtimeEnv,
    runtimeMemory,
    appName = 'softora-retell-coldcalling-backend',
    appVersion,
    routeManifest,
    noindexHeaderValue,
    platformRuntime,
    securityRuntime,
    bindRuntimeSyncRuntime,
    upsertRecentCallUpdate,
    operationalCallbacks,
    shared,
  } = context;

  const {
    recentWebhookEvents,
    recentCallUpdates,
    callUpdatesById,
    retellCallStatusRefreshByCallId,
    recentAiCallInsights,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    aiCallInsightsByCallId,
    agendaAppointmentIdByCallId,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId,
    runtimeStateSyncState,
    getNextLeadOwnerRotationIndex,
    getNextGeneratedAgendaAppointmentId,
    createSequentialDispatchQueueId,
  } = runtimeMemory;

  const {
    getPublicFeatureFlags,
    normalizePremiumSessionEmail,
    resolveCallDurationSeconds,
    resolveCallUpdateTimestamp,
    maybeAnalyzeCallUpdateWithAi,
    ensureRuleBasedInsightAndAppointment,
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
  } = operationalCallbacks;

  const {
    normalizeString,
    truncateText,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    timingSafeEqualStrings,
    getClientIpFromRequest,
    getRequestOriginFromHeaders,
    getRequestPathname,
    isSecureHttpRequest,
    escapeHtml,
  } = shared;

  const {
    app: { isProduction },
    ai: { verboseCallWebhookLogs },
    supabase: {
      stateTable: supabaseStateTable,
      stateKey: supabaseStateKey,
      dismissedLeadsStateKey: supabaseDismissedLeadsStateKey,
      callUpdateStateKeyPrefix: supabaseCallUpdateStateKeyPrefix,
      callUpdateRowsFetchLimit: supabaseCallUpdateRowsFetchLimit,
    },
  } = runtimeEnv;

  const {
    appendSecurityAuditEvent,
    getPremiumAuthState,
    getStateChangingApiProtectionDecision,
    isPremiumPublicApiRequest,
    normalizeLeadOwnerRecord,
  } = securityRuntime;

  const {
    buildSupabaseCallUpdateStateKey,
    buildRetellPayload,
    buildTwilioOutboundPayload,
    buildTwilioStatusCallbackUrl,
    classifyRetellFailure,
    classifyTwilioFailure,
    createRetellOutboundCall,
    createTwilioOutboundCall,
    extractCallIdFromSupabaseCallUpdateStateKey,
    extractCallUpdateFromRetellPayload,
    extractCallUpdateFromTwilioPayload,
    fetchSupabaseCallUpdateRowsViaRest,
    fetchSupabaseRowByKeyViaRest,
    fetchSupabaseStateRowViaRest,
    getColdcallingStackLabel,
    getSupabaseClient,
    getTwilioMediaWsUrlForStack,
    isSupabaseConfigured,
    isTerminalColdcallingStatus,
    parseDateToIso,
    refreshCallUpdateFromRetellStatusApi,
    resolveColdcallingProviderForCampaign,
    toBooleanSafe,
    toIsoFromUnixMilliseconds,
    upsertSupabaseRowViaRest,
    upsertSupabaseStateRowViaRest,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
  } = platformRuntime;

  const runtimeSyncRuntime = createRuntimeSyncRuntimeImpl(
    buildRuntimeSyncRuntimeOptions({
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
      runtimeStateSupabaseSyncCooldownMs: 4000,
      runtimeStateRemoteNewerThresholdMs: 250,
      buildSupabaseCallUpdateStateKey,
      extractCallIdFromSupabaseCallUpdateStateKey,
      callUpdatesById,
      aiCallInsightsByCallId,
      agendaAppointmentIdByCallId,
      logger: console,
      runtimeState: runtimeStateSyncState,
      resolveCallUpdateTimestamp,
      isTerminalColdcallingStatus,
      retellCallStatusRefreshByCallId,
    })
  );

  bindRuntimeSyncRuntime(runtimeSyncRuntime);

  const { premiumLoginRateLimiter } = applyAppMiddlewareImpl(
    app,
    buildAppMiddlewareOptions({
      express,
      isProduction,
      isPremiumPublicApiRequest,
      appendSecurityAuditEvent,
      getPremiumAuthState,
      normalizePremiumSessionEmail,
      getClientIpFromRequest,
      getRequestPathname,
      getRequestOriginFromHeaders,
      getStateChangingApiProtectionDecision,
      noindexHeaderValue,
      isSupabaseConfigured,
      ensureRuntimeStateHydratedFromSupabase:
        runtimeSyncRuntime.ensureRuntimeStateHydratedFromSupabase,
    })
  );

  let coldcallingServiceRuntime = null;
  const processColdcallingLead = (...args) =>
    coldcallingServiceRuntime?.processColdcallingLead(...args);

  coldcallingServiceRuntime = createColdcallingServiceRuntimeImpl(
    buildColdcallingServiceRuntimeOptions({
      createQueueId: createSequentialDispatchQueueId,
      sequentialDispatchQueues,
      sequentialDispatchQueueIdByCallId,
      normalizeString,
      processColdcallingLead,
      logger: console,
      normalizeColdcallingStack,
      parseIntSafe,
      parseNumberSafe,
      getColdcallingStackLabel,
      resolveColdcallingProviderForCampaign,
      buildRetellPayload,
      createRetellOutboundCall,
      classifyRetellFailure,
      toIsoFromUnixMilliseconds,
      upsertRecentCallUpdate,
      refreshCallUpdateFromRetellStatusApi,
      waitForQueuedRuntimeStatePersist: runtimeSyncRuntime.waitForQueuedRuntimeStatePersist,
      buildTwilioOutboundPayload,
      createTwilioOutboundCall,
      classifyTwilioFailure,
      parseDateToIso,
      ensureRuleBasedInsightAndAppointment,
      maybeAnalyzeCallUpdateWithAi,
      env,
      normalizeAbsoluteHttpUrl,
      getEffectivePublicBaseUrl,
      isSecureHttpRequest,
      appendQueryParamsToUrl,
      escapeHtml,
      getClientIpFromRequest,
      getRequestPathname,
      getRequestOriginFromHeaders,
      appendSecurityAuditEvent,
      getTwilioMediaWsUrlForStack,
      buildTwilioStatusCallbackUrl,
      extractCallUpdateFromTwilioPayload,
      extractCallUpdateFromRetellPayload,
      recentWebhookEvents,
      verboseCallWebhookLogs,
      timingSafeEqualStrings,
    })
  );

  return {
    coldcallingServiceRuntime,
    premiumLoginRateLimiter,
    runtimeSyncRuntime,
  };
}

module.exports = {
  createServerAppFoundationRuntime,
  createServerAppOperationalRuntime,
};

const { createAgendaSupportRuntime } = require('./agenda-support-runtime');
const { createAgendaLeadDetailService } = require('./agenda-lead-detail');
const { createAgendaPostCallHelpers } = require('./agenda-post-call');
const {
  normalizePostCallStatus: normalizeAgendaRuntimePostCallStatus,
  sanitizePostCallText: sanitizeAgendaRuntimePostCallText,
} = require('./agenda-runtime');
const {
  createServerAppOperationalRuntime,
} = require('./server-app-runtime-foundation');
const {
  createServerAppUiContentRuntime,
} = require('./server-app-runtime-ui-content');
const {
  createServerAppAgendaWiring,
  createServerAppFeatureWiring,
  createServerAppOpsWiring,
} = require('./server-app-runtime-wiring');
const {
  buildAgendaSupportRuntimeCompositionOptions,
  buildAgendaLeadDetailServiceOptions,
  buildAgendaPostCallHelpersOptions,
  buildServerAppAgendaWiringRuntimeContext,
  buildServerAppFeatureWiringRuntimeContext,
  buildServerAppOperationalRuntimeContext,
  buildServerAppOpsWiringRuntimeContext,
  buildServerAppUiContentRuntimeCompositionContext,
} = require('./server-app-runtime-composition-builders');

function assembleServerAppRuntimeDomainsWithFactories(
  {
    app,
    env,
    expressImpl,
    runtimeEnv,
    runtimeMemory,
    envConfig,
    bootstrapState,
    appVersion,
    routeManifest,
    featureFlags,
    getPublicFeatureFlags,
    isServerlessRuntime,
    projectRootDir,
    platformRuntime,
    securityRuntime,
    bindRuntimeSyncRuntime,
    upsertRecentCallUpdate,
    queueRuntimeStatePersist,
    buildRuntimeStateSnapshotPayload,
    getEffectivePublicBaseUrl,
    normalizePremiumSessionEmail,
    resolveCallUpdateTimestamp,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    resolveLegacyPrettyPageRedirect,
    toPrettyPagePathFromHtmlFile,
    runtimeCallbackRefs,
    shared,
  },
  factories
) {
  const {
    createAgendaSupportRuntimeImpl,
    createAgendaLeadDetailServiceImpl,
    createAgendaPostCallHelpersImpl,
    createServerAppOperationalRuntimeImpl,
    createServerAppUiContentRuntimeImpl,
    createServerAppFeatureWiringImpl,
    createServerAppAgendaWiringImpl,
    createServerAppOpsWiringImpl,
    buildAgendaSupportRuntimeCompositionOptionsImpl,
    buildAgendaLeadDetailServiceOptionsImpl,
    buildAgendaPostCallHelpersOptionsImpl,
    buildServerAppAgendaWiringRuntimeContextImpl,
    buildServerAppFeatureWiringRuntimeContextImpl,
    buildServerAppOperationalRuntimeContextImpl,
    buildServerAppOpsWiringRuntimeContextImpl,
    buildServerAppUiContentRuntimeCompositionContextImpl,
    normalizeAgendaRuntimePostCallStatusImpl,
    sanitizeAgendaRuntimePostCallTextImpl,
  } = factories;

  let agendaInterestedLeadReadService = null;
  let getRuntimeHtmlPageBootstrapData = async () => null;
  let upsertGeneratedAgendaAppointment = async () => null;
  let backfillOpenLeadFollowUpAppointmentsFromLatestCalls = async () => null;
  let extractOpenAiTextContent = () => '';
  let parseJsonLoose = () => null;
  let generateTextSummaryWithAi = async () => '';
  let summaryContainsEnglishMarkers = () => false;

  const agendaSupportRuntime = createAgendaSupportRuntimeImpl(
    buildAgendaSupportRuntimeCompositionOptionsImpl({
      envConfig,
      runtimeMemory,
      platformRuntime,
      securityRuntime,
      runtimeSyncRuntime: {
        queueRuntimeStatePersist,
      },
      upsertRecentCallUpdate,
      upsertGeneratedAgendaAppointment: (...args) => upsertGeneratedAgendaAppointment(...args),
      backfillOpenLeadFollowUpAppointmentsFromLatestCalls: (...args) =>
        backfillOpenLeadFollowUpAppointmentsFromLatestCalls(...args),
      summaryContainsEnglishMarkers: (...args) =>
        summaryContainsEnglishMarkers(...args),
      generateTextSummaryWithAi: (...args) => generateTextSummaryWithAi(...args),
      shared: {
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        normalizeColdcallingStack: shared.normalizeColdcallingStack,
        parseNumberSafe: shared.parseNumberSafe,
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        extractOpenAiTextContent: (...args) => extractOpenAiTextContent(...args),
        parseJsonLoose: (...args) => parseJsonLoose(...args),
      },
    })
  );

  const {
    ensureRuleBasedInsightAndAppointment,
    getLatestCallUpdateByCallId,
    isImapMailConfigured,
    isSmtpMailConfigured,
    maybeAnalyzeCallUpdateWithAi,
    resolveCallDurationSeconds,
    upsertAiCallInsight,
  } = agendaSupportRuntime;

  runtimeCallbackRefs.getLatestCallUpdateByCallId = (...args) =>
    getLatestCallUpdateByCallId(...args);

  const {
    runtimeSyncRuntime,
    coldcallingServiceRuntime,
    premiumLoginRateLimiter,
  } = createServerAppOperationalRuntimeImpl(
    buildServerAppOperationalRuntimeContextImpl({
      app,
      env,
      express: expressImpl,
      runtimeEnv,
      runtimeMemory,
      appVersion,
      routeManifest,
      bootstrapState,
      platformRuntime,
      securityRuntime,
      bindRuntimeSyncRuntime,
      upsertRecentCallUpdate,
      getPublicFeatureFlags,
      normalizePremiumSessionEmail,
      resolveCallDurationSeconds: (...args) => resolveCallDurationSeconds(...args),
      resolveCallUpdateTimestamp,
      maybeAnalyzeCallUpdateWithAi: (...args) => maybeAnalyzeCallUpdateWithAi(...args),
      ensureRuleBasedInsightAndAppointment: (...args) =>
        ensureRuleBasedInsightAndAppointment(...args),
      getEffectivePublicBaseUrl,
      normalizeAbsoluteHttpUrl,
      appendQueryParamsToUrl,
      shared: {
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        normalizeColdcallingStack: shared.normalizeColdcallingStack,
        parseIntSafe: shared.parseIntSafe,
        parseNumberSafe: shared.parseNumberSafe,
        timingSafeEqualStrings: shared.timingSafeEqualStrings,
        getClientIpFromRequest: shared.getClientIpFromRequest,
        getRequestOriginFromHeaders: shared.getRequestOriginFromHeaders,
        getRequestPathname: shared.getRequestPathname,
        isSecureHttpRequest: shared.isSecureHttpRequest,
        escapeHtml: shared.escapeHtml,
      },
    })
  );

  const {
    buildRuntimeBackupForOps,
    buildRuntimeStateSnapshotPayloadWithLimits,
    ensureRuntimeStateHydratedFromSupabase,
  } = runtimeSyncRuntime;

  const { websiteInputRuntime, aiHelpers, uiSeoRuntime, aiContentRuntime } =
    createServerAppUiContentRuntimeImpl(
      buildServerAppUiContentRuntimeCompositionContextImpl({
      env,
      runtimeEnv,
      runtimeMemory,
      projectRootDir,
      bootstrapState,
      platformRuntime,
      securityRuntime,
      runtimeSyncRuntime,
      getPageBootstrapData: (req, fileName) => getRuntimeHtmlPageBootstrapData(req, fileName),
      getEffectivePublicBaseUrl,
      resolveLegacyPrettyPageRedirect,
      shared: {
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        clipText: shared.clipText,
        escapeHtml: shared.escapeHtml,
        parseIntSafe: shared.parseIntSafe,
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        fetchTextWithTimeout: shared.fetchTextWithTimeout,
        assertWebsitePreviewUrlIsPublic: shared.assertWebsitePreviewUrlIsPublic,
        normalizeAbsoluteHttpUrl,
        normalizeWebsitePreviewTargetUrl: shared.normalizeWebsitePreviewTargetUrl,
      },
    })
  );

  const { sanitizeReferenceImages, sanitizeLaunchDomainName } = websiteInputRuntime;
  const {
    extractOpenAiTextContent: extractOpenAiTextContentImpl,
    extractRetellTranscriptText,
    parseJsonLoose: parseJsonLooseImpl,
  } = aiHelpers;
  const { websiteLinkCoordinator } = uiSeoRuntime;
  const { aiSummaryService } = aiContentRuntime;

  runtimeCallbackRefs.extractRetellTranscriptText = (...args) =>
    extractRetellTranscriptText(...args);

  extractOpenAiTextContent = (...args) => extractOpenAiTextContentImpl(...args);
  parseJsonLoose = (...args) => parseJsonLooseImpl(...args);
  generateTextSummaryWithAi = (...args) =>
    aiSummaryService.generateTextSummaryWithAi(...args);
  const normalizeAiSummaryStyle = (...args) =>
    aiSummaryService.normalizeAiSummaryStyle(...args);
  summaryContainsEnglishMarkers = (...args) =>
    aiSummaryService.summaryContainsEnglishMarkers(...args);

  const agendaLeadDetailService = createAgendaLeadDetailServiceImpl(
    buildAgendaLeadDetailServiceOptionsImpl({
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
      findInterestedLeadRowByCallId: (...args) =>
        agendaInterestedLeadReadService?.findInterestedLeadRowByCallId(...args) || null,
      shared: {
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        normalizeAbsoluteHttpUrl,
        fetchBinaryWithTimeout: shared.fetchBinaryWithTimeout,
      },
    })
  );

  const normalizePostCallStatus = (value) =>
    normalizeAgendaRuntimePostCallStatusImpl(
      value,
      shared.normalizeString,
      shared.truncateText
    );
  const sanitizePostCallText = (value, maxLen = 20000) =>
    sanitizeAgendaRuntimePostCallTextImpl(
      value,
      shared.normalizeString,
      shared.truncateText,
      maxLen
    );

  const agendaPostCallHelpers = createAgendaPostCallHelpersImpl(
    buildAgendaPostCallHelpersOptionsImpl({
      normalizeString: shared.normalizeString,
      truncateText: shared.truncateText,
      sanitizeLaunchDomainName,
      sanitizeReferenceImages,
      sanitizePostCallText,
      normalizePostCallStatus,
    })
  );

  createServerAppFeatureWiringImpl(
    buildServerAppFeatureWiringRuntimeContextImpl({
      app,
      env,
      envConfig,
      bootstrapState,
      runtimeMemory,
      platformRuntime,
      securityRuntime,
      runtimeSyncRuntime,
      coldcallingServiceRuntime,
      websiteInputRuntime,
      aiContentRuntime,
      uiSeoRuntime,
      agendaSupportRuntime,
      agendaPostCallHelpers,
      agendaLeadDetailService,
      aiHelpers,
      premiumLoginRateLimiter,
      getEffectivePublicBaseUrl,
      normalizePremiumSessionEmail,
      upsertRecentCallUpdate,
      shared: {
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        parseIntSafe: shared.parseIntSafe,
        parseNumberSafe: shared.parseNumberSafe,
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        normalizeAiSummaryStyle,
        generateTextSummaryWithAi,
        getClientIpFromRequest: shared.getClientIpFromRequest,
        getRequestPathname: shared.getRequestPathname,
        getRequestOriginFromHeaders: shared.getRequestOriginFromHeaders,
      },
    })
  );

  const agendaWiring = createServerAppAgendaWiringImpl(
    buildServerAppAgendaWiringRuntimeContextImpl({
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
      shared: {
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        normalizeColdcallingStack: shared.normalizeColdcallingStack,
        parseIntSafe: shared.parseIntSafe,
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        fetchBinaryWithTimeout: shared.fetchBinaryWithTimeout,
        normalizeAbsoluteHttpUrl,
      },
    })
  );

  agendaInterestedLeadReadService = agendaWiring.agendaInterestedLeadReadService;
  backfillOpenLeadFollowUpAppointmentsFromLatestCalls =
    agendaWiring.backfillOpenLeadFollowUpAppointmentsFromLatestCalls;
  upsertGeneratedAgendaAppointment = agendaWiring.upsertGeneratedAgendaAppointment;
  getRuntimeHtmlPageBootstrapData = agendaWiring.buildRuntimeHtmlPageBootstrapData;

  const { seedDemoConfirmationTaskForUiTesting } = createServerAppOpsWiringImpl(
    buildServerAppOpsWiringRuntimeContextImpl({
      app,
      env,
      envConfig,
      bootstrapState,
      runtimeMemory,
      platformRuntime,
      securityRuntime,
      runtimeSyncRuntime,
      uiSeoRuntime,
      routeManifest,
      appVersion,
      featureFlags,
      getPublicFeatureFlags,
      isServerlessRuntime,
      projectRootDir,
      websiteLinkCoordinator,
      getEffectivePublicBaseUrl,
      resolveLegacyPrettyPageRedirect,
      toPrettyPagePathFromHtmlFile,
      isSmtpMailConfigured,
      isImapMailConfigured,
      upsertRecentCallUpdate,
      upsertAiCallInsight,
      upsertGeneratedAgendaAppointment,
      queueRuntimeStatePersist,
      shared: {
        normalizeString: shared.normalizeString,
      },
    })
  );

  return {
    buildRuntimeBackupForOps,
    buildRuntimeStateSnapshotPayloadWithLimits,
    ensureRuntimeStateHydratedFromSupabase,
    runtimeSyncRuntime,
    seedDemoConfirmationTaskForUiTesting,
  };
}

function assembleServerAppRuntimeDomains(options) {
  return assembleServerAppRuntimeDomainsWithFactories(options, {
    createAgendaSupportRuntimeImpl: createAgendaSupportRuntime,
    createAgendaLeadDetailServiceImpl: createAgendaLeadDetailService,
    createAgendaPostCallHelpersImpl: createAgendaPostCallHelpers,
    createServerAppOperationalRuntimeImpl: createServerAppOperationalRuntime,
    createServerAppUiContentRuntimeImpl: createServerAppUiContentRuntime,
    createServerAppFeatureWiringImpl: createServerAppFeatureWiring,
    createServerAppAgendaWiringImpl: createServerAppAgendaWiring,
    createServerAppOpsWiringImpl: createServerAppOpsWiring,
    buildAgendaSupportRuntimeCompositionOptionsImpl:
      buildAgendaSupportRuntimeCompositionOptions,
    buildAgendaLeadDetailServiceOptionsImpl: buildAgendaLeadDetailServiceOptions,
    buildAgendaPostCallHelpersOptionsImpl: buildAgendaPostCallHelpersOptions,
    buildServerAppAgendaWiringRuntimeContextImpl:
      buildServerAppAgendaWiringRuntimeContext,
    buildServerAppFeatureWiringRuntimeContextImpl:
      buildServerAppFeatureWiringRuntimeContext,
    buildServerAppOperationalRuntimeContextImpl:
      buildServerAppOperationalRuntimeContext,
    buildServerAppOpsWiringRuntimeContextImpl:
      buildServerAppOpsWiringRuntimeContext,
    buildServerAppUiContentRuntimeCompositionContextImpl:
      buildServerAppUiContentRuntimeCompositionContext,
    normalizeAgendaRuntimePostCallStatusImpl: normalizeAgendaRuntimePostCallStatus,
    sanitizeAgendaRuntimePostCallTextImpl: sanitizeAgendaRuntimePostCallText,
  });
}

module.exports = {
  assembleServerAppRuntimeDomains,
  assembleServerAppRuntimeDomainsWithFactories,
};

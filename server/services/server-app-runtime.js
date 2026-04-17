const path = require('path');
const express = require('express');
const { FEATURE_FLAGS, getPublicFeatureFlags } = require('../config/feature-flags');
const {
  resolveLegacyPrettyPageRedirect,
  toPrettyPagePathFromHtmlFile,
} = require('../config/page-routing');
const { timingSafeEqualStrings } = require('../security/crypto-utils');
const {
  appendQueryParamsToUrl,
  assertWebsitePreviewUrlIsPublic,
  getEffectivePublicBaseUrl: resolveEffectivePublicBaseUrl,
  normalizeAbsoluteHttpUrl,
  normalizeWebsitePreviewTargetUrl,
} = require('../security/public-url');
const {
  getClientIpFromRequest,
  getRequestOriginFromHeaders,
  getRequestPathname,
  isSecureHttpRequest,
  normalizeIpAddress,
  normalizeOrigin,
} = require('../security/request-context');
const routeManifest = require('../routes/manifest');
const { createAgendaSupportRuntime } = require('./agenda-support-runtime');
const { createAiHelpers } = require('./ai-helpers');
const { createAgendaLeadDetailService } = require('./agenda-lead-detail');
const { resolveCallUpdateTimestamp } = require('./call-update-timestamp');
const { createAgendaPostCallHelpers } = require('./agenda-post-call');
const {
  normalizePostCallStatus: normalizeAgendaRuntimePostCallStatus,
  sanitizePostCallText: sanitizeAgendaRuntimePostCallText,
} = require('./agenda-runtime');
const {
  normalizeLeadLikePhoneKey: normalizeLeadLikePhoneKeyForCallUpdates,
} = require('./lead-identity');
const {
  fetchBinaryWithTimeout,
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
} = require('./runtime-fetch');
const {
  clipText,
  escapeHtml,
  normalizeColdcallingStack,
  normalizeNlPhoneToE164,
  normalizeString,
  parseIntSafe,
  parseNumberSafe,
  truncateText,
} = require('./runtime-primitives');
const { createServerAppUiContentRuntime } = require('./server-app-runtime-ui-content');
const {
  createServerAppFoundationRuntime,
  createServerAppOperationalRuntime,
} = require('./server-app-runtime-foundation');
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
const {
  createServerAppRuntimeBootstrap,
} = require('./server-app-runtime-bootstrap');
const {
  primeServerAppRuntime,
  startServerAppRuntime,
} = require('./server-app-runtime-startup');
require('dotenv').config();
const { version: APP_VERSION = '0.0.0' } = require('../../package.json');
const PROJECT_ROOT_DIR = path.resolve(__dirname, '../..');
const {
  app,
  runtimeEnv,
  runtimeMemory,
  isServerlessRuntime,
  envConfig,
  bootstrapState,
} = createServerAppRuntimeBootstrap({
  env: process.env,
  expressImpl: express,
  projectRootDir: PROJECT_ROOT_DIR,
  logger: console,
});

const {
  PORT,
  PUBLIC_BASE_URL,
  SUPABASE_STATE_TABLE,
  SUPABASE_STATE_KEY,
} = envConfig;

const {
  PREMIUM_PUBLIC_HTML_FILES,
  NOINDEX_HEADER_VALUE,
} = bootstrapState;

function getEffectivePublicBaseUrl(req = null, overrideValue = '') {
  return resolveEffectivePublicBaseUrl(req, overrideValue, PUBLIC_BASE_URL);
}

const normalizePremiumSessionEmail = (value) => {
  return normalizeString(value).toLowerCase();
};

const generateTextSummaryWithAi = (...args) => aiSummaryService.generateTextSummaryWithAi(...args);
const normalizeAiSummaryStyle = (...args) => aiSummaryService.normalizeAiSummaryStyle(...args);
const summaryContainsEnglishMarkers = (...args) =>
  aiSummaryService.summaryContainsEnglishMarkers(...args);

const {
  platformRuntime,
  securityRuntime,
  upsertRecentCallUpdate,
  queueRuntimeStatePersist,
  buildRuntimeStateSnapshotPayload,
  bindRuntimeSyncRuntime,
} = createServerAppFoundationRuntime({
  env: process.env,
  runtimeEnv,
  runtimeMemory,
  premiumPublicHtmlFiles: PREMIUM_PUBLIC_HTML_FILES,
  noindexHeaderValue: NOINDEX_HEADER_VALUE,
  foundationCallbacks: {
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    normalizeNlPhoneToE164,
    normalizeLeadLikePhoneKey: normalizeLeadLikePhoneKeyForCallUpdates,
    normalizePremiumSessionEmail,
    extractRetellTranscriptText: (...args) => extractRetellTranscriptText(...args),
    getLatestCallUpdateByCallId: (...args) => getLatestCallUpdateByCallId(...args),
  },
  shared: {
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
    escapeHtml,
  },
});

const {
  buildRetellApiUrl,
  buildRetellPayload,
  buildSupabaseCallUpdateStateKey,
  buildTwilioApiUrl,
  buildTwilioOutboundPayload,
  buildTwilioOutboundTwimlUrl,
  buildTwilioRecordingMediaUrl,
  buildTwilioRecordingProxyUrl,
  buildTwilioStatusCallbackUrl,
  buildVariableValues,
  choosePreferredTwilioRecording,
  classifyRetellFailure,
  classifyTwilioFailure,
  collectMissingCallUpdateRefreshCandidates,
  createRetellOutboundCall,
  createTwilioOutboundCall,
  extractCallIdFromRecordingUrl,
  extractCallIdFromSupabaseCallUpdateStateKey,
  extractCallUpdateFromRetellCallStatusResponse,
  extractCallUpdateFromRetellPayload,
  extractCallUpdateFromTwilioCallStatusResponse,
  extractCallUpdateFromTwilioPayload,
  extractTwilioRecordingSidFromUrl,
  fetchRetellCallStatusById,
  fetchSupabaseCallUpdateRowsViaRest,
  fetchSupabaseRowByKeyViaRest,
  fetchSupabaseStateRowViaRest,
  fetchTwilioCallStatusById,
  fetchTwilioRecordingsByCallId,
  findCallUpdateByRecordingReference,
  formatEuroLabel,
  getAnthropicDossierMaxTokens,
  getAnthropicApiKey,
  getColdcallingProvider,
  getColdcallingStackLabel,
  getDossierAnthropicModel,
  getMissingEnvVars,
  getOpenAiApiKey,
  getRequiredRetellEnv,
  getRequiredTwilioEnv,
  getSupabaseClient,
  getTwilioBasicAuthorizationHeader,
  getTwilioFromNumberForStack,
  getTwilioMediaWsUrlForStack,
  getTwilioStackEnvSuffixes,
  getWebsiteAnthropicModel,
  getWebsiteGenerationProvider,
  inferCallProvider,
  isRetellColdcallingConfigured,
  isSupabaseConfigured,
  isTerminalColdcallingStatus,
  isTwilioColdcallingConfigured,
  isTwilioStatusApiConfigured,
  normalizeDateYyyyMmDd,
  normalizeRecordingReference,
  normalizeTimeHhMm,
  parseDateToIso,
  parseTwilioRecordingDurationSeconds,
  parseTwilioRecordingUpdatedAtMs,
  redactSupabaseUrlForDebug,
  refreshCallUpdateFromRetellStatusApi,
  refreshCallUpdateFromTwilioStatusApi,
  resolveAppointmentCallId,
  resolveColdcallingProviderForCampaign,
  resolvePreferredRecordingUrl,
  shouldRefreshRetellCallStatus,
  toBooleanSafe,
  toIsoFromUnixMilliseconds,
  upsertSupabaseRowViaRest,
  upsertSupabaseStateRowViaRest,
} = platformRuntime;

const {
  appendDashboardActivity,
  appendSecurityAuditEvent,
  buildLeadOwnerFields,
  buildPremiumAuthSessionPayload,
  clearPremiumSessionCookie,
  createPremiumSessionToken,
  getPremiumAuthState,
  getResolvedPremiumAuthState,
  getSafePremiumRedirectPath,
  getStateChangingApiProtectionDecision,
  isPremiumAdminIpAllowed,
  isPremiumMfaCodeValid,
  isPremiumMfaConfigured,
  isPremiumPublicApiRequest,
  normalizeLeadOwnerRecord,
  premiumUsersStore,
  requirePremiumAdminApiAccess,
  requirePremiumApiAccess,
  requireRuntimeDebugAccess,
  resolvePremiumHtmlPageAccess,
  setPremiumSessionCookie,
} = securityRuntime;

let agendaInterestedLeadReadService = null;
const agendaSupportRuntime = createAgendaSupportRuntime(
  buildAgendaSupportRuntimeCompositionOptions({
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
    summaryContainsEnglishMarkers,
    generateTextSummaryWithAi,
    shared: {
      normalizeString,
      truncateText,
      normalizeColdcallingStack,
      parseNumberSafe,
      fetchJsonWithTimeout,
      extractOpenAiTextContent: (...args) => extractOpenAiTextContent(...args),
      parseJsonLoose: (...args) => parseJsonLoose(...args),
    },
  })
);
const {
  backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
  backfillInsightsAndAppointmentsFromRecentCallUpdates,
  buildConfirmationEmailDraftFallback,
  buildGeneratedAgendaAppointmentFromAiInsight,
  buildGeneratedLeadFollowUpFromCall,
  buildLeadToAgendaSummary,
  compareAgendaAppointments,
  compareConfirmationTasks,
  ensureRuleBasedInsightAndAppointment,
  extractAddressLikeLocationFromText,
  extractAgendaScheduleFromDashboardActivity,
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
  resolveAgendaLocationValue,
  resolveAppointmentLocation,
  resolveCallDurationSeconds,
  sanitizeAppointmentLocation,
  sanitizeAppointmentWhatsappInfo,
  sendConfirmationEmailViaSmtp,
  setGeneratedAgendaAppointmentAtIndex,
  syncInboundConfirmationEmailsFromImap,
  upsertAiCallInsight,
} = agendaSupportRuntime;

const {
  runtimeSyncRuntime,
  coldcallingServiceRuntime,
  premiumLoginRateLimiter,
} = createServerAppOperationalRuntime(
  buildServerAppOperationalRuntimeContext({
    app,
    env: process.env,
    express,
    runtimeEnv,
    runtimeMemory,
    appVersion: APP_VERSION,
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
    },
  })
);

const {
  applyRuntimeStateSnapshotPayload,
  buildCallUpdateRowPersistMeta,
  buildRuntimeBackupForOps,
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
  syncCallUpdatesFromSupabaseRows,
  syncRuntimeStateFromSupabaseIfNewer,
  waitForQueuedCallUpdateRowPersist,
  waitForQueuedRuntimeSnapshotPersist,
  waitForQueuedRuntimeStatePersist,
} = runtimeSyncRuntime;

const {
  sleep,
  createSequentialDispatchQueue,
  advanceSequentialDispatchQueue,
  handleRetellWebhook,
  handleTwilioInboundVoice,
  handleTwilioStatusWebhook,
  processColdcallingLead,
  processRetellColdcallingLead,
  processTwilioColdcallingLead,
  triggerPostCallAutomation,
  validateStartPayload,
} = coldcallingServiceRuntime;

let getRuntimeHtmlPageBootstrapData = async () => null;
const {
  websiteInputRuntime,
  websiteGenerationRuntime,
  aiHelpers,
  uiSeoRuntime,
  aiContentRuntime,
} = createServerAppUiContentRuntime(
  buildServerAppUiContentRuntimeCompositionContext({
    env: process.env,
    runtimeEnv,
    runtimeMemory,
    projectRootDir: PROJECT_ROOT_DIR,
    bootstrapState,
    platformRuntime,
    securityRuntime,
    runtimeSyncRuntime,
    getPageBootstrapData: (req, fileName) => getRuntimeHtmlPageBootstrapData(req, fileName),
    getEffectivePublicBaseUrl,
    resolveLegacyPrettyPageRedirect,
    shared: {
      normalizeString,
      truncateText,
      clipText,
      escapeHtml,
      parseIntSafe,
      fetchJsonWithTimeout,
      fetchTextWithTimeout,
      assertWebsitePreviewUrlIsPublic,
      normalizeAbsoluteHttpUrl,
      normalizeWebsitePreviewTargetUrl,
    },
  })
);

const { parseImageDataUrl, sanitizeReferenceImages, sanitizeLaunchDomainName, slugifyAutomationText } =
  websiteInputRuntime;
const {
  buildAnthropicWebsiteHtmlPrompts,
  buildLocalWebsiteBlueprint,
  buildWebsiteGenerationContext,
  buildWebsiteGenerationPrompts,
  buildWebsitePreviewBriefFromScan,
  buildWebsitePreviewDownloadFileName,
  buildWebsitePreviewPromptFromScan,
  ensureHtmlDocument,
  ensureStrictAnthropicHtml,
  getAnthropicWebsiteStageEffort,
  getAnthropicWebsiteStageMaxTokens,
  isLikelyUsableWebsiteHtml,
  supportsAnthropicAdaptiveThinking,
} = websiteGenerationRuntime;
const {
  estimateAnthropicTextCost,
  estimateAnthropicUsageCost,
  estimateOpenAiTextCost,
  estimateOpenAiUsageCost,
  extractAnthropicTextContent,
  extractOpenAiTextContent,
  extractRetellTranscriptText,
  extractTranscriptFull,
  extractTranscriptSnippet,
  extractTranscriptText,
  parseJsonLoose,
} = aiHelpers;
const {
  getUiStateValues,
  normalizeUiStateScope,
  sanitizeUiStateValues,
  setUiStateValues,
  extractWebsitePreviewScanFromHtml,
  sendSeoManagedHtmlPageResponse,
  seoReadCoordinator,
  seoWriteCoordinator,
  runtimeOpsCoordinator,
  runtimeDebugOpsCoordinator,
  websiteLinkCoordinator,
} = uiSeoRuntime;
const {
  aiSummaryService,
  buildOrderDossierFallbackLayout,
  buildOrderDossierInput,
  buildWebsitePromptFallback,
  extractMeetingNotesFromImageWithAi,
  fetchWebsitePreviewScanFromUrl,
  generateDynamicOrderDossierWithAnthropic,
  generateWebsiteHtmlWithAi,
  generateWebsitePreviewImageWithAi,
  generateWebsitePromptFromTranscriptWithAi,
} = aiContentRuntime;

const agendaLeadDetailService = createAgendaLeadDetailService(
  buildAgendaLeadDetailServiceOptions({
    env: process.env,
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
      normalizeString,
      truncateText,
      normalizeAbsoluteHttpUrl,
      fetchBinaryWithTimeout,
    },
  })
);

const {
  buildCallBackedLeadDetail,
  buildConversationSummaryForLeadDetail,
  buildRecordingFileNameForTranscription,
  getAppointmentTranscriptText,
  getOpenAiTranscriptionModelCandidates,
  pickReadableConversationSummaryForLeadDetail,
} = agendaLeadDetailService;

const normalizePostCallStatus = (value) =>
  normalizeAgendaRuntimePostCallStatus(value, normalizeString, truncateText);
const sanitizePostCallText = (value, maxLen = 20000) =>
  sanitizeAgendaRuntimePostCallText(value, normalizeString, truncateText, maxLen);

const agendaPostCallHelpers = createAgendaPostCallHelpers(
  buildAgendaPostCallHelpersOptions({
    normalizeString,
    truncateText,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    sanitizePostCallText,
    normalizePostCallStatus,
  })
);

const { activeOrdersCoordinator, aiDashboardCoordinator, aiToolsCoordinator } =
  createServerAppFeatureWiring(
    buildServerAppFeatureWiringRuntimeContext({
      app,
      env: process.env,
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
        normalizeString,
        truncateText,
        parseIntSafe,
        parseNumberSafe,
        fetchJsonWithTimeout,
        normalizeAiSummaryStyle,
        generateTextSummaryWithAi,
        getClientIpFromRequest,
        getRequestPathname,
        getRequestOriginFromHeaders,
      },
    })
  );

const {
  agendaInterestedLeadReadService: wiredAgendaInterestedLeadReadService,
  backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
  upsertGeneratedAgendaAppointment,
  buildRuntimeHtmlPageBootstrapData,
} = createServerAppAgendaWiring(
  buildServerAppAgendaWiringRuntimeContext({
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
      normalizeString,
      truncateText,
      normalizeColdcallingStack,
      parseIntSafe,
      fetchJsonWithTimeout,
      fetchBinaryWithTimeout,
      normalizeAbsoluteHttpUrl,
    },
  })
);

agendaInterestedLeadReadService = wiredAgendaInterestedLeadReadService;
getRuntimeHtmlPageBootstrapData = buildRuntimeHtmlPageBootstrapData;

const { seedDemoConfirmationTaskForUiTesting } = createServerAppOpsWiring(
  buildServerAppOpsWiringRuntimeContext({
    app,
    env: process.env,
    envConfig,
    bootstrapState,
    runtimeMemory,
    platformRuntime,
    securityRuntime,
    runtimeSyncRuntime,
    uiSeoRuntime,
    routeManifest,
    appVersion: APP_VERSION,
    featureFlags: FEATURE_FLAGS,
    getPublicFeatureFlags,
    isServerlessRuntime,
    projectRootDir: PROJECT_ROOT_DIR,
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
      normalizeString,
    },
  })
);

// In serverless (zoals Vercel) wordt startServer() niet aangeroepen, dus seed de
// demo-taak ook bij module-load. De functie is idempotent op basis van callId.
primeServerAppRuntime({
  seedDemoConfirmationTaskForUiTesting,
  ensureRuntimeStateHydratedFromSupabase,
});

function startServer() {
  startServerAppRuntime({
    app,
    port: PORT,
    getColdcallingProvider,
    getMissingEnvVars,
    isSupabaseConfigured,
    supabaseStateTable: SUPABASE_STATE_TABLE,
    supabaseStateKey: SUPABASE_STATE_KEY,
    seedDemoConfirmationTaskForUiTesting,
    ensureRuntimeStateHydratedFromSupabase,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });
}

module.exports = {
  app,
  isServerlessRuntime,
  normalizeNlPhoneToE164,
  startServer,
  buildRuntimeStateSnapshotPayloadWithLimits,
  buildRuntimeBackupForOps,
};

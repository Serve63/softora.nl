const { registerPublicPageRoutes } = require('../routes/public-pages');
const { registerHealthAndOpsRoutes } = require('../routes/health');
const { createRuntimeStatusService } = require('./runtime-status');
const { createDemoConfirmationSeedService } = require('./demo-confirmation-seed');

function createAppOpsRuntime(deps = {}) {
  const {
    app,
    env,
    isSupabaseConfigured,
    runtimeStateSyncState,
    supabaseStateTable,
    supabaseStateKey,
    isSmtpMailConfigured,
    isImapMailConfigured,
    mailImapMailbox,
    mailImapPollCooldownMs,
    confirmationMailRuntimeState,
    getColdcallingProvider,
    normalizeString,
    getMissingEnvVars,
    premiumSessionSecret,
    premiumSessionCookieName,
    isPremiumMfaConfigured,
    recentWebhookEvents,
    recentCallUpdates,
    recentAiCallInsights,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    appName,
    appVersion,
    featureFlags,
    getPublicFeatureFlags,
    routeManifest,
    requireRuntimeDebugAccess,
    buildRuntimeStateSnapshotPayloadWithLimits,
    buildRuntimeBackupForOps,
    isProduction,
    isServerlessRuntime,
    assetsDirectory,
    securityContactEmail,
    getEffectivePublicBaseUrl,
    sendSeoManagedHtmlPageResponse,
    resolveLegacyPrettyPageRedirect,
    toPrettyPagePathFromHtmlFile,
    knownHtmlPageFiles,
    knownPrettyPageSlugToFile,
    sendPublishedWebsiteLinkResponse,
    demoConfirmationTaskEnabled,
    upsertRecentCallUpdate,
    upsertAiCallInsight,
    upsertGeneratedAgendaAppointment,
    queueRuntimeStatePersist,
    ensureRuntimeStateHydratedFromSupabase,
    log = () => {},
  } = deps;

  const runtimeStatusService = createRuntimeStatusService({
    env,
    isSupabaseConfigured,
    runtimeStateSyncState,
    supabaseStateTable,
    supabaseStateKey,
    isSmtpMailConfigured,
    isImapMailConfigured,
    mailImapMailbox,
    mailImapPollCooldownMs,
    confirmationMailRuntimeState,
    getColdcallingProvider,
    normalizeString,
    getMissingEnvVars,
    premiumSessionSecret,
    premiumSessionCookieName,
    isPremiumMfaConfigured,
    recentWebhookEvents,
    recentCallUpdates,
    recentAiCallInsights,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
  });

  const deployment = {
    commitSha:
      normalizeString(env.VERCEL_GIT_COMMIT_SHA) ||
      normalizeString(env.GITHUB_SHA) ||
      normalizeString(env.COMMIT_SHA) ||
      null,
    commitRef:
      normalizeString(env.VERCEL_GIT_COMMIT_REF) ||
      normalizeString(env.GITHUB_REF_NAME) ||
      normalizeString(env.BRANCH) ||
      null,
    provider: normalizeString(env.VERCEL) ? 'vercel' : null,
  };

  const {
    getSupabaseStatus,
    getMailStatus,
    getAiStatus,
    getSessionStatus,
    getRuntimeStatus,
  } = runtimeStatusService;

  registerHealthAndOpsRoutes(app, {
    appName,
    appVersion,
    featureFlags,
    getPublicFeatureFlags,
    routeManifest,
    requireRuntimeDebugAccess,
    buildRuntimeStateSnapshotPayloadWithLimits,
    buildRuntimeBackupForOps,
    isProduction,
    isServerlessRuntime,
    deployment,
    isSupabaseConfigured,
    getSupabaseStatus,
    getMailStatus,
    getAiStatus,
    getSessionStatus,
    getRuntimeStatus,
  });

  registerPublicPageRoutes(app, {
    assetsDirectory,
    securityContactEmail,
    getEffectivePublicBaseUrl,
    sendSeoManagedHtmlPageResponse,
    resolveLegacyPrettyPageRedirect,
    toPrettyPagePathFromHtmlFile,
    knownHtmlPageFiles,
    knownPrettyPageSlugToFile,
    sendPublishedWebsiteLinkResponse,
  });

  const { seedDemoConfirmationTaskForUiTesting } = createDemoConfirmationSeedService({
    nodeEnv: env.NODE_ENV,
    demoConfirmationTaskEnabled,
    generatedAgendaAppointments,
    normalizeString,
    upsertRecentCallUpdate,
    upsertAiCallInsight,
    upsertGeneratedAgendaAppointment,
    queueRuntimeStatePersist,
    log,
  });

  return {
    seedDemoConfirmationTaskForUiTesting,
    ensureRuntimeStateHydratedFromSupabase,
  };
}

module.exports = {
  createAppOpsRuntime,
};

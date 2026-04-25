const { loadRuntimeEnv } = require('../config/runtime-env');
const {
  createKnownPrettyPageSlugToFile,
  getKnownHtmlPageFiles,
} = require('../config/page-routing');
const { createPremiumPublicHtmlFilesSet } = require('../config/premium-public-html-files');
const { createRuntimeMemoryState } = require('./runtime-memory');

function buildServerAppEnvConfig(runtimeEnv) {
  const googleCalendar = runtimeEnv.googleCalendar || {};
  return {
    PORT: runtimeEnv.app.port,
    IS_PRODUCTION: runtimeEnv.app.isProduction,
    PUBLIC_BASE_URL: runtimeEnv.app.publicBaseUrl,
    RETELL_API_BASE_URL: runtimeEnv.ai.retellApiBaseUrl,
    TWILIO_API_BASE_URL: runtimeEnv.ai.twilioApiBaseUrl,
    OPENAI_API_BASE_URL: runtimeEnv.ai.openaiApiBaseUrl,
    OPENAI_MODEL: runtimeEnv.ai.openaiModel,
    OPENAI_IMAGE_MODEL: runtimeEnv.ai.openaiImageModel,
    ANTHROPIC_API_BASE_URL: runtimeEnv.ai.anthropicApiBaseUrl,
    ANTHROPIC_MODEL: runtimeEnv.ai.anthropicModel,
    WEBSITE_ANTHROPIC_MODEL: runtimeEnv.ai.websiteAnthropicModel,
    DOSSIER_ANTHROPIC_MODEL: runtimeEnv.ai.dossierAnthropicModel,
    VERBOSE_CALL_WEBHOOK_LOGS: runtimeEnv.ai.verboseCallWebhookLogs,
    DEFAULT_TWILIO_MEDIA_WS_URL: runtimeEnv.ai.defaultTwilioMediaWsUrl,
    WEBSITE_GENERATION_PROVIDER: runtimeEnv.websiteGeneration.provider,
    WEBSITE_GENERATION_STRICT_ANTHROPIC: runtimeEnv.websiteGeneration.strictAnthropic,
    WEBSITE_GENERATION_STRICT_HTML: runtimeEnv.websiteGeneration.strictHtml,
    WEBSITE_GENERATION_TIMEOUT_MS: runtimeEnv.websiteGeneration.timeoutMs,
    ACTIVE_ORDER_AUTOMATION_ENABLED: runtimeEnv.activeOrderAutomation.enabled,
    ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN: runtimeEnv.activeOrderAutomation.githubToken,
    ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER: runtimeEnv.activeOrderAutomation.githubOwner,
    ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE: runtimeEnv.activeOrderAutomation.githubPrivate,
    ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG: runtimeEnv.activeOrderAutomation.githubOwnerIsOrg,
    ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX: runtimeEnv.activeOrderAutomation.githubRepoPrefix,
    ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH: runtimeEnv.activeOrderAutomation.githubDefaultBranch,
    ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN: runtimeEnv.activeOrderAutomation.vercelToken,
    ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE: runtimeEnv.activeOrderAutomation.vercelScope,
    ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND: runtimeEnv.activeOrderAutomation.stratoCommand,
    ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL: runtimeEnv.activeOrderAutomation.stratoWebhookUrl,
    ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN: runtimeEnv.activeOrderAutomation.stratoWebhookToken,
    SUPABASE_URL: runtimeEnv.supabase.url,
    SUPABASE_SERVICE_ROLE_KEY: runtimeEnv.supabase.serviceRoleKey,
    SUPABASE_STATE_TABLE: runtimeEnv.supabase.stateTable,
    SUPABASE_STATE_KEY: runtimeEnv.supabase.stateKey,
    SUPABASE_CALL_UPDATE_STATE_KEY_PREFIX: runtimeEnv.supabase.callUpdateStateKeyPrefix,
    SUPABASE_DISMISSED_LEADS_STATE_KEY: runtimeEnv.supabase.dismissedLeadsStateKey,
    SUPABASE_CALL_UPDATE_ROWS_FETCH_LIMIT: runtimeEnv.supabase.callUpdateRowsFetchLimit,
    PREMIUM_LOGIN_EMAILS: runtimeEnv.premiumAuth.loginEmails,
    PREMIUM_LOGIN_PASSWORD: runtimeEnv.premiumAuth.loginPassword,
    PREMIUM_LOGIN_PASSWORD_HASH: runtimeEnv.premiumAuth.loginPasswordHash,
    PREMIUM_SESSION_SECRET: runtimeEnv.premiumAuth.sessionSecret,
    PREMIUM_SESSION_TTL_HOURS: runtimeEnv.premiumAuth.sessionTtlHours,
    PREMIUM_SESSION_REMEMBER_TTL_DAYS: runtimeEnv.premiumAuth.sessionRememberTtlDays,
    PREMIUM_SESSION_COOKIE_NAME: runtimeEnv.premiumAuth.sessionCookieName,
    PREMIUM_MFA_TOTP_SECRET: runtimeEnv.premiumAuth.mfaTotpSecret,
    PREMIUM_ADMIN_IP_ALLOWLIST: runtimeEnv.premiumAuth.adminIpAllowlist,
    PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS: runtimeEnv.premiumAuth.enforceSameOriginRequests,
    PREMIUM_ENABLE_RUNTIME_DEBUG_ROUTES: runtimeEnv.premiumAuth.enableRuntimeDebugRoutes,
    MAIL_SMTP_HOST: runtimeEnv.mail.smtpHost,
    MAIL_SMTP_PORT: runtimeEnv.mail.smtpPort,
    MAIL_SMTP_USER: runtimeEnv.mail.smtpUser,
    MAIL_SMTP_PASS: runtimeEnv.mail.smtpPass,
    MAIL_SMTP_SECURE: runtimeEnv.mail.smtpSecure,
    MAIL_FROM_ADDRESS: runtimeEnv.mail.fromAddress,
    MAIL_FROM_NAME: runtimeEnv.mail.fromName,
    MAIL_REPLY_TO: runtimeEnv.mail.replyTo,
    MAIL_IMAP_HOST: runtimeEnv.mail.imapHost,
    MAIL_IMAP_PORT: runtimeEnv.mail.imapPort,
    MAIL_IMAP_SECURE: runtimeEnv.mail.imapSecure,
    MAIL_IMAP_USER: runtimeEnv.mail.imapUser,
    MAIL_IMAP_PASS: runtimeEnv.mail.imapPass,
    MAIL_IMAP_MAILBOX: runtimeEnv.mail.imapMailbox,
    MAIL_IMAP_EXTRA_MAILBOXES: runtimeEnv.mail.imapExtraMailboxes,
    MAIL_IMAP_POLL_COOLDOWN_MS: runtimeEnv.mail.imapPollCooldownMs,
    GOOGLE_CALENDAR_SYNC_ENABLED: Boolean(googleCalendar.enabled),
    GOOGLE_CALENDAR_CLIENT_EMAIL: googleCalendar.clientEmail || '',
    GOOGLE_CALENDAR_PRIVATE_KEY: googleCalendar.privateKey || '',
    GOOGLE_CALENDAR_SERVE_ID: googleCalendar.serveCalendarId || '',
    GOOGLE_CALENDAR_MARTIJN_ID: googleCalendar.martijnCalendarId || '',
    GOOGLE_CALENDAR_TIMEZONE: googleCalendar.timezone || 'Europe/Amsterdam',
    GOOGLE_CALENDAR_SYNC_COOLDOWN_MS: googleCalendar.syncCooldownMs || 60000,
    SECURITY_CONTACT_EMAIL: runtimeEnv.securityContactEmail,
    DEMO_CONFIRMATION_TASK_ENABLED: runtimeEnv.demoConfirmationTaskEnabled,
  };
}

function buildServerAppRuntimeMemoryState(runtimeMemory) {
  return {
    recentWebhookEvents: runtimeMemory.recentWebhookEvents,
    recentCallUpdates: runtimeMemory.recentCallUpdates,
    callUpdatesById: runtimeMemory.callUpdatesById,
    retellCallStatusRefreshByCallId: runtimeMemory.retellCallStatusRefreshByCallId,
    recentAiCallInsights: runtimeMemory.recentAiCallInsights,
    recentDashboardActivities: runtimeMemory.recentDashboardActivities,
    recentSecurityAuditEvents: runtimeMemory.recentSecurityAuditEvents,
    inMemoryUiStateByScope: runtimeMemory.inMemoryUiStateByScope,
    aiCallInsightsByCallId: runtimeMemory.aiCallInsightsByCallId,
    aiAnalysisFingerprintByCallId: runtimeMemory.aiAnalysisFingerprintByCallId,
    aiAnalysisInFlightCallIds: runtimeMemory.aiAnalysisInFlightCallIds,
    callRecordingTranscriptionPromiseByCallId: runtimeMemory.callRecordingTranscriptionPromiseByCallId,
    generatedAgendaAppointments: runtimeMemory.generatedAgendaAppointments,
    agendaAppointmentIdByCallId: runtimeMemory.agendaAppointmentIdByCallId,
    dismissedInterestedLeadCallIds: runtimeMemory.dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys: runtimeMemory.dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey: runtimeMemory.dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId: runtimeMemory.leadOwnerAssignmentsByCallId,
    sequentialDispatchQueues: runtimeMemory.sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId: runtimeMemory.sequentialDispatchQueueIdByCallId,
    confirmationMailRuntimeState: runtimeMemory.confirmationMailRuntimeState,
    runtimeStateSyncState: runtimeMemory.runtimeStateSyncState,
    getNextLeadOwnerRotationIndex: runtimeMemory.getNextLeadOwnerRotationIndex,
    setNextLeadOwnerRotationIndex: runtimeMemory.setNextLeadOwnerRotationIndex,
    getNextGeneratedAgendaAppointmentId: runtimeMemory.getNextGeneratedAgendaAppointmentId,
    takeNextGeneratedAgendaAppointmentId: runtimeMemory.takeNextGeneratedAgendaAppointmentId,
    createSequentialDispatchQueueId: runtimeMemory.createSequentialDispatchQueueId,
  };
}

function createServerAppRuntimeBootstrap(
  {
    env,
    expressImpl,
    projectRootDir,
    logger = console,
  },
  dependencies = {}
) {
  const {
    loadRuntimeEnvImpl = loadRuntimeEnv,
    createKnownPrettyPageSlugToFileImpl = createKnownPrettyPageSlugToFile,
    getKnownHtmlPageFilesImpl = getKnownHtmlPageFiles,
    createPremiumPublicHtmlFilesSetImpl = createPremiumPublicHtmlFilesSet,
    createRuntimeMemoryStateImpl = createRuntimeMemoryState,
  } = dependencies;

  const runtimeEnv = loadRuntimeEnvImpl(env);
  const runtimeMemory = createRuntimeMemoryStateImpl();
  const knownHtmlPageFiles = getKnownHtmlPageFilesImpl(projectRootDir, logger);
  const knownPrettyPageSlugToFile = createKnownPrettyPageSlugToFileImpl(knownHtmlPageFiles);
  const PREMIUM_PUBLIC_HTML_FILES = createPremiumPublicHtmlFilesSetImpl();
  const app = expressImpl();

  if (app && typeof app.set === 'function') {
    app.set('trust proxy', 1);
  }

  return {
    app,
    runtimeEnv,
    runtimeMemory,
    envConfig: buildServerAppEnvConfig(runtimeEnv),
    runtimeMemoryState: buildServerAppRuntimeMemoryState(runtimeMemory),
    bootstrapState: {
      PREMIUM_PUBLIC_HTML_FILES,
      NOINDEX_HEADER_VALUE: 'noindex, nofollow, noarchive, nosnippet',
      PREMIUM_AUTH_USERS_ROW_KEY: 'premium_auth_users',
      PREMIUM_AUTH_USERS_VERSION: 1,
      RETELL_STATUS_REFRESH_COOLDOWN_MS: 8000,
      RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS: 4000,
      RUNTIME_STATE_REMOTE_NEWER_THRESHOLD_MS: 250,
      UI_STATE_SCOPE_PREFIX: 'ui_state:',
      PREMIUM_ACTIVE_ORDERS_SCOPE: 'premium_active_orders',
      PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY: 'softora_custom_orders_premium_v1',
      PREMIUM_ACTIVE_RUNTIME_KEY: 'softora_order_runtime_premium_v1',
      PREMIUM_CUSTOMERS_SCOPE: 'premium_customers_database',
      PREMIUM_CUSTOMERS_KEY: 'softora_customers_premium_v1',
      SEO_UI_STATE_SCOPE: 'seo',
      SEO_UI_STATE_CONFIG_KEY: 'config_json',
      SEO_CONFIG_CACHE_TTL_MS: 15_000,
      SEO_MAX_IMAGES_PER_PAGE: 2000,
      SEO_DEFAULT_SITE_ORIGIN: 'https://www.softora.nl',
      SEO_MODEL_PRESETS: Object.freeze([
        { value: 'gpt-5.5', label: 'GPT-5.5' },
        { value: 'gpt-5.1', label: 'GPT-5.1' },
        { value: 'claude-opus-4.6', label: 'Opus 4.6' },
        { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
      ]),
      SEO_PAGE_FIELD_DEFS: [
        { key: 'title', maxLength: 300 },
        { key: 'metaDescription', maxLength: 1000 },
        { key: 'metaKeywords', maxLength: 1000 },
        { key: 'canonical', maxLength: 1200 },
        { key: 'robots', maxLength: 250 },
        { key: 'ogTitle', maxLength: 300 },
        { key: 'ogDescription', maxLength: 1000 },
        { key: 'ogImage', maxLength: 1200 },
        { key: 'twitterTitle', maxLength: 300 },
        { key: 'twitterDescription', maxLength: 1000 },
        { key: 'twitterImage', maxLength: 1200 },
        { key: 'h1', maxLength: 300 },
      ],
      knownHtmlPageFiles,
      knownPrettyPageSlugToFile,
    },
    isServerlessRuntime:
      Boolean(env.VERCEL) ||
      Boolean(env.AWS_LAMBDA_FUNCTION_NAME) ||
      Boolean(env.LAMBDA_TASK_ROOT),
  };
}

module.exports = {
  buildServerAppEnvConfig,
  buildServerAppRuntimeMemoryState,
  createServerAppRuntimeBootstrap,
};

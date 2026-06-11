const {
  buildServerAppFeatureWiringContext,
} = require('./server-app-runtime-composition-options');
const { createColdmailCampaignService } = require('./coldmail-campaign');
const { createInstantlyOutreachService } = require('./instantly-outreach');
const { createOutboundRecipientGuardStore } = require('./outbound-recipient-guard-store');

const DATA_OPS_UI_STATE_READ_TIMEOUT_MS = 2500;

function isTransientDataOpsUiStateReadError(error) {
  const text = String(error?.message || error?.details || error?.hint || error?.code || error || '').trim();
  return (
    error?.code === 'DATA_OPS_FEATURE_UI_STATE_TIMEOUT' ||
    /abort|timeout|timed out|statement timeout|504|522|fetch failed|network|econnreset|etimedout|connection terminated|temporar/i.test(text)
  );
}

async function awaitDataOpsUiStateWithTimeout(promise, scope) {
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(
            `DataOps UI-state read timeout na ${Math.round(DATA_OPS_UI_STATE_READ_TIMEOUT_MS / 1000)}s voor ${scope}`
          );
          error.code = 'DATA_OPS_FEATURE_UI_STATE_TIMEOUT';
          reject(error);
        }, DATA_OPS_UI_STATE_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function createDataOpsAwareUiStateGetter(uiSeoRuntime = {}) {
  const legacyGetUiStateValues =
    typeof uiSeoRuntime.getUiStateValues === 'function'
      ? (...args) => uiSeoRuntime.getUiStateValues(...args)
      : async () => null;

  return async (scope, ...args) => {
    const dataOpsBridge = uiSeoRuntime.dataOpsUiStateBridge;
    if (
      dataOpsBridge &&
      typeof dataOpsBridge.canHandleScope === 'function' &&
      dataOpsBridge.canHandleScope(scope) &&
      typeof dataOpsBridge.getUiStateValues === 'function'
    ) {
      try {
        const bridged = await awaitDataOpsUiStateWithTimeout(
          dataOpsBridge.getUiStateValues(scope, {
            legacyGetUiStateValues,
          }),
          scope
        );
        if (bridged) return bridged;
      } catch (error) {
        console.warn('[DataOps][feature-ui-state-fallback]', error?.message || error);
        if (isTransientDataOpsUiStateReadError(error)) {
          console.warn('[DataOps][feature-ui-state-legacy-fallback]', scope);
          return legacyGetUiStateValues(scope, ...args);
        }
      }
    }
    return legacyGetUiStateValues(scope, ...args);
  };
}

function createDataOpsAwareUiStateSetter(uiSeoRuntime = {}) {
  const legacySetUiStateValues =
    typeof uiSeoRuntime.setUiStateValues === 'function'
      ? (...args) => uiSeoRuntime.setUiStateValues(...args)
      : async () => null;

  return async (scope, values, meta = {}, ...args) => {
    const dataOpsBridge = uiSeoRuntime.dataOpsUiStateBridge;
    if (
      dataOpsBridge &&
      typeof dataOpsBridge.canHandleScope === 'function' &&
      dataOpsBridge.canHandleScope(scope) &&
      typeof dataOpsBridge.setUiStateValues === 'function'
    ) {
      const bridged = await dataOpsBridge.setUiStateValues(scope, values, meta);
      if (bridged) return bridged;
      if (meta && meta.requireDataOps) {
        const error = new Error(`DataOps-opslag voor ${scope} gaf geen bevestiging terug.`);
        error.code = 'DATA_OPS_REQUIRED_WRITE_FAILED';
        throw error;
      }
    }
    return legacySetUiStateValues(scope, values, meta, ...args);
  };
}

function buildServerAppFeatureWiringRuntimeContext({
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
  shared,
}) {
  const instantlySyncEnabled = Boolean(envConfig.INSTANTLY_ENABLED && envConfig.INSTANTLY_SYNC_ENABLED);
  const instantlySchedulerEnabled = Boolean(
    instantlySyncEnabled &&
      envConfig.INSTANTLY_SCHEDULER_ENABLED &&
      !(env && (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT))
  );
  const dataOpsAwareUiStateGetter = createDataOpsAwareUiStateGetter(uiSeoRuntime);
  const dataOpsAwareUiStateSetter = createDataOpsAwareUiStateSetter(uiSeoRuntime);
  const outboundRecipientGuardStore = createOutboundRecipientGuardStore({
    isSupabaseConfigured: platformRuntime.isSupabaseConfigured,
    getSupabaseClient: platformRuntime.getSupabaseClient,
    normalizeString: shared.normalizeString,
    truncateText: shared.truncateText,
    logger: console,
  });

  return buildServerAppFeatureWiringContext({
    app,
    aiDashboardOptions: {
      activeOrderAutomation: {
        enabled: envConfig.ACTIVE_ORDER_AUTOMATION_ENABLED,
        githubToken: envConfig.ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN,
        githubOwner: envConfig.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER,
        githubPrivate: envConfig.ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE,
        githubOwnerIsOrg: envConfig.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG,
        githubRepoPrefix: envConfig.ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX,
        githubDefaultBranch: envConfig.ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH,
        vercelToken: envConfig.ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN,
        vercelScope: envConfig.ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE,
        stratoCommand: envConfig.ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND,
        stratoWebhookUrl: envConfig.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL,
        stratoWebhookToken: envConfig.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN,
      },
      normalizeString: shared.normalizeString,
      truncateText: shared.truncateText,
      sanitizeReferenceImages: websiteInputRuntime.sanitizeReferenceImages,
      sanitizeLaunchDomainName: websiteInputRuntime.sanitizeLaunchDomainName,
      generateWebsiteHtmlWithAi: aiContentRuntime.generateWebsiteHtmlWithAi,
      appendDashboardActivity: securityRuntime.appendDashboardActivity,
      getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
      getAnthropicApiKey: platformRuntime.getAnthropicApiKey,
      getWebsiteGenerationProvider: platformRuntime.getWebsiteGenerationProvider,
      getWebsiteAnthropicModel: platformRuntime.getWebsiteAnthropicModel,
      anthropicApiBaseUrl: envConfig.ANTHROPIC_API_BASE_URL,
      anthropicModel: envConfig.ANTHROPIC_MODEL,
      openAiModel: envConfig.OPENAI_MODEL,
      websiteGenerationStrictAnthropic: envConfig.WEBSITE_GENERATION_STRICT_ANTHROPIC,
      websiteGenerationStrictHtml: envConfig.WEBSITE_GENERATION_STRICT_HTML,
      fetchWebsitePreviewScanFromUrl: aiContentRuntime.fetchWebsitePreviewScanFromUrl,
      generateWebsitePreviewImageWithAi: aiContentRuntime.generateWebsitePreviewImageWithAi,
      openAiImageModel: envConfig.OPENAI_IMAGE_MODEL,
      buildOrderDossierInput: aiContentRuntime.buildOrderDossierInput,
      generateDynamicOrderDossierWithAnthropic:
        aiContentRuntime.generateDynamicOrderDossierWithAnthropic,
      buildOrderDossierFallbackLayout: aiContentRuntime.buildOrderDossierFallbackLayout,
      getDossierAnthropicModel: platformRuntime.getDossierAnthropicModel,
      generateWebsitePromptFromTranscriptWithAi:
        aiContentRuntime.generateWebsitePromptFromTranscriptWithAi,
      buildWebsitePromptFallback: aiContentRuntime.buildWebsitePromptFallback,
      extractMeetingNotesFromImageWithAi: aiContentRuntime.extractMeetingNotesFromImageWithAi,
      summarizeMeetingTranscriptWithAi: aiContentRuntime.summarizeMeetingTranscriptWithAi,
      transcribeMeetingAudioWithAi: aiContentRuntime.transcribeMeetingAudioWithAi,
      logger: console,
      parseJsonLoose: aiHelpers.parseJsonLoose,
      getUiStateValues: uiSeoRuntime.getUiStateValues,
      parseNumberSafe: shared.parseNumberSafe,
      normalizeDateYyyyMmDd: platformRuntime.normalizeDateYyyyMmDd,
      normalizeTimeHhMm: platformRuntime.normalizeTimeHhMm,
      toBooleanSafe: platformRuntime.toBooleanSafe,
      resolvePreferredRecordingUrl: platformRuntime.resolvePreferredRecordingUrl,
      premiumActiveOrdersScope: bootstrapState.PREMIUM_ACTIVE_ORDERS_SCOPE,
      premiumCustomersScope: bootstrapState.PREMIUM_CUSTOMERS_SCOPE,
      premiumActiveCustomOrdersKey: bootstrapState.PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY,
      premiumActiveRuntimeKey: bootstrapState.PREMIUM_ACTIVE_RUNTIME_KEY,
      premiumCustomersKey: bootstrapState.PREMIUM_CUSTOMERS_KEY,
      parseCustomOrdersFromUiState: agendaPostCallHelpers.parseCustomOrdersFromUiState,
      recentCallUpdates: runtimeMemory.recentCallUpdates,
      generatedAgendaAppointments: runtimeMemory.generatedAgendaAppointments,
      recentAiCallInsights: runtimeMemory.recentAiCallInsights,
      recentDashboardActivities: runtimeMemory.recentDashboardActivities,
      fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
      openAiApiBaseUrl: envConfig.OPENAI_API_BASE_URL,
      extractOpenAiTextContent: aiHelpers.extractOpenAiTextContent,
      ensureDashboardChatRuntimeReady: async () => {
        if (
          platformRuntime.isSupabaseConfigured() &&
          !runtimeMemory.runtimeStateSyncState.supabaseStateHydrated
        ) {
          await runtimeSyncRuntime.forceHydrateRuntimeStateWithRetries(3);
        }
        agendaSupportRuntime.backfillInsightsAndAppointmentsFromRecentCallUpdates();
      },
      normalizeAiSummaryStyle: shared.normalizeAiSummaryStyle,
      generateTextSummaryWithAi: shared.generateTextSummaryWithAi,
      parseIntSafe: shared.parseIntSafe,
      slugifyAutomationText: websiteInputRuntime.slugifyAutomationText,
    },
    featureRouteOptions: {
      handleTwilioInboundVoice: coldcallingServiceRuntime.handleTwilioInboundVoice,
      handleTwilioStatusWebhook: coldcallingServiceRuntime.handleTwilioStatusWebhook,
      handleRetellWebhook: coldcallingServiceRuntime.handleRetellWebhook,
      premiumRouteRuntime: {
        premiumLoginRateLimiter,
        requirePremiumApiAccess: securityRuntime.requirePremiumApiAccess,
        requirePremiumAdminApiAccess: securityRuntime.requirePremiumAdminApiAccess,
        premiumUsersStore: securityRuntime.premiumUsersStore,
        buildPremiumAuthSessionPayload: securityRuntime.buildPremiumAuthSessionPayload,
        normalizePremiumSessionEmail,
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        isPremiumMfaConfigured: securityRuntime.isPremiumMfaConfigured,
        isPremiumMfaCodeValid: securityRuntime.isPremiumMfaCodeValid,
        getSafePremiumRedirectPath: securityRuntime.getSafePremiumRedirectPath,
        getResolvedPremiumAuthState: securityRuntime.getResolvedPremiumAuthState,
        isPremiumAdminIpAllowed: securityRuntime.isPremiumAdminIpAllowed,
        createPremiumSessionToken: securityRuntime.createPremiumSessionToken,
        setPremiumSessionCookie: securityRuntime.setPremiumSessionCookie,
        clearPremiumSessionCookie: securityRuntime.clearPremiumSessionCookie,
        appendSecurityAuditEvent: securityRuntime.appendSecurityAuditEvent,
        getClientIpFromRequest: shared.getClientIpFromRequest,
        getRequestPathname: shared.getRequestPathname,
        getRequestOriginFromHeaders: shared.getRequestOriginFromHeaders,
        sessionSecret: envConfig.PREMIUM_SESSION_SECRET,
        premiumSessionTtlHours: envConfig.PREMIUM_SESSION_TTL_HOURS,
        premiumSessionRememberTtlDays: envConfig.PREMIUM_SESSION_REMEMBER_TTL_DAYS,
        agendaAppPin: envConfig.AGENDA_APP_PIN,
        agendaAppPinHash: envConfig.AGENDA_APP_PIN_HASH,
        agendaAppServeEmail: envConfig.AGENDA_APP_SERVE_EMAIL,
        agendaAppMartijnEmail: envConfig.AGENDA_APP_MARTIJN_EMAIL,
        agendaAppSessionTtlDays: envConfig.AGENDA_APP_SESSION_TTL_DAYS,
      },
      coldcalling: {
        runtimeStateSupabaseSyncCooldownMs:
          bootstrapState.RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS,
        openAiModel: envConfig.OPENAI_MODEL,
        env,
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        usdToEurRate: Number(env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR || 0),
        retellCostSummaryApiVersion: env.RETELL_COST_SUMMARY_API_VERSION || 'v3',
        callUpdatesById: runtimeMemory.callUpdatesById,
        recentCallUpdates: runtimeMemory.recentCallUpdates,
        recentWebhookEvents: runtimeMemory.recentWebhookEvents,
        recentAiCallInsights: runtimeMemory.recentAiCallInsights,
        requireRuntimeDebugAccess: securityRuntime.requireRuntimeDebugAccess,
        validateStartPayload: coldcallingServiceRuntime.validateStartPayload,
        getUiStateValues: uiSeoRuntime.getUiStateValues,
        premiumCustomersScope: bootstrapState.PREMIUM_CUSTOMERS_SCOPE,
        premiumCustomersKey: bootstrapState.PREMIUM_CUSTOMERS_KEY,
        premiumActiveOrdersScope: bootstrapState.PREMIUM_ACTIVE_ORDERS_SCOPE,
        premiumActiveCustomOrdersKey: bootstrapState.PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY,
        logger: console,
        getEffectivePublicBaseUrl,
        resolveColdcallingProviderForCampaign:
          platformRuntime.resolveColdcallingProviderForCampaign,
        getMissingEnvVars: platformRuntime.getMissingEnvVars,
        processColdcallingLead: coldcallingServiceRuntime.processColdcallingLead,
        createSequentialDispatchQueue: coldcallingServiceRuntime.createSequentialDispatchQueue,
        advanceSequentialDispatchQueue: coldcallingServiceRuntime.advanceSequentialDispatchQueue,
        waitForQueuedRuntimeStatePersist:
          runtimeSyncRuntime.waitForQueuedRuntimeStatePersist,
        normalizeString: shared.normalizeString,
        normalizeDateYyyyMmDd: platformRuntime.normalizeDateYyyyMmDd,
        normalizeTimeHhMm: platformRuntime.normalizeTimeHhMm,
        parseIntSafe: shared.parseIntSafe,
        parseNumberSafe: shared.parseNumberSafe,
        sleep: coldcallingServiceRuntime.sleep,
        inferCallProvider: platformRuntime.inferCallProvider,
        getColdcallingProvider: platformRuntime.getColdcallingProvider,
        isTwilioStatusApiConfigured: platformRuntime.isTwilioStatusApiConfigured,
        fetchTwilioCallStatusById: platformRuntime.fetchTwilioCallStatusById,
        extractCallUpdateFromTwilioCallStatusResponse:
          platformRuntime.extractCallUpdateFromTwilioCallStatusResponse,
        upsertRecentCallUpdate,
        triggerPostCallAutomation: coldcallingServiceRuntime.triggerPostCallAutomation,
        parseDateToIso: platformRuntime.parseDateToIso,
        hasRetellApiKey: () => Boolean(shared.normalizeString(env.RETELL_API_KEY)),
        listRetellCalls: platformRuntime.listRetellCalls,
        fetchRetellCallsByIds: platformRuntime.fetchRetellCallsByIds,
        fetchRetellCallStatusById: platformRuntime.fetchRetellCallStatusById,
        resolveRetellCallCostFields: platformRuntime.resolveRetellCallCostFields,
        extractCallUpdateFromRetellCallStatusResponse:
          platformRuntime.extractCallUpdateFromRetellCallStatusResponse,
        toIsoFromUnixMilliseconds: platformRuntime.toIsoFromUnixMilliseconds,
        extractTwilioRecordingSidFromUrl: platformRuntime.extractTwilioRecordingSidFromUrl,
        fetchTwilioRecordingsByCallId: platformRuntime.fetchTwilioRecordingsByCallId,
        choosePreferredTwilioRecording: platformRuntime.choosePreferredTwilioRecording,
        buildTwilioRecordingMediaUrl: platformRuntime.buildTwilioRecordingMediaUrl,
        getTwilioBasicAuthorizationHeader:
          platformRuntime.getTwilioBasicAuthorizationHeader,
        buildTwilioRecordingProxyUrl: platformRuntime.buildTwilioRecordingProxyUrl,
        isSupabaseConfigured: platformRuntime.isSupabaseConfigured,
        syncRuntimeStateFromSupabaseIfNewer:
          runtimeSyncRuntime.syncRuntimeStateFromSupabaseIfNewer,
        generatedAgendaAppointments: runtimeMemory.generatedAgendaAppointments,
        isGeneratedAppointmentVisibleForAgenda:
          agendaSupportRuntime.isGeneratedAppointmentVisibleForAgenda,
        syncCallUpdatesFromSupabaseRows: runtimeSyncRuntime.syncCallUpdatesFromSupabaseRows,
        shouldRefreshRetellCallStatus: platformRuntime.shouldRefreshRetellCallStatus,
        collectMissingCallUpdateRefreshCandidates:
          platformRuntime.collectMissingCallUpdateRefreshCandidates,
        refreshCallUpdateFromTwilioStatusApi:
          platformRuntime.refreshCallUpdateFromTwilioStatusApi,
        refreshCallUpdateFromRetellStatusApi:
          platformRuntime.refreshCallUpdateFromRetellStatusApi,
        backfillInsightsAndAppointmentsFromRecentCallUpdates:
          agendaSupportRuntime.backfillInsightsAndAppointmentsFromRecentCallUpdates,
        buildCallBackedLeadDetail: agendaLeadDetailService.buildCallBackedLeadDetail,
        getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
      },
      coldmailing: {
        coldmailCampaignService: createColdmailCampaignService({
          mailboxAccountsRaw: env.MAILBOX_ACCOUNTS || '',
          mailConfig: {
            smtpHost: envConfig.MAIL_SMTP_HOST,
            smtpPort: envConfig.MAIL_SMTP_PORT,
            smtpSecure: envConfig.MAIL_SMTP_SECURE,
            smtpUser: envConfig.MAIL_SMTP_USER,
            smtpPass: envConfig.MAIL_SMTP_PASS,
            mailFromAddress: envConfig.MAIL_FROM_ADDRESS,
            mailFromName: envConfig.MAIL_FROM_NAME,
            mailReplyTo: envConfig.MAIL_REPLY_TO,
            publicBaseUrl: envConfig.PUBLIC_BASE_URL,
            coldmailUnsubscribeSecret:
              envConfig.COLDMAIL_UNSUBSCRIBE_SECRET ||
              envConfig.PREMIUM_SESSION_SECRET ||
              envConfig.MAIL_SMTP_PASS,
            coldmailTrackingSecret:
              envConfig.COLDMAIL_TRACKING_SECRET ||
              envConfig.COLDMAIL_UNSUBSCRIBE_SECRET ||
              envConfig.PREMIUM_SESSION_SECRET ||
              envConfig.MAIL_SMTP_PASS,
            coldmailAuditBcc: envConfig.COLDMAIL_AUDIT_BCC,
            coldmailReplyForwardEnabled: envConfig.COLDMAIL_REPLY_FORWARD_ENABLED,
            coldmailReplyForwardFrom: envConfig.COLDMAIL_REPLY_FORWARD_FROM,
            coldmailReplyForwardTo: envConfig.COLDMAIL_REPLY_FORWARD_TO,
            coldmailReplySyncEmail: envConfig.COLDMAIL_REPLY_SYNC_EMAIL,
            imapHost: envConfig.MAIL_IMAP_HOST,
            imapPort: envConfig.MAIL_IMAP_PORT,
            imapSecure: envConfig.MAIL_IMAP_SECURE,
            imapUser: envConfig.MAIL_IMAP_USER,
            imapPass: envConfig.MAIL_IMAP_PASS,
            imapMailbox: envConfig.MAIL_IMAP_MAILBOX,
            imapExtraMailboxes: envConfig.MAIL_IMAP_EXTRA_MAILBOXES,
            imapPollCooldownMs: envConfig.MAIL_IMAP_POLL_COOLDOWN_MS,
            coldmailBounceProcessingEnabled: envConfig.COLDMAIL_BOUNCE_PROCESSING_ENABLED,
            coldmailCampaignSendLimit: envConfig.COLDMAIL_CAMPAIGN_SEND_LIMIT,
            coldmailDailySendLimit: envConfig.COLDMAIL_DAILY_SEND_LIMIT,
            coldmailPackageDailySendLimit: envConfig.COLDMAIL_PACKAGE_DAILY_SEND_LIMIT,
            coldmailSendDelayMs: envConfig.COLDMAIL_SEND_DELAY_MS,
            coldmailSafetyPauseMs: envConfig.COLDMAIL_SAFETY_PAUSE_MS,
            coldmailPersonalMailboxDailyLimit: envConfig.COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT,
            coldmailPersonalMailboxSendDelayMs: envConfig.COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS,
            coldmailBlockPersonalMailboxDomains: envConfig.COLDMAIL_BLOCK_PERSONAL_MAILBOX_DOMAINS,
          },
          getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
          fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
          extractOpenAiTextContent: aiHelpers.extractOpenAiTextContent,
          openAiApiBaseUrl: envConfig.OPENAI_API_BASE_URL,
          coldmailAutoReplyModel: shared.normalizeString(
            env.COLDMAIL_AUTOREPLY_OPENAI_MODEL || env.COLDMAIL_AUTOREPLY_MODEL || envConfig.OPENAI_MODEL || 'gpt-5.5-pro'
          ),
          coldmailAutoReplyEnabled: /^true$/i.test(shared.normalizeString(env.COLDMAIL_AUTOREPLY_ENABLED || '')),
          getUiStateValues: dataOpsAwareUiStateGetter,
          setUiStateValues: dataOpsAwareUiStateSetter,
          outboundRecipientGuardStore,
          customerDbScope: bootstrapState.PREMIUM_CUSTOMERS_SCOPE,
          customerDbKey: bootstrapState.PREMIUM_CUSTOMERS_KEY,
          leadDbScope: 'coldcalling',
          leadDbKey: 'softora_coldcalling_lead_rows_json',
          mailboxAccountsRaw: env.MAILBOX_ACCOUNTS || '',
          normalizeString: shared.normalizeString,
          truncateText: shared.truncateText,
        }),
        normalizeDateYyyyMmDd: platformRuntime.normalizeDateYyyyMmDd,
        normalizeTimeHhMm: platformRuntime.normalizeTimeHhMm,
        isSupabaseConfigured: platformRuntime.isSupabaseConfigured,
        syncRuntimeStateFromSupabaseIfNewer:
          runtimeSyncRuntime.syncRuntimeStateFromSupabaseIfNewer,
        getEffectivePublicBaseUrl,
        generatedAgendaAppointments: runtimeMemory.generatedAgendaAppointments,
        isGeneratedAppointmentVisibleForAgenda:
          agendaSupportRuntime.isGeneratedAppointmentVisibleForAgenda,
        backfillInsightsAndAppointmentsFromRecentCallUpdates:
          agendaSupportRuntime.backfillInsightsAndAppointmentsFromRecentCallUpdates,
        cronSecret: env.CRON_SECRET || '',
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
      },
      instantly: {
        instantlyOutreachService: createInstantlyOutreachService({
          instantlyConfig: {
            enabled: envConfig.INSTANTLY_ENABLED,
            syncEnabled: instantlySyncEnabled,
            schedulerEnabled: instantlySchedulerEnabled,
            apiKey: envConfig.INSTANTLY_API_KEY,
            apiBaseUrl: envConfig.INSTANTLY_API_BASE_URL,
            defaultCampaignId: envConfig.INSTANTLY_DEFAULT_CAMPAIGN_ID,
            webhookSecret: envConfig.INSTANTLY_WEBHOOK_SECRET,
            intervalMinutes: envConfig.INSTANTLY_SYNC_INTERVAL_MINUTES,
            batchSize: envConfig.INSTANTLY_SYNC_BATCH_SIZE,
            dailyCap: envConfig.INSTANTLY_DAILY_CAP,
            verifyLeadsOnImport: envConfig.INSTANTLY_VERIFY_LEADS_ON_IMPORT,
            blockPersonalMailboxDomains: envConfig.COLDMAIL_BLOCK_PERSONAL_MAILBOX_DOMAINS,
            requireWebdesignAssets: envConfig.INSTANTLY_REQUIRE_WEBDESIGN_ASSETS,
            publicBaseUrl: envConfig.PUBLIC_BASE_URL,
            previewImageBaseUrl:
              env.INSTANTLY_PREVIEW_IMAGE_BASE_URL ||
              env.COLDMAIL_PREVIEW_IMAGE_BASE_URL ||
              '',
            coldmailLinkSecret:
              envConfig.COLDMAIL_UNSUBSCRIBE_SECRET ||
              envConfig.PREMIUM_SESSION_SECRET ||
              envConfig.MAIL_SMTP_PASS,
            coldmailPreviewImageSecret: env.COLDMAIL_PREVIEW_IMAGE_SECRET || '',
            defaultSenderEmail: envConfig.INSTANTLY_DEFAULT_SENDER_EMAIL,
          },
          getUiStateValues: dataOpsAwareUiStateGetter,
          setUiStateValues: dataOpsAwareUiStateSetter,
          outboundRecipientGuardStore,
          fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
          customerDbScope: bootstrapState.PREMIUM_CUSTOMERS_SCOPE,
          customerDbKey: bootstrapState.PREMIUM_CUSTOMERS_KEY,
          normalizeString: shared.normalizeString,
          truncateText: shared.truncateText,
          logger: console,
        }),
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
      },
      websiteLinkCoordinator: uiSeoRuntime.websiteLinkCoordinator,
      websitePreviewLibraryCoordinator: uiSeoRuntime.websitePreviewLibraryCoordinator,
      mailbox: {
        logger: console,
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        mailboxAccountsRaw: env.MAILBOX_ACCOUNTS || '',
        getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
        getUiStateValues: dataOpsAwareUiStateGetter,
        openAiApiBaseUrl: envConfig.OPENAI_API_BASE_URL,
        openAiModel: shared.normalizeString(env.MAILBOX_REWRITE_OPENAI_MODEL || env.OPENAI_MODEL || envConfig.OPENAI_MODEL || 'gpt-5.5-pro'),
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        extractOpenAiTextContent: aiHelpers.extractOpenAiTextContent,
        isSupabaseConfigured: platformRuntime.isSupabaseConfigured,
        getSupabaseClient: platformRuntime.getSupabaseClient,
        outboundRecipientGuardStore,
        mailConfig: {
          smtpHost: envConfig.MAIL_SMTP_HOST,
          smtpPort: envConfig.MAIL_SMTP_PORT,
          smtpSecure: envConfig.MAIL_SMTP_SECURE,
          smtpUser: envConfig.MAIL_SMTP_USER,
          smtpPass: envConfig.MAIL_SMTP_PASS,
          mailFromAddress: envConfig.MAIL_FROM_ADDRESS,
          mailFromName: envConfig.MAIL_FROM_NAME,
          imapHost: envConfig.MAIL_IMAP_HOST,
          imapPort: envConfig.MAIL_IMAP_PORT,
          imapSecure: envConfig.MAIL_IMAP_SECURE,
          imapUser: envConfig.MAIL_IMAP_USER,
          imapPass: envConfig.MAIL_IMAP_PASS,
        },
      },
      publicContact: {
        logger: console,
        normalizeString: shared.normalizeString,
        truncateText: shared.truncateText,
        contactToEmail: env.PUBLIC_CONTACT_TO_EMAIL || 'info@softora.nl',
        mailConfig: {
          smtpHost: envConfig.MAIL_SMTP_HOST,
          smtpPort: envConfig.MAIL_SMTP_PORT,
          smtpSecure: envConfig.MAIL_SMTP_SECURE,
          smtpUser: envConfig.MAIL_SMTP_USER,
          smtpPass: envConfig.MAIL_SMTP_PASS,
          mailFromAddress: envConfig.MAIL_FROM_ADDRESS,
          mailFromName: envConfig.MAIL_FROM_NAME,
        },
      },
      mailboxCronSecret: env.CRON_SECRET || '',
      runtimeOpsCoordinator: uiSeoRuntime.runtimeOpsCoordinator,
      runtimeDebugOpsCoordinator: uiSeoRuntime.runtimeDebugOpsCoordinator,
      dataOpsStore: uiSeoRuntime.dataOpsStore,
      requireRuntimeDebugAccess: securityRuntime.requireRuntimeDebugAccess,
      seoReadCoordinator: uiSeoRuntime.seoReadCoordinator,
      seoWriteCoordinator: uiSeoRuntime.seoWriteCoordinator,
      openAiCostSummary: {
        env,
        openAiAdminApiKey: shared.normalizeString(env.OPENAI_ADMIN_KEY || env.OPENAI_ADMIN_API_KEY || env.OPENAI_COSTS_API_KEY || ''),
        openAiCostsApiBaseUrl: env.OPENAI_COSTS_API_BASE_URL || envConfig.OPENAI_API_BASE_URL,
        openAiUsageEstimateModel: env.OPENAI_USAGE_ESTIMATE_MODEL || 'gpt-5.5',
        openAiModel: envConfig.OPENAI_MODEL,
        openAiOrganizationId: env.OPENAI_ORGANIZATION_ID || env.OPENAI_ORG_ID || env.OPENAI_ORGANIZATION || '',
        openAiProjectId: env.OPENAI_PROJECT_ID || env.OPENAI_PROJECT || '',
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        getUiStateValues: dataOpsAwareUiStateGetter,
        setUiStateValues: dataOpsAwareUiStateSetter,
        usdToEurRate: Number(env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR || 0),
      },
      supabaseCostSummary: {
        env,
        supabaseManagementAccessToken: shared.normalizeString(
          env.SUPABASE_MANAGEMENT_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PERSONAL_ACCESS_TOKEN || ''
        ),
        supabaseProjectRef: shared.normalizeString(env.SUPABASE_PROJECT_REF || env.SUPABASE_PROJECT_ID || ''),
        supabaseUrl: envConfig.SUPABASE_URL || env.SUPABASE_URL || '',
        supabaseMonthlyBaseCostEur: Number(
          env.SUPABASE_MONTHLY_BASE_COST_EUR || env.SUPABASE_BILLING_BASE_EUR || env.SUPABASE_PLAN_COST_EUR || 0
        ),
        supabaseMonthlyBaseCostUsd: Number(
          env.SUPABASE_MONTHLY_BASE_COST_USD || env.SUPABASE_BILLING_BASE_USD || env.SUPABASE_PLAN_COST_USD || 0
        ),
        supabaseManagementApiBaseUrl: env.SUPABASE_MANAGEMENT_API_BASE_URL || '',
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
        usdToEurRate: Number(env.SUPABASE_COST_USD_TO_EUR || env.OPENAI_COST_USD_TO_EUR || env.AI_COST_USD_TO_EUR || 0),
      },
      supabaseMaintenance: {
        env,
        supabaseManagementAccessToken: shared.normalizeString(
          env.SUPABASE_MANAGEMENT_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PERSONAL_ACCESS_TOKEN || ''
        ),
        supabaseProjectRef: shared.normalizeString(env.SUPABASE_PROJECT_REF || env.SUPABASE_PROJECT_ID || ''),
        supabaseUrl: envConfig.SUPABASE_URL || env.SUPABASE_URL || '',
        supabaseManagementApiBaseUrl: env.SUPABASE_MANAGEMENT_API_BASE_URL || '',
        supabaseMaintenanceToken: shared.normalizeString(env.SUPABASE_MAINTENANCE_TOKEN || ''),
        fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
      },
      getUiStateValues: uiSeoRuntime.getUiStateValues,
      setUiStateValues: dataOpsAwareUiStateSetter,
    },
  });
}

module.exports = {
  buildServerAppFeatureWiringRuntimeContext,
  createDataOpsAwareUiStateGetter,
  createDataOpsAwareUiStateSetter,
};

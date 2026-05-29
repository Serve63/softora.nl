const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgendaSupportRuntimeCompositionOptions,
  buildAgendaLeadDetailServiceOptions,
  buildAgendaPostCallHelpersOptions,
  buildServerAppAgendaWiringRuntimeContext,
  buildServerAppFeatureWiringRuntimeContext,
  buildServerAppOperationalRuntimeContext,
  buildServerAppOpsWiringRuntimeContext,
  buildServerAppUiContentRuntimeCompositionContext,
} = require('../../server/services/server-app-runtime-composition-builders');
const agendaCompositionBuilders = require('../../server/services/server-app-runtime-agenda-composition-builders');
const featureCompositionBuilders = require('../../server/services/server-app-runtime-feature-composition-builders');
const opsCompositionBuilders = require('../../server/services/server-app-runtime-ops-composition-builders');
const uiContentCompositionBuilders = require('../../server/services/server-app-runtime-ui-content-composition-builders');

test('server app runtime composition builders barrel keeps domain builder seams stable', () => {
  assert.equal(
    buildAgendaSupportRuntimeCompositionOptions,
    agendaCompositionBuilders.buildAgendaSupportRuntimeCompositionOptions
  );
  assert.equal(
    buildAgendaLeadDetailServiceOptions,
    agendaCompositionBuilders.buildAgendaLeadDetailServiceOptions
  );
  assert.equal(
    buildAgendaPostCallHelpersOptions,
    agendaCompositionBuilders.buildAgendaPostCallHelpersOptions
  );
  assert.equal(
    buildServerAppAgendaWiringRuntimeContext,
    agendaCompositionBuilders.buildServerAppAgendaWiringRuntimeContext
  );
  assert.equal(
    buildServerAppFeatureWiringRuntimeContext,
    featureCompositionBuilders.buildServerAppFeatureWiringRuntimeContext
  );
  assert.equal(
    buildServerAppOperationalRuntimeContext,
    opsCompositionBuilders.buildServerAppOperationalRuntimeContext
  );
  assert.equal(
    buildServerAppOpsWiringRuntimeContext,
    opsCompositionBuilders.buildServerAppOpsWiringRuntimeContext
  );
  assert.equal(
    buildServerAppUiContentRuntimeCompositionContext,
    uiContentCompositionBuilders.buildServerAppUiContentRuntimeCompositionContext
  );
});

test('server app feature wiring writes data-ops scopes through the bridge first', async () => {
  const calls = [];
  const setter = featureCompositionBuilders.createDataOpsAwareUiStateSetter({
    setUiStateValues: async (scope, values, meta) => {
      calls.push({ target: 'legacy', scope, values, meta });
      return { source: 'legacy' };
    },
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'premium_customers',
      setUiStateValues: async (scope, values, meta) => {
        calls.push({ target: 'bridge', scope, values, meta });
        return { source: 'bridge' };
      },
    },
  });

  assert.equal((await setter('premium_customers', { a: 1 }, { source: 'test' })).source, 'bridge');
  assert.equal((await setter('other_scope', { b: 2 }, { source: 'test' })).source, 'legacy');
  assert.deepEqual(calls.map((call) => call.target), ['bridge', 'legacy']);
});

test('server app runtime composition builders preserve feature wiring groups and warmup callbacks', async (t) => {
  const oldEnv = { ...process.env };
  t.after(() => {
    process.env = oldEnv;
  });
  process.env.MAILBOX_SERVEC321_GMAIL_COM_PASS = 'gmail-app-password';
  process.env.MAILBOX_SERVEC321_GMAIL_COM_SMTP_HOST = 'smtp.gmail.com';
  process.env.MAILBOX_SERVEC321_GMAIL_COM_SMTP_PORT = '465';
  process.env.MAILBOX_SERVEC321_GMAIL_COM_SMTP_SECURE = 'true';
  process.env.MAILBOX_SERVEC321_GMAIL_COM_SMTP_USER = 'servec321@gmail.com';
  let hydratedAttempts = 0;
  let backfillCalls = 0;
  const bridgeReads = [];
  const bridgeWrites = [];
  const legacyWrites = [];
  const isGeneratedAppointmentVisibleForAgenda = () => true;

  const context = buildServerAppFeatureWiringRuntimeContext({
    app: { locals: {} },
    env: {
      RETELL_API_KEY: 'retell-key',
      OPENAI_ADMIN_API_KEY: 'admin-key',
      ANTHROPIC_ADMIN_API_KEY: 'anthropic-admin-key',
      ANTHROPIC_COSTS_API_BASE_URL: 'https://api.anthropic-cost.test',
      OPENAI_COST_USD_TO_EUR: '0.91',
      SUPABASE_MANAGEMENT_ACCESS_TOKEN: 'supabase-management-token',
      SUPABASE_PROJECT_REF: 'softora-ref',
      SUPABASE_MONTHLY_BASE_COST_EUR: '25',
      CRON_SECRET: 'cron-secret',
      MAILBOX_ACCOUNTS: JSON.stringify([{ email: 'servec321@gmail.com' }]),
      VERCEL: '1',
    },
    envConfig: {
      ACTIVE_ORDER_AUTOMATION_ENABLED: true,
      ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN: 'gh-token',
      ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER: 'softora',
      ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE: true,
      ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG: false,
      ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX: 'site-',
      ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH: 'main',
      ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN: 'vercel-token',
      ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE: 'softora-scope',
      ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND: 'deploy',
      ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL: 'https://strato.test/hook',
      ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN: 'strato-token',
      OPENAI_MODEL: 'gpt-5',
      WEBSITE_GENERATION_STRICT_ANTHROPIC: true,
      WEBSITE_GENERATION_STRICT_HTML: true,
      OPENAI_IMAGE_MODEL: 'gpt-image-1',
      OPENAI_API_BASE_URL: 'https://api.openai.test',
      PREMIUM_SESSION_SECRET: 'secret',
      PREMIUM_SESSION_TTL_HOURS: 8,
      PREMIUM_SESSION_REMEMBER_TTL_DAYS: 30,
      AGENDA_APP_PIN: '',
      AGENDA_APP_PIN_HASH: 'sha256:agenda-pin',
      AGENDA_APP_SERVE_EMAIL: 'serve@softora.test',
      AGENDA_APP_MARTIJN_EMAIL: 'martijn@softora.test',
      AGENDA_APP_SESSION_TTL_DAYS: 3650,
      MAIL_SMTP_HOST: 'smtp.softora.test',
      MAIL_SMTP_PORT: 587,
      MAIL_SMTP_SECURE: false,
      MAIL_SMTP_USER: 'info@softora.test',
      MAIL_SMTP_PASS: 'mail-pass',
      MAIL_FROM_ADDRESS: 'info@softora.test',
      MAIL_FROM_NAME: 'Softora',
      MAIL_REPLY_TO: 'reply@softora.test',
      INSTANTLY_ENABLED: true,
      INSTANTLY_SYNC_ENABLED: true,
      INSTANTLY_SCHEDULER_ENABLED: false,
      INSTANTLY_API_KEY: 'instantly-key',
      INSTANTLY_API_BASE_URL: 'https://api.instantly.test/api/v2',
      INSTANTLY_DEFAULT_CAMPAIGN_ID: 'campaign-1',
      INSTANTLY_WEBHOOK_SECRET: 'webhook-secret',
      INSTANTLY_SYNC_INTERVAL_MINUTES: 15,
      INSTANTLY_SYNC_BATCH_SIZE: 10,
      INSTANTLY_DAILY_CAP: 25,
      INSTANTLY_VERIFY_LEADS_ON_IMPORT: false,
    },
    bootstrapState: {
      PREMIUM_ACTIVE_ORDERS_SCOPE: 'premium_active_orders',
      PREMIUM_CUSTOMERS_SCOPE: 'premium_customers',
      PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY: 'custom_orders',
      PREMIUM_ACTIVE_RUNTIME_KEY: 'runtime_key',
      PREMIUM_CUSTOMERS_KEY: 'customers_key',
      RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS: 4000,
    },
    runtimeMemory: {
      recentCallUpdates: [],
      generatedAgendaAppointments: [],
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      runtimeStateSyncState: { supabaseStateHydrated: false },
      callUpdatesById: new Map(),
      recentWebhookEvents: [],
    },
    platformRuntime: {
      getOpenAiApiKey: () => 'openai',
      getAnthropicApiKey: () => 'anthropic',
      getWebsiteGenerationProvider: () => 'anthropic',
      getWebsiteAnthropicModel: () => 'claude-site',
      getDossierAnthropicModel: () => 'claude-dossier',
      resolvePreferredRecordingUrl: () => 'https://recording.test',
      normalizeDateYyyyMmDd: (value) => value,
      normalizeTimeHhMm: (value) => value,
      toBooleanSafe: Boolean,
      isSupabaseConfigured: () => true,
      resolveColdcallingProviderForCampaign: () => 'retell',
      getMissingEnvVars: () => [],
      inferCallProvider: () => 'retell',
      getColdcallingProvider: () => 'retell',
      isTwilioStatusApiConfigured: () => true,
      fetchTwilioCallStatusById: async () => null,
      extractCallUpdateFromTwilioCallStatusResponse: () => null,
      parseDateToIso: () => '2026-04-17T00:00:00.000Z',
      fetchRetellCallStatusById: async () => null,
      extractCallUpdateFromRetellCallStatusResponse: () => null,
      toIsoFromUnixMilliseconds: () => '2026-04-17T00:00:00.000Z',
      extractTwilioRecordingSidFromUrl: () => 'RE123',
      fetchTwilioRecordingsByCallId: async () => [],
      choosePreferredTwilioRecording: () => null,
      buildTwilioRecordingMediaUrl: () => 'https://twilio.test/media',
      getTwilioBasicAuthorizationHeader: () => 'Basic abc',
      buildTwilioRecordingProxyUrl: () => 'https://softora.test/proxy',
      syncRuntimeStateFromSupabaseIfNewer: async () => null,
      collectMissingCallUpdateRefreshCandidates: () => [],
      shouldRefreshRetellCallStatus: () => false,
      refreshCallUpdateFromTwilioStatusApi: async () => null,
      refreshCallUpdateFromRetellStatusApi: async () => null,
    },
    securityRuntime: {
      appendDashboardActivity: () => null,
      requirePremiumApiAccess: () => true,
      requirePremiumAdminApiAccess: () => true,
      premiumUsersStore: {},
      buildPremiumAuthSessionPayload: () => ({}),
      isPremiumMfaConfigured: () => false,
      isPremiumMfaCodeValid: () => true,
      getSafePremiumRedirectPath: () => '/premium',
      getResolvedPremiumAuthState: () => ({ ok: true }),
      isPremiumAdminIpAllowed: () => true,
      createPremiumSessionToken: () => 'session-token',
      setPremiumSessionCookie: () => null,
      clearPremiumSessionCookie: () => null,
      appendSecurityAuditEvent: () => null,
      requireRuntimeDebugAccess: () => true,
    },
    runtimeSyncRuntime: {
      forceHydrateRuntimeStateWithRetries: async () => {
        hydratedAttempts += 1;
      },
      waitForQueuedRuntimeStatePersist: async () => true,
      syncRuntimeStateFromSupabaseIfNewer: async () => null,
      syncCallUpdatesFromSupabaseRows: () => null,
    },
    coldcallingServiceRuntime: {
      handleTwilioInboundVoice: () => null,
      handleTwilioStatusWebhook: () => null,
      handleRetellWebhook: () => null,
      validateStartPayload: () => ({ ok: true }),
      processColdcallingLead: async () => null,
      createSequentialDispatchQueue: () => ({ id: 'queue-1' }),
      advanceSequentialDispatchQueue: async () => null,
      sleep: async () => null,
      triggerPostCallAutomation: async () => null,
    },
    websiteInputRuntime: {
      sanitizeReferenceImages: (value) => value,
      sanitizeLaunchDomainName: (value) => value,
      slugifyAutomationText: (value) => value,
    },
    aiContentRuntime: {
      generateWebsiteHtmlWithAi: async () => '<html></html>',
      fetchWebsitePreviewScanFromUrl: async () => null,
      generateWebsitePreviewImageWithAi: async () => null,
      buildOrderDossierInput: () => ({}),
      generateDynamicOrderDossierWithAnthropic: async () => ({}),
      buildOrderDossierFallbackLayout: () => '<section></section>',
      generateWebsitePromptFromTranscriptWithAi: async () => '',
      buildWebsitePromptFallback: () => '',
      extractMeetingNotesFromImageWithAi: async () => '',
    },
    uiSeoRuntime: {
      getUiStateValues: async () => ({}),
      setUiStateValues: async (...args) => {
        legacyWrites.push(args);
        return {};
      },
      dataOpsUiStateBridge: {
        canHandleScope: (scope) => scope === 'premium_customers' || scope === 'premium_database_photos',
        getUiStateValues: async (scope) => {
          bridgeReads.push(scope);
          if (scope === 'premium_customers') {
            return {
              values: {
                customers_key: JSON.stringify([
                  {
                    id: 'softora-test-mode-recipient',
                    bedrijf: 'Softora Testmodus',
                    naam: 'Servé',
                    email: 'servec321@gmail.com',
                    telefoon: '+31000000000',
                    dom: 'softora.nl',
                    status: 'gemaild',
                    databaseStatus: 'gemaild',
                    campaignType: 'webdesign',
                    coldmailSpecialAction: 'webdesign',
                    outreachStatus: 'benaderd',
                    coldmailSentMessageId: 'message-1',
                  },
                ]),
              },
            };
          }
          if (scope === 'premium_database_photos') {
            return {
              values: {
                softora_database_photos_v1: JSON.stringify({
                  'softora-test-mode-recipient': {
                    id: 'softora-test-mode-recipient',
                    photoKey: 'photo_softora_test',
                    mockupPhotoKey: 'mockup_softora_test',
                    chunkCount: 1,
                    websitePhotoName: 'softora-test.png',
                    websiteMockupName: 'softora-test-device-mockup-v8.jpg',
                    mockupRenderer: 'softora-browser-device-v8',
                    mockupOrientation: 'upright',
                    mockupQualityStatus: 'checked',
                    mockupQualityCheckedAt: '2026-05-27T00:00:00.000Z',
                  },
                }),
                photo_softora_test_0: 'data:image/png;base64,AAAA',
                mockup_softora_test_0: 'data:image/png;base64,AAAA',
              },
            };
          }
          return { values: {} };
        },
        setUiStateValues: async (scope, values, meta) => {
          bridgeWrites.push({ scope, values, meta });
          return { source: 'bridge-write', values };
        },
      },
      websiteLinkCoordinator: {},
      websitePreviewLibraryCoordinator: {},
      runtimeOpsCoordinator: {},
      runtimeDebugOpsCoordinator: {},
      seoReadCoordinator: {},
      seoWriteCoordinator: {},
    },
    agendaSupportRuntime: {
      backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {
        backfillCalls += 1;
      },
      isGeneratedAppointmentVisibleForAgenda,
    },
    agendaPostCallHelpers: {
      parseCustomOrdersFromUiState: () => [],
    },
    agendaLeadDetailService: {
      buildCallBackedLeadDetail: () => ({}),
    },
    aiHelpers: {
      parseJsonLoose: JSON.parse,
      extractOpenAiTextContent: () => 'ok',
    },
    premiumLoginRateLimiter: () => true,
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    normalizePremiumSessionEmail: (value) => String(value).toLowerCase(),
    upsertRecentCallUpdate: () => null,
    shared: {
      normalizeString: String,
      truncateText: String,
      parseIntSafe: Number,
      parseNumberSafe: Number,
      fetchJsonWithTimeout: async () => ({}),
      normalizeAiSummaryStyle: () => 'bullet',
      generateTextSummaryWithAi: async () => '',
      getClientIpFromRequest: () => '127.0.0.1',
      getRequestPathname: () => '/premium',
      getRequestOriginFromHeaders: () => 'https://softora.test',
    },
  });

  assert.equal(
    context.aiDashboardOptions.activeOrderAutomation.githubOwner,
    'softora'
  );
  assert.equal(
    context.featureRouteOptions.premiumRouteRuntime.sessionSecret,
    'secret'
  );
  assert.equal(
    context.featureRouteOptions.premiumRouteRuntime.agendaAppPinHash,
    'sha256:agenda-pin'
  );
  assert.equal(
    context.featureRouteOptions.premiumRouteRuntime.agendaAppMartijnEmail,
    'martijn@softora.test'
  );
  assert.equal(
    context.featureRouteOptions.coldcalling.runtimeStateSupabaseSyncCooldownMs,
    4000
  );
  assert.equal(
    context.featureRouteOptions.coldcalling.getUiStateValues,
    context.aiDashboardOptions.getUiStateValues
  );
  assert.equal(context.featureRouteOptions.coldcalling.premiumCustomersScope, 'premium_customers');
  assert.equal(context.featureRouteOptions.coldcalling.premiumCustomersKey, 'customers_key');
  assert.equal(context.featureRouteOptions.coldcalling.premiumActiveOrdersScope, 'premium_active_orders');
  assert.equal(context.featureRouteOptions.coldcalling.premiumActiveCustomOrdersKey, 'custom_orders');
  assert.equal(
    context.featureRouteOptions.coldcalling.generatedAgendaAppointments,
    context.aiDashboardOptions.generatedAgendaAppointments
  );
  assert.equal(
    context.featureRouteOptions.coldcalling.isGeneratedAppointmentVisibleForAgenda,
    isGeneratedAppointmentVisibleForAgenda
  );
  assert.equal(context.featureRouteOptions.coldcalling.logger, console);
  assert.equal(context.featureRouteOptions.openAiCostSummary.openAiAdminApiKey, 'admin-key');
  assert.equal(context.featureRouteOptions.openAiCostSummary.openAiCostsApiBaseUrl, 'https://api.openai.test');
  assert.equal(context.featureRouteOptions.openAiCostSummary.usdToEurRate, 0.91);
  assert.equal(context.featureRouteOptions.supabaseCostSummary.supabaseManagementAccessToken, 'supabase-management-token');
  assert.equal(context.featureRouteOptions.supabaseCostSummary.supabaseProjectRef, 'softora-ref');
  assert.equal(context.featureRouteOptions.supabaseCostSummary.supabaseMonthlyBaseCostEur, 25);
  assert.equal(context.featureRouteOptions.coldmailing.coldmailCampaignService.isSmtpMailConfigured(), true);
  assert.ok(
    context.featureRouteOptions.coldmailing.coldmailCampaignService
      .getConfiguredSenderEmails()
      .includes('servec321@gmail.com')
  );
  assert.equal(context.featureRouteOptions.coldmailing.cronSecret, 'cron-secret');
  assert.equal(context.featureRouteOptions.instantly.instantlyOutreachService.isConfigured(), true);
  assert.equal(typeof context.featureRouteOptions.instantly.instantlyOutreachService.getStatus, 'function');
  assert.deepEqual(context.featureRouteOptions.coldmailing.coldmailCampaignService.getAllowedSenderEmails(), [
    'info@softora.test',
    'servec321@gmail.com',
    'info@softora.nl',
    'zakelijk@softora.nl',
    'ruben@softora.nl',
    'serve@softora.nl',
    'martijn@softora.nl',
    'martijnven123@gmail.com',
  ]);
  const testRecipients =
    await context.featureRouteOptions.coldmailing.coldmailCampaignService.getColdmailCampaignRecipients({
      count: 1,
      specialAction: 'webdesign',
      testMode: true,
    });
  assert.equal(testRecipients.selected, 1);
  assert.equal(testRecipients.recipients[0].email, 'servec321@gmail.com');
  assert.deepEqual(bridgeReads, ['premium_customers', 'premium_database_photos']);
  const outreachUpdate =
    await context.featureRouteOptions.coldmailing.coldmailCampaignService.updateWebdesignOutreachStatus({
      customerId: 'softora-test-mode-recipient',
      status: 'interesse',
      actor: 'contract-test',
    });
  assert.equal(outreachUpdate.databaseStatus, 'interesse');
  assert.equal(bridgeWrites.length, 1);
  assert.equal(bridgeWrites[0].scope, 'premium_customers');
  assert.equal(bridgeWrites[0].meta.source, 'webdesign-outreach-action');
  assert.equal(JSON.parse(bridgeWrites[0].values.customers_key)[0].databaseStatus, 'interesse');
  assert.deepEqual(legacyWrites, []);
  assert.equal(
    context.featureRouteOptions.coldmailing.generatedAgendaAppointments,
    context.aiDashboardOptions.generatedAgendaAppointments
  );
  assert.equal(
    context.featureRouteOptions.coldmailing.isGeneratedAppointmentVisibleForAgenda,
    isGeneratedAppointmentVisibleForAgenda
  );

  await context.aiDashboardOptions.ensureDashboardChatRuntimeReady();
  assert.equal(hydratedAttempts, 1);
  assert.equal(backfillCalls, 1);
});

test('server app runtime composition builders preserve agenda wiring groups', async () => {
  const queueRuntimeStatePersist = () => null;
  const buildRuntimeStateSnapshotPayload = () => ({ ok: true });
  const getEffectivePublicBaseUrl = () => 'https://softora.test';
  const bridgeReads = [];

  const context = buildServerAppAgendaWiringRuntimeContext({
    app: { locals: {} },
    envConfig: {
      OPENAI_API_BASE_URL: 'https://api.openai.test',
      OPENAI_MODEL: 'gpt-5',
      DEMO_CONFIRMATION_TASK_ENABLED: true,
    },
    bootstrapState: {
      PREMIUM_ACTIVE_ORDERS_SCOPE: 'premium_active_orders',
      PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY: 'custom_orders',
      PREMIUM_CUSTOMERS_SCOPE: 'premium_customers',
      PREMIUM_CUSTOMERS_KEY: 'customers_key',
      RUNTIME_STATE_SUPABASE_SYNC_COOLDOWN_MS: 4000,
    },
    runtimeMemory: {
      dismissedInterestedLeadCallIds: new Set(),
      dismissedInterestedLeadKeys: new Set(),
      dismissedInterestedLeadKeyUpdatedAtMsByKey: new Map(),
      recentCallUpdates: [],
      recentAiCallInsights: [],
      aiCallInsightsByCallId: new Map(),
      generatedAgendaAppointments: [],
      agendaAppointmentIdByCallId: new Map(),
      runtimeStateSyncState: {},
      takeNextGeneratedAgendaAppointmentId: () => 42,
    },
    platformRuntime: {
      normalizeDateYyyyMmDd: (value) => value,
      normalizeTimeHhMm: (value) => value,
      toBooleanSafe: Boolean,
      getColdcallingStackLabel: () => 'Retell',
      resolvePreferredRecordingUrl: () => 'https://recording.test',
      isSupabaseConfigured: () => true,
      formatEuroLabel: () => 'EUR 10',
      resolveAppointmentCallId: () => 'call-1',
      inferCallProvider: () => 'retell',
      refreshCallUpdateFromTwilioStatusApi: async () => null,
      refreshCallUpdateFromRetellStatusApi: async () => null,
      getOpenAiApiKey: () => 'openai',
      extractTwilioRecordingSidFromUrl: () => 'RE123',
      isTwilioStatusApiConfigured: () => true,
      fetchTwilioRecordingsByCallId: async () => [],
      choosePreferredTwilioRecording: () => null,
      buildTwilioRecordingMediaUrl: () => 'https://twilio.test/media',
      getTwilioBasicAuthorizationHeader: () => 'Basic abc',
    },
    securityRuntime: {
      buildLeadOwnerFields: () => ({}),
      appendDashboardActivity: () => null,
    },
    runtimeSyncRuntime: {
      persistDismissedLeadsToSupabase: async () => null,
      forceHydrateRuntimeStateWithRetries: async () => null,
      syncRuntimeStateFromSupabaseIfNewer: async () => null,
      applyRuntimeStateSnapshotPayload: () => null,
      waitForQueuedRuntimeSnapshotPersist: async () => true,
      invalidateSupabaseSyncTimestamp: () => null,
      ensureDismissedLeadsFreshFromSupabase: async () => null,
    },
    agendaSupportRuntime: {
      buildGeneratedLeadFollowUpFromCall: () => ({}),
      resolveAppointmentLocation: () => '',
      resolveCallDurationSeconds: () => 0,
      sanitizeAppointmentLocation: (value) => value,
      sanitizeAppointmentWhatsappInfo: (value) => value,
      resolveAgendaLocationValue: () => '',
      mapAppointmentToConfirmationTask: () => ({}),
      compareConfirmationTasks: () => 0,
      getGeneratedAppointmentIndexById: () => -1,
      setGeneratedAgendaAppointmentAtIndex: () => null,
      buildConfirmationEmailDraftFallback: () => 'fallback',
      normalizeEmailAddress: (value) => value,
      getLatestCallUpdateByCallId: () => null,
      isImapMailConfigured: () => false,
      syncInboundConfirmationEmailsFromImap: async () => null,
      backfillInsightsAndAppointmentsFromRecentCallUpdates: () => null,
      isLikelyValidEmail: () => true,
      isSmtpMailConfigured: () => false,
      getMissingSmtpMailEnv: () => [],
      sendConfirmationEmailViaSmtp: async () => null,
      buildLeadToAgendaSummary: () => '',
      refreshAgendaAppointmentCallSourcesIfNeeded: () => null,
      backfillGeneratedAgendaAppointmentsMetadataIfNeeded: () => null,
      refreshGeneratedAgendaSummariesIfNeeded: () => null,
      isGeneratedAppointmentVisibleForAgenda: () => true,
      compareAgendaAppointments: () => 0,
      hasNegativeInterestSignal: () => false,
      hasPositiveInterestSignal: () => true,
    },
    agendaPostCallHelpers: {
      sanitizeLaunchDomainName: (value) => value,
      sanitizeReferenceImages: (value) => value,
    },
    agendaLeadDetailService: {
      pickReadableConversationSummaryForLeadDetail: () => '',
      getAppointmentTranscriptText: () => '',
      buildCallBackedLeadDetail: () => ({}),
      buildConversationSummaryForLeadDetail: () => '',
      buildRecordingFileNameForTranscription: () => 'recording.txt',
      getOpenAiTranscriptionModelCandidates: () => ['whisper-1'],
    },
    uiSeoRuntime: {
      getUiStateValues: async (scope) => ({ source: 'legacy', scope }),
      setUiStateValues: async () => true,
      dataOpsUiStateBridge: {
        canHandleScope: (scope) => scope === 'premium_customers',
        getUiStateValues: async (scope) => {
          bridgeReads.push(scope);
          return { source: 'bridge', scope };
        },
      },
    },
    aiHelpers: {
      extractOpenAiTextContent: () => '',
      parseJsonLoose: JSON.parse,
    },
    getEffectivePublicBaseUrl,
    queueRuntimeStatePersist,
    buildRuntimeStateSnapshotPayload,
    shared: {
      normalizeString: String,
      truncateText: String,
      normalizeColdcallingStack: String,
      parseIntSafe: Number,
      fetchJsonWithTimeout: async () => ({}),
      fetchBinaryWithTimeout: async () => Buffer.from(''),
      normalizeAbsoluteHttpUrl: String,
    },
  });

  assert.equal(context.agendaAppOptions.queueRuntimeStatePersist, queueRuntimeStatePersist);
  assert.equal(
    context.agendaAppOptions.buildRuntimeStateSnapshotPayload,
    buildRuntimeStateSnapshotPayload
  );
  assert.equal(context.agendaAppOptions.getEffectivePublicBaseUrl, getEffectivePublicBaseUrl);
  assert.equal(context.agendaAppOptions.leadDatabaseUiScope, 'coldcalling');
  assert.equal(context.agendaAppOptions.demoConfirmationTaskEnabled, true);
  assert.equal((await context.agendaAppOptions.getUiStateValues('premium_customers')).source, 'bridge');
  assert.equal((await context.agendaAppOptions.getUiStateValues('other_scope')).source, 'legacy');
  assert.deepEqual(bridgeReads, ['premium_customers']);
});

test('server app runtime composition builders preserve app ops callbacks and metadata', async () => {
  const sendPublishedWebsiteLinkResponse = () => 'published';
  const buildRuntimeStateSnapshotPayloadWithLimits = () => ({ ok: true });
  const buildRuntimeBackupForOps = () => ({ backup: true });

  const context = buildServerAppOpsWiringRuntimeContext({
    app: { locals: {} },
    env: { NODE_ENV: 'test' },
    envConfig: {
      SUPABASE_STATE_TABLE: 'runtime_state',
      SUPABASE_STATE_KEY: 'softora_runtime',
      MAIL_IMAP_MAILBOX: 'INBOX',
      MAIL_IMAP_POLL_COOLDOWN_MS: 1000,
      PREMIUM_SESSION_SECRET: 'secret',
      PREMIUM_SESSION_COOKIE_NAME: 'softora_session',
      SECURITY_CONTACT_EMAIL: 'security@softora.test',
      DEMO_CONFIRMATION_TASK_ENABLED: true,
      IS_PRODUCTION: false,
    },
    bootstrapState: {
      knownHtmlPageFiles: ['premium-test.html'],
      knownPrettyPageSlugToFile: new Map([['premium-test', 'premium-test.html']]),
    },
    runtimeMemory: {
      runtimeStateSyncState: {},
      confirmationMailRuntimeState: {},
      recentWebhookEvents: [],
      recentCallUpdates: [],
      recentAiCallInsights: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [],
    },
    platformRuntime: {
      isSupabaseConfigured: () => false,
      getColdcallingProvider: () => 'retell',
      getMissingEnvVars: () => [],
    },
    securityRuntime: {
      isPremiumMfaConfigured: () => false,
      requireRuntimeDebugAccess: () => true,
    },
    runtimeSyncRuntime: {
      buildRuntimeStateSnapshotPayloadWithLimits,
      buildRuntimeBackupForOps,
      ensureRuntimeStateHydratedFromSupabase: async () => true,
    },
    uiSeoRuntime: {
      sendSeoManagedHtmlPageResponse: () => null,
    },
    routeManifest: { critical: true },
    appVersion: '1.2.3',
    featureFlags: { foo: true },
    getPublicFeatureFlags: () => ({ foo: true }),
    isServerlessRuntime: false,
    projectRootDir: '/tmp/project',
    websiteLinkCoordinator: {
      sendPublishedWebsiteLinkResponse,
    },
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    resolveLegacyPrettyPageRedirect: () => null,
    toPrettyPagePathFromHtmlFile: () => '/premium-test',
    isSmtpMailConfigured: () => false,
    isImapMailConfigured: () => false,
    upsertRecentCallUpdate: () => null,
    upsertAiCallInsight: () => null,
    upsertGeneratedAgendaAppointment: () => null,
    queueRuntimeStatePersist: () => null,
    shared: {
      normalizeString: String,
    },
  });

  assert.equal(context.appOpsOptions.securityContactEmail, 'security@softora.test');
  assert.equal(
    context.appOpsOptions.buildRuntimeStateSnapshotPayloadWithLimits,
    buildRuntimeStateSnapshotPayloadWithLimits
  );
  assert.equal(context.appOpsOptions.buildRuntimeBackupForOps, buildRuntimeBackupForOps);
  assert.deepEqual(context.appOpsOptions.knownHtmlPageFiles, ['premium-test.html']);
  assert.equal(
    context.appOpsOptions.sendPublishedWebsiteLinkResponse({}, {}, 'slug'),
    'published'
  );
});

test('server app runtime composition builders preserve operational runtime groups', () => {
  const bindRuntimeSyncRuntime = () => null;
  const upsertRecentCallUpdate = () => null;
  const maybeAnalyzeCallUpdateWithAi = async () => null;

  const context = buildServerAppOperationalRuntimeContext({
    app: { locals: {} },
    env: { NODE_ENV: 'test' },
    express: { json: () => null },
    runtimeEnv: { app: { isProduction: false } },
    runtimeMemory: { recentCallUpdates: [] },
    appVersion: '1.2.3',
    routeManifest: { healthz: '/healthz' },
    bootstrapState: { NOINDEX_HEADER_VALUE: 'noindex, nofollow' },
    platformRuntime: { name: 'platform' },
    securityRuntime: { name: 'security' },
    bindRuntimeSyncRuntime,
    upsertRecentCallUpdate,
    getPublicFeatureFlags: () => ({ demo: true }),
    normalizePremiumSessionEmail: (value) => String(value).toLowerCase(),
    resolveCallDurationSeconds: () => 90,
    resolveCallUpdateTimestamp: () => 123,
    maybeAnalyzeCallUpdateWithAi,
    ensureRuleBasedInsightAndAppointment: async () => null,
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    normalizeAbsoluteHttpUrl: (value) => value,
    appendQueryParamsToUrl: (value) => value,
    shared: {
      normalizeString: String,
      truncateText: String,
      normalizeColdcallingStack: String,
      parseIntSafe: Number,
      parseNumberSafe: Number,
      timingSafeEqualStrings: () => true,
      getClientIpFromRequest: () => '127.0.0.1',
      getRequestOriginFromHeaders: () => 'https://softora.test',
      getRequestPathname: () => '/premium',
      isSecureHttpRequest: () => true,
      escapeHtml: (value) => value,
    },
  });

  assert.equal(context.noindexHeaderValue, 'noindex, nofollow');
  assert.equal(context.bindRuntimeSyncRuntime, bindRuntimeSyncRuntime);
  assert.equal(context.upsertRecentCallUpdate, upsertRecentCallUpdate);
  assert.equal(context.operationalCallbacks.maybeAnalyzeCallUpdateWithAi, maybeAnalyzeCallUpdateWithAi);
  assert.equal(context.shared.getRequestPathname(), '/premium');
});

test('server app runtime composition builders preserve ui-content runtime groups', async () => {
  let bootstrapReader = async () => ({ ok: 'initial' });

  const context = buildServerAppUiContentRuntimeCompositionContext({
    env: { NODE_ENV: 'test' },
    runtimeEnv: { app: { port: 3000 } },
    runtimeMemory: {
      runtimeStateSyncState: { supabaseStateHydrated: true },
    },
    projectRootDir: '/tmp/project',
    bootstrapState: {
      knownHtmlPageFiles: ['premium-test.html'],
      knownPrettyPageSlugToFile: new Map([['premium-test', 'premium-test.html']]),
      UI_STATE_SCOPE_PREFIX: 'ui_state:',
      SEO_DEFAULT_SITE_ORIGIN: 'https://softora.test',
      SEO_MAX_IMAGES_PER_PAGE: 2000,
      SEO_MODEL_PRESETS: [{ label: 'Fast', value: 'fast' }],
      SEO_PAGE_FIELD_DEFS: [{ key: 'title', maxLength: 100 }],
      SEO_UI_STATE_SCOPE: 'seo',
      SEO_UI_STATE_CONFIG_KEY: 'config',
      SEO_CONFIG_CACHE_TTL_MS: 15000,
    },
    platformRuntime: {
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({ from: () => ({}) }),
      fetchSupabaseRowByKeyViaRest: async () => null,
      upsertSupabaseRowViaRest: async () => null,
      getOpenAiApiKey: () => 'openai',
      getAnthropicApiKey: () => 'anthropic',
      getWebsiteGenerationProvider: () => 'anthropic',
      getWebsiteAnthropicModel: () => 'claude-website',
      getDossierAnthropicModel: () => 'claude-dossier',
      getAnthropicDossierMaxTokens: () => 4096,
      redactSupabaseUrlForDebug: () => 'supabase.test',
      toBooleanSafe: Boolean,
    },
    securityRuntime: {
      resolvePremiumHtmlPageAccess: () => ({ allowed: true }),
      appendDashboardActivity: () => null,
      appendSecurityAuditEvent: () => null,
    },
    runtimeSyncRuntime: {
      persistRuntimeStateToSupabase: async () => null,
      ensureRuntimeStateHydratedFromSupabase: async () => true,
    },
    getPageBootstrapData: (req, fileName) => bootstrapReader(req, fileName),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    resolveLegacyPrettyPageRedirect: () => null,
    shared: {
      normalizeString: String,
      truncateText: String,
      clipText: String,
      escapeHtml: String,
      parseIntSafe: Number,
      fetchJsonWithTimeout: async () => ({}),
      fetchTextWithTimeout: async () => '<html></html>',
      assertWebsitePreviewUrlIsPublic: async () => true,
      normalizeAbsoluteHttpUrl: String,
      normalizeWebsitePreviewTargetUrl: String,
    },
  });

  assert.deepEqual(context.knownHtmlPageFiles, ['premium-test.html']);
  assert.equal(context.uiSeoConfig.seoConfigScope, 'seo');
  assert.equal(context.platform.getWebsiteGenerationProvider(), 'anthropic');
  assert.equal(
    context.runtimeSync.ensureRuntimeStateHydratedFromSupabase.constructor.name,
    'AsyncFunction'
  );
  bootstrapReader = async () => ({ ok: 'updated' });
  assert.deepEqual(
    await context.uiCallbacks.getPageBootstrapData({}, 'premium-test.html'),
    { ok: 'updated' }
  );
});

test('server app runtime composition builders preserve agenda support runtime groups and late-bound callbacks', () => {
  const upsertGeneratedAgendaAppointment = () => 'upserted';
  const backfillOpenLeadFollowUpAppointmentsFromLatestCalls = () => 'backfilled';

  const options = buildAgendaSupportRuntimeCompositionOptions({
    envConfig: {
      OPENAI_API_BASE_URL: 'https://api.openai.test',
      OPENAI_MODEL: 'gpt-5',
      MAIL_SMTP_HOST: 'smtp.test',
      MAIL_SMTP_PORT: 587,
      MAIL_SMTP_SECURE: false,
      MAIL_SMTP_USER: 'smtp-user',
      MAIL_SMTP_PASS: 'smtp-pass',
      MAIL_FROM_ADDRESS: 'hello@softora.test',
      MAIL_FROM_NAME: 'Softora',
      MAIL_REPLY_TO: 'reply@softora.test',
      MAIL_IMAP_HOST: 'imap.test',
      MAIL_IMAP_PORT: 993,
      MAIL_IMAP_SECURE: true,
      MAIL_IMAP_USER: 'imap-user',
      MAIL_IMAP_PASS: 'imap-pass',
      MAIL_IMAP_MAILBOX: 'INBOX',
      MAIL_IMAP_EXTRA_MAILBOXES: ['Archive'],
      MAIL_IMAP_POLL_COOLDOWN_MS: 1000,
    },
    runtimeMemory: {
      recentCallUpdates: [],
      callUpdatesById: new Map(),
      recentAiCallInsights: [],
      aiCallInsightsByCallId: new Map(),
      aiAnalysisFingerprintByCallId: new Map(),
      aiAnalysisInFlightCallIds: new Set(),
      agendaAppointmentIdByCallId: new Map(),
      generatedAgendaAppointments: [],
      recentDashboardActivities: [],
      confirmationMailRuntimeState: {},
    },
    platformRuntime: {
      normalizeDateYyyyMmDd: (value) => value,
      normalizeTimeHhMm: (value) => value,
      toBooleanSafe: Boolean,
      formatEuroLabel: () => 'EUR 10',
      getColdcallingStackLabel: () => 'Retell',
      resolvePreferredRecordingUrl: () => 'https://recording.test',
      getOpenAiApiKey: () => 'openai',
      refreshCallUpdateFromTwilioStatusApi: async () => null,
      refreshCallUpdateFromRetellStatusApi: async () => null,
      resolveAppointmentCallId: () => 'call-1',
    },
    securityRuntime: {
      buildLeadOwnerFields: () => ({}),
      appendDashboardActivity: () => null,
    },
    runtimeSyncRuntime: {
      queueRuntimeStatePersist: () => null,
    },
    upsertRecentCallUpdate: () => null,
    upsertGeneratedAgendaAppointment,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    summaryContainsEnglishMarkers: () => false,
    generateTextSummaryWithAi: async () => '',
    shared: {
      normalizeString: String,
      truncateText: String,
      normalizeColdcallingStack: String,
      parseNumberSafe: Number,
      fetchJsonWithTimeout: async () => ({}),
      extractOpenAiTextContent: () => 'ok',
      parseJsonLoose: JSON.parse,
    },
  });

  assert.equal(options.openAiApiBaseUrl, 'https://api.openai.test');
  assert.equal(options.mailConfig.smtpHost, 'smtp.test');
  assert.equal(options.mailConfig.imapMailbox, 'INBOX');
  assert.equal(options.upsertGeneratedAgendaAppointment, upsertGeneratedAgendaAppointment);
  assert.equal(
    options.backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls
  );
});

test('server app runtime composition builders preserve agenda lead detail options and callbacks', () => {
  const findInterestedLeadRowByCallId = () => ({ id: 'lead-1' });

  const options = buildAgendaLeadDetailServiceOptions({
    env: {
      OPENAI_TRANSCRIPTION_MODEL: 'whisper-1',
      OPENAI_AUDIO_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
    },
    envConfig: {
      OPENAI_API_BASE_URL: 'https://api.openai.test',
      PUBLIC_BASE_URL: 'https://softora.test',
    },
    runtimeMemory: {
      recentWebhookEvents: [],
      recentCallUpdates: [],
      callRecordingTranscriptionPromiseByCallId: new Map(),
      aiCallInsightsByCallId: new Map(),
    },
    platformRuntime: {
      normalizeDateYyyyMmDd: (value) => value,
      normalizeTimeHhMm: (value) => value,
      resolveAppointmentCallId: () => 'call-1',
      resolvePreferredRecordingUrl: () => 'https://recording.test',
      inferCallProvider: () => 'retell',
      isTwilioStatusApiConfigured: () => true,
      fetchTwilioRecordingsByCallId: async () => [],
      choosePreferredTwilioRecording: () => null,
      buildTwilioRecordingMediaUrl: () => 'https://twilio.test/media',
      getTwilioBasicAuthorizationHeader: () => 'Basic abc',
      getOpenAiApiKey: () => 'openai',
      extractTwilioRecordingSidFromUrl: () => 'RE123',
    },
    agendaSupportRuntime: {
      sanitizeAppointmentLocation: (value) => value,
      sanitizeAppointmentWhatsappInfo: (value) => value,
      getLatestCallUpdateByCallId: () => null,
      resolveCallDurationSeconds: () => 0,
    },
    aiHelpers: {
      parseJsonLoose: JSON.parse,
      extractTranscriptFull: () => 'full transcript',
    },
    upsertRecentCallUpdate: () => null,
    upsertAiCallInsight: () => null,
    ensureRuleBasedInsightAndAppointment: () => null,
    maybeAnalyzeCallUpdateWithAi: () => null,
    summaryContainsEnglishMarkers: () => false,
    generateTextSummaryWithAi: async () => '',
    findInterestedLeadRowByCallId,
    shared: {
      normalizeString: String,
      truncateText: String,
      normalizeAbsoluteHttpUrl: String,
      fetchBinaryWithTimeout: async () => Buffer.from(''),
    },
  });

  assert.equal(options.openAiTranscriptionModel, 'whisper-1');
  assert.equal(options.openAiAudioTranscriptionModel, 'gpt-4o-mini-transcribe');
  assert.equal(options.publicBaseUrl, 'https://softora.test');
  assert.equal(options.findInterestedLeadRowByCallId, findInterestedLeadRowByCallId);
  assert.equal(options.getTwilioBasicAuthorizationHeader(), 'Basic abc');
});

test('server app runtime composition builders preserve agenda post-call helper options', () => {
  const options = buildAgendaPostCallHelpersOptions({
    normalizeString: String,
    truncateText: String,
    sanitizeLaunchDomainName: (value) => value,
    sanitizeReferenceImages: (value) => value,
    sanitizePostCallText: (value) => value,
    normalizePostCallStatus: (value) => value,
  });

  assert.equal(options.normalizeString, String);
  assert.equal(options.truncateText, String);
  assert.equal(options.sanitizeLaunchDomainName('softora.nl'), 'softora.nl');
  assert.equal(options.normalizePostCallStatus('done'), 'done');
});

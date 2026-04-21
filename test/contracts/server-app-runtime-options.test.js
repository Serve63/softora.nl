const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgendaSupportRuntimeOptions,
  buildAppOpsRuntimeOptions,
  buildFeatureRoutesOptions,
} = require('../../server/services/server-app-runtime-options');
const {
  buildPlatformRuntimeOptions,
} = require('../../server/services/server-app-runtime-foundation-options');
const {
  buildUiSeoRuntimeOptions,
} = require('../../server/services/server-app-runtime-ui-content-options');

test('server app runtime option builders keep agenda support mail config and callbacks stable', () => {
  const upsertGeneratedAgendaAppointment = () => 'agenda-upsert';
  const backfillOpenLeadFollowUpAppointmentsFromLatestCalls = () => 'lead-backfill';
  const resolveAppointmentCallId = () => 'call-123';

  const options = buildAgendaSupportRuntimeOptions({
    normalizeString: String,
    truncateText: String,
    normalizeDateYyyyMmDd: String,
    normalizeTimeHhMm: String,
    normalizeColdcallingStack: String,
    parseNumberSafe: Number,
    toBooleanSafe: Boolean,
    formatEuroLabel: String,
    getColdcallingStackLabel: String,
    resolvePreferredRecordingUrl: String,
    getOpenAiApiKey: String,
    fetchJsonWithTimeout: async () => ({}),
    extractOpenAiTextContent: String,
    parseJsonLoose: JSON.parse,
    openAiApiBaseUrl: 'https://api.openai.test',
    openAiModel: 'gpt-test',
    buildLeadOwnerFields: () => ({}),
    queueRuntimeStatePersist: () => null,
    upsertRecentCallUpdate: () => null,
    upsertGeneratedAgendaAppointment,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    recentCallUpdates: [],
    callUpdatesById: new Map(),
    recentAiCallInsights: [],
    aiCallInsightsByCallId: new Map(),
    aiAnalysisFingerprintByCallId: new Map(),
    aiAnalysisInFlightCallIds: new Set(),
    agendaAppointmentIdByCallId: new Map(),
    generatedAgendaAppointments: [],
    recentDashboardActivities: [],
    summaryContainsEnglishMarkers: () => false,
    generateTextSummaryWithAi: async () => '',
    refreshCallUpdateFromTwilioStatusApi: async () => null,
    refreshCallUpdateFromRetellStatusApi: async () => null,
    confirmationMailRuntimeState: {},
    appendDashboardActivity: () => null,
    mailConfig: {
      smtpHost: 'smtp.test',
      smtpPort: 587,
      smtpSecure: false,
    },
    resolveAppointmentCallId,
  });

  assert.equal(options.mailConfig.smtpHost, 'smtp.test');
  assert.equal(options.mailConfig.smtpPort, 587);
  assert.equal(options.openAiModel, 'gpt-test');
  assert.equal(options.upsertGeneratedAgendaAppointment, upsertGeneratedAgendaAppointment);
  assert.equal(
    options.backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls
  );
  assert.equal(options.resolveAppointmentCallId, resolveAppointmentCallId);
});

test('server app runtime option builders keep feature route coordinators and guards intact', () => {
  const requireRuntimeDebugAccess = () => true;
  const aiDashboardCoordinator = {};
  const aiToolsCoordinator = {};
  const websiteLinkCoordinator = {};
  const websitePreviewLibraryCoordinator = {};
  const activeOrdersCoordinator = {};
  const runtimeOpsCoordinator = {};
  const runtimeDebugOpsCoordinator = {};

  const options = buildFeatureRoutesOptions({
    handleTwilioInboundVoice: () => null,
    handleTwilioStatusWebhook: () => null,
    handleRetellWebhook: () => null,
    premiumRouteRuntime: { sessionSecret: 'secret' },
    coldcalling: { openAiModel: 'gpt-test' },
    aiDashboardCoordinator,
    aiToolsCoordinator,
    websiteLinkCoordinator,
    websitePreviewLibraryCoordinator,
    activeOrdersCoordinator,
    runtimeOpsCoordinator,
    runtimeDebugOpsCoordinator,
    requireRuntimeDebugAccess,
    seoReadCoordinator: {},
    seoWriteCoordinator: {},
  });

  assert.equal(options.premiumRouteRuntime.sessionSecret, 'secret');
  assert.equal(options.coldcalling.openAiModel, 'gpt-test');
  assert.equal(options.aiDashboardCoordinator, aiDashboardCoordinator);
  assert.equal(options.aiToolsCoordinator, aiToolsCoordinator);
  assert.equal(options.websiteLinkCoordinator, websiteLinkCoordinator);
  assert.equal(options.websitePreviewLibraryCoordinator, websitePreviewLibraryCoordinator);
  assert.equal(options.activeOrdersCoordinator, activeOrdersCoordinator);
  assert.equal(options.runtimeOpsCoordinator, runtimeOpsCoordinator);
  assert.equal(options.runtimeDebugOpsCoordinator, runtimeDebugOpsCoordinator);
  assert.equal(options.requireRuntimeDebugAccess, requireRuntimeDebugAccess);
});

test('server app runtime option builders preserve app ops callbacks and metadata', () => {
  const sendPublishedWebsiteLinkResponse = () => 'published';
  const ensureRuntimeStateHydratedFromSupabase = async () => true;
  const log = () => null;

  const options = buildAppOpsRuntimeOptions({
    app: {},
    env: {},
    isSupabaseConfigured: () => false,
    runtimeStateSyncState: {},
    supabaseStateTable: 'state_table',
    supabaseStateKey: 'state_key',
    isSmtpMailConfigured: () => false,
    isImapMailConfigured: () => false,
    mailImapMailbox: 'INBOX',
    mailImapPollCooldownMs: 1000,
    confirmationMailRuntimeState: {},
    getColdcallingProvider: () => 'retell',
    normalizeString: String,
    getMissingEnvVars: () => [],
    premiumSessionSecret: 'secret',
    premiumSessionCookieName: 'cookie',
    isPremiumMfaConfigured: () => false,
    recentWebhookEvents: [],
    recentCallUpdates: [],
    recentAiCallInsights: [],
    recentSecurityAuditEvents: [],
    generatedAgendaAppointments: [],
    appName: 'softora-retell-coldcalling-backend',
    appVersion: '1.2.3',
    featureFlags: { foo: true },
    getPublicFeatureFlags: () => ({ foo: true }),
    routeManifest: {},
    requireRuntimeDebugAccess: () => true,
    buildRuntimeStateSnapshotPayloadWithLimits: () => ({}),
    buildRuntimeBackupForOps: () => ({}),
    isProduction: false,
    isServerlessRuntime: false,
    assetsDirectory: '/tmp/assets',
    securityContactEmail: 'security@test.invalid',
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    sendSeoManagedHtmlPageResponse: () => null,
    resolveLegacyPrettyPageRedirect: () => null,
    toPrettyPagePathFromHtmlFile: () => '/premium-test',
    knownHtmlPageFiles: ['premium-test.html'],
    knownPrettyPageSlugToFile: new Map([['premium-test', 'premium-test.html']]),
    sendPublishedWebsiteLinkResponse,
    demoConfirmationTaskEnabled: true,
    upsertRecentCallUpdate: () => null,
    upsertAiCallInsight: () => null,
    upsertGeneratedAgendaAppointment: () => null,
    queueRuntimeStatePersist: () => null,
    ensureRuntimeStateHydratedFromSupabase,
    log,
  });

  assert.equal(options.appVersion, '1.2.3');
  assert.equal(options.supabaseStateTable, 'state_table');
  assert.equal(options.securityContactEmail, 'security@test.invalid');
  assert.equal(options.sendPublishedWebsiteLinkResponse, sendPublishedWebsiteLinkResponse);
  assert.equal(options.ensureRuntimeStateHydratedFromSupabase, ensureRuntimeStateHydratedFromSupabase);
  assert.equal(options.log, log);
});

test('server app runtime foundation option builders preserve platform callbacks and supabase metadata', () => {
  const getLatestCallUpdateByCallId = () => null;
  const upsertRecentCallUpdate = () => null;

  const options = buildPlatformRuntimeOptions({
    env: { NODE_ENV: 'test' },
    normalizeString: String,
    normalizeColdcallingStack: String,
    parseNumberSafe: Number,
    websiteAnthropicModel: 'claude-website',
    anthropicModel: 'claude-core',
    websiteGenerationProvider: 'anthropic',
    dossierAnthropicModel: 'claude-dossier',
    retellApiBaseUrl: 'https://retell.test',
    twilioApiBaseUrl: 'https://twilio.test',
    defaultTwilioMediaWsUrl: 'wss://twilio.test/media',
    fetchJsonWithTimeout: async () => ({}),
    getEffectivePublicBaseUrl: () => 'https://softora.test',
    normalizeAbsoluteHttpUrl: String,
    appendQueryParamsToUrl: String,
    normalizeNlPhoneToE164: String,
    parseIntSafe: Number,
    truncateText: String,
    extractRetellTranscriptText: String,
    normalizeLeadLikePhoneKey: String,
    getLatestCallUpdateByCallId,
    recentCallUpdates: [],
    callUpdatesById: new Map(),
    recentAiCallInsights: [],
    generatedAgendaAppointments: [],
    upsertRecentCallUpdate,
    retellCallStatusRefreshByCallId: new Map(),
    retellStatusRefreshCooldownMs: 8000,
    supabaseUrl: 'https://supabase.test',
    supabaseServiceRoleKey: 'service-role',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'softora_runtime',
    supabaseCallUpdateStateKeyPrefix: 'call_update:',
    supabaseCallUpdateRowsFetchLimit: 250,
  });

  assert.equal(options.websiteGenerationProvider, 'anthropic');
  assert.equal(options.supabaseStateTable, 'runtime_state');
  assert.equal(options.supabaseCallUpdateStateKeyPrefix, 'call_update:');
  assert.equal(options.getLatestCallUpdateByCallId, getLatestCallUpdateByCallId);
  assert.equal(options.upsertRecentCallUpdate, upsertRecentCallUpdate);
});

test('server app runtime ui-content option builders preserve seo callbacks and runtime sync hooks', () => {
  const getPageBootstrapData = async () => ({ ok: true });
  const persistRuntimeStateToSupabase = async () => true;
  const ensureRuntimeStateHydratedFromSupabase = async () => true;

  const options = buildUiSeoRuntimeOptions({
    uiStateScopePrefix: 'ui_state:',
    inMemoryUiStateByScope: new Map(),
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: () => ({}) }),
    supabaseStateTable: 'runtime_state',
    fetchSupabaseRowByKeyViaRest: async () => null,
    upsertSupabaseRowViaRest: async () => null,
    normalizeString: String,
    truncateText: String,
    knownHtmlPageFiles: ['premium-test.html'],
    normalizeAbsoluteHttpUrl: String,
    normalizeWebsitePreviewTargetUrl: String,
    parseIntSafe: Number,
    seoDefaultSiteOrigin: 'https://www.softora.nl',
    seoMaxImagesPerPage: 2000,
    seoModelPresets: [],
    seoPageFieldDefs: [],
    toBooleanSafe: Boolean,
    pagesDir: '/tmp/pages',
    logger: console,
    knownPrettyPageSlugToFile: new Map([['premium-test', 'premium-test.html']]),
    resolvePremiumHtmlPageAccess: () => ({ ok: true }),
    getPageBootstrapData,
    appendDashboardActivity: () => null,
    appendSecurityAuditEvent: () => null,
    recentDashboardActivities: [],
    recentSecurityAuditEvents: [],
    supabaseUrl: 'https://supabase.test',
    supabaseStateKey: 'softora_runtime',
    supabaseServiceRoleKey: 'service-role',
    redactSupabaseUrlForDebug: () => 'supabase.test',
    fetchImpl: async () => null,
    getBeforeState: () => ({ before: true }),
    persistRuntimeStateToSupabase,
    resetHydrationState: () => null,
    ensureRuntimeStateHydratedFromSupabase,
    getAfterState: () => ({ after: true }),
    slugifyAutomationText: (value) => value,
    resolveLegacyPrettyPageRedirect: () => null,
    getPublicBaseUrlFromRequest: () => 'https://softora.test',
    websiteLinkStateKeyPrefix: 'website_link:',
    seoConfigScope: 'seo',
    seoConfigKey: 'config_json',
    seoConfigCacheTtlMs: 15000,
  });

  assert.equal(options.getPageBootstrapData, getPageBootstrapData);
  assert.equal(options.persistRuntimeStateToSupabase, persistRuntimeStateToSupabase);
  assert.equal(options.ensureRuntimeStateHydratedFromSupabase, ensureRuntimeStateHydratedFromSupabase);
  assert.equal(options.seoConfigScope, 'seo');
  assert.equal(options.websiteLinkStateKeyPrefix, 'website_link:');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createServerAppFoundationRuntime,
  createServerAppOperationalRuntime,
} = require('../../server/services/server-app-runtime-foundation');

function createContext() {
  return {
    app: { name: 'softora-app' },
    env: { NODE_ENV: 'test' },
    express: { json: () => null },
    runtimeEnv: {
      app: { isProduction: false },
      ai: {
        retellApiBaseUrl: 'https://retell.test',
        twilioApiBaseUrl: 'https://twilio.test',
        websiteAnthropicModel: 'claude-website',
        anthropicModel: 'claude-main',
        dossierAnthropicModel: 'claude-dossier',
        verboseCallWebhookLogs: true,
        defaultTwilioMediaWsUrl: 'wss://twilio.test/media',
      },
      websiteGeneration: { provider: 'anthropic' },
      supabase: {
        url: 'https://supabase.test',
        serviceRoleKey: 'service-role',
        stateTable: 'runtime_state',
        stateKey: 'runtime_state_key',
        dismissedLeadsStateKey: 'dismissed_leads',
        callUpdateStateKeyPrefix: 'call_update:',
        callUpdateRowsFetchLimit: 25,
      },
      premiumAuth: {
        loginEmails: ['serve@softora.test'],
        loginPassword: 'secret',
        loginPasswordHash: 'hash',
        sessionSecret: 'session-secret',
        sessionTtlHours: 24,
        sessionCookieName: 'premium_session',
        mfaTotpSecret: 'totp-secret',
        adminIpAllowlist: ['127.0.0.1'],
        enforceSameOriginRequests: true,
        enableRuntimeDebugRoutes: true,
      },
    },
    runtimeMemory: {
      recentWebhookEvents: [],
      recentCallUpdates: [],
      callUpdatesById: new Map(),
      retellCallStatusRefreshByCallId: new Map(),
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [],
      aiCallInsightsByCallId: new Map(),
      agendaAppointmentIdByCallId: new Map(),
      dismissedInterestedLeadCallIds: new Set(),
      dismissedInterestedLeadKeys: new Set(),
      dismissedInterestedLeadKeyUpdatedAtMsByKey: new Map(),
      leadOwnerAssignmentsByCallId: new Map(),
      sequentialDispatchQueues: new Map(),
      sequentialDispatchQueueIdByCallId: new Map(),
      runtimeStateSyncState: {},
      getNextLeadOwnerRotationIndex: () => 0,
      setNextLeadOwnerRotationIndex: () => null,
      getNextGeneratedAgendaAppointmentId: () => 7,
      createSequentialDispatchQueueId: () => 'queue-1',
    },
    appVersion: '1.2.3',
    routeManifest: { healthz: '/healthz' },
    premiumPublicHtmlFiles: new Set(['premium-dashboard.html']),
    noindexHeaderValue: 'noindex, nofollow',
    foundationCallbacks: {
      getEffectivePublicBaseUrl: () => 'https://softora.test',
      normalizeAbsoluteHttpUrl: (value) => value,
      appendQueryParamsToUrl: (value) => value,
      normalizeNlPhoneToE164: (value) => value,
      normalizeLeadLikePhoneKey: (value) => value,
      normalizePremiumSessionEmail: (value) => String(value).toLowerCase(),
      extractRetellTranscriptText: () => 'Transcript',
      getLatestCallUpdateByCallId: () => null,
    },
    operationalCallbacks: {
      getPublicFeatureFlags: () => ({ demo: true }),
      normalizePremiumSessionEmail: (value) => String(value).toLowerCase(),
      resolveCallDurationSeconds: () => 90,
      resolveCallUpdateTimestamp: () => 123,
      maybeAnalyzeCallUpdateWithAi: async () => null,
      ensureRuleBasedInsightAndAppointment: async () => null,
      getEffectivePublicBaseUrl: () => 'https://softora.test',
      normalizeAbsoluteHttpUrl: (value) => value,
      appendQueryParamsToUrl: (value) => value,
    },
    shared: {
      normalizeString: (value) => String(value || ''),
      truncateText: (value) => String(value || '').slice(0, 100),
      normalizeColdcallingStack: (value) => value,
      parseIntSafe: Number.parseInt,
      parseNumberSafe: Number,
      fetchJsonWithTimeout: async () => ({}),
      timingSafeEqualStrings: () => true,
      normalizeIpAddress: (value) => value,
      normalizeOrigin: (value) => value,
      getClientIpFromRequest: () => '127.0.0.1',
      getRequestOriginFromHeaders: () => 'https://softora.test',
      getRequestPathname: () => '/premium',
      isSecureHttpRequest: () => true,
      escapeHtml: (value) => value,
    },
  };
}

function createPlatformRuntimeStub() {
  return {
    toBooleanSafe: Boolean,
    normalizeDateYyyyMmDd: (value) => value,
    normalizeTimeHhMm: (value) => value,
    getSupabaseClient: () => ({ url: 'supabase-client' }),
    fetchSupabaseRowByKeyViaRest: async () => null,
    upsertSupabaseRowViaRest: async () => null,
    fetchSupabaseStateRowViaRest: async () => null,
    upsertSupabaseStateRowViaRest: async () => null,
    fetchSupabaseCallUpdateRowsViaRest: async () => [],
    buildSupabaseCallUpdateStateKey: (callId) => `call_update:${callId}`,
    extractCallIdFromSupabaseCallUpdateStateKey: (key) => key.replace('call_update:', ''),
    getColdcallingStackLabel: () => 'sales',
    resolveColdcallingProviderForCampaign: () => 'retell',
    buildRetellPayload: () => ({}),
    createRetellOutboundCall: async () => ({}),
    classifyRetellFailure: () => 'retell_failure',
    toIsoFromUnixMilliseconds: () => '2026-04-17T00:00:00.000Z',
    refreshCallUpdateFromRetellStatusApi: async () => null,
    buildTwilioOutboundPayload: () => ({}),
    createTwilioOutboundCall: async () => ({}),
    classifyTwilioFailure: () => 'twilio_failure',
    parseDateToIso: () => '2026-04-17',
    getTwilioMediaWsUrlForStack: () => 'wss://twilio.test/media',
    buildTwilioStatusCallbackUrl: () => 'https://softora.test/twilio/status',
    extractCallUpdateFromTwilioPayload: () => ({}),
    extractCallUpdateFromRetellPayload: () => ({}),
    isSupabaseConfigured: () => true,
    isTerminalColdcallingStatus: () => false,
  };
}

function createSecurityRuntimeStub() {
  return {
    appendSecurityAuditEvent: () => null,
    getPremiumAuthState: () => ({}),
    getStateChangingApiProtectionDecision: () => ({ allowed: true }),
    isPremiumPublicApiRequest: () => false,
    normalizeLeadOwnerRecord: (value) => value,
  };
}

test('server app runtime foundation builds platform and security runtimes with stable env/config', () => {
  const context = createContext();
  let capturedPlatformOptions = null;
  let capturedSecurityOptions = null;

  const result = createServerAppFoundationRuntime(context, {
    createPlatformRuntimeImpl: (options) => {
      capturedPlatformOptions = options;
      return createPlatformRuntimeStub();
    },
    createSecurityRuntimeImpl: (options) => {
      capturedSecurityOptions = options;
      return createSecurityRuntimeStub();
    },
  });

  assert.equal(capturedPlatformOptions.retellApiBaseUrl, 'https://retell.test');
  assert.equal(capturedPlatformOptions.supabaseStateTable, 'runtime_state');
  assert.equal(capturedSecurityOptions.premiumSessionSecret, 'session-secret');
  assert.equal(capturedSecurityOptions.noindexHeaderValue, 'noindex, nofollow');
  assert.equal(typeof result.bindRuntimeSyncRuntime, 'function');
  assert.equal(typeof result.queueRuntimeStatePersist, 'function');
  assert.equal(typeof result.upsertRecentCallUpdate, 'function');
});

test('server app runtime foundation helper closures bind to runtime sync once operational runtime is created', () => {
  const context = createContext();
  const runtimeSyncRuntime = {
    ensureRuntimeStateHydratedFromSupabase: async () => true,
    waitForQueuedRuntimeStatePersist: async () => true,
    upsertRecentCallUpdate: (...args) => ['upsert', ...args],
    queueRuntimeStatePersist: (reason) => `queued:${reason}`,
    buildRuntimeStateSnapshotPayload: () => ({ snapshot: true }),
  };

  const foundationRuntime = createServerAppFoundationRuntime(context, {
    createPlatformRuntimeImpl: () => createPlatformRuntimeStub(),
    createSecurityRuntimeImpl: () => createSecurityRuntimeStub(),
  });

  createServerAppOperationalRuntime(
    {
      ...context,
      platformRuntime: foundationRuntime.platformRuntime,
      securityRuntime: foundationRuntime.securityRuntime,
      bindRuntimeSyncRuntime: foundationRuntime.bindRuntimeSyncRuntime,
      upsertRecentCallUpdate: foundationRuntime.upsertRecentCallUpdate,
    },
    {
      createRuntimeSyncRuntimeImpl: () => runtimeSyncRuntime,
      applyAppMiddlewareImpl: () => ({ premiumLoginRateLimiter: null }),
      createColdcallingServiceRuntimeImpl: () => ({ processColdcallingLead: () => null }),
    }
  );

  assert.deepEqual(foundationRuntime.upsertRecentCallUpdate('call-1'), ['upsert', 'call-1']);
  assert.equal(foundationRuntime.queueRuntimeStatePersist('refresh'), 'queued:refresh');
  assert.deepEqual(foundationRuntime.buildRuntimeStateSnapshotPayload(), { snapshot: true });
});

test('server app runtime operational phase wires runtime sync, middleware and coldcalling together', () => {
  const context = createContext();
  let capturedRuntimeSyncOptions = null;
  let capturedMiddlewareOptions = null;
  let capturedColdcallingOptions = null;
  const runtimeSyncRuntime = {
    ensureRuntimeStateHydratedFromSupabase: async () => true,
    waitForQueuedRuntimeStatePersist: async () => true,
    upsertRecentCallUpdate: () => 'upserted',
    queueRuntimeStatePersist: () => 'queued',
    buildRuntimeStateSnapshotPayload: () => ({ ok: true }),
  };
  const coldcallingServiceRuntime = { processColdcallingLead: () => 'processed' };

  const foundationRuntime = createServerAppFoundationRuntime(context, {
    createPlatformRuntimeImpl: () => createPlatformRuntimeStub(),
    createSecurityRuntimeImpl: () => createSecurityRuntimeStub(),
  });

  const result = createServerAppOperationalRuntime(
    {
      ...context,
      platformRuntime: foundationRuntime.platformRuntime,
      securityRuntime: foundationRuntime.securityRuntime,
      bindRuntimeSyncRuntime: foundationRuntime.bindRuntimeSyncRuntime,
      upsertRecentCallUpdate: foundationRuntime.upsertRecentCallUpdate,
    },
    {
      createRuntimeSyncRuntimeImpl: (options) => {
        capturedRuntimeSyncOptions = options;
        return runtimeSyncRuntime;
      },
      applyAppMiddlewareImpl: (appArg, options) => {
        capturedMiddlewareOptions = { appArg, options };
        return { premiumLoginRateLimiter: { scope: 'premium-login' } };
      },
      createColdcallingServiceRuntimeImpl: (options) => {
        capturedColdcallingOptions = options;
        return coldcallingServiceRuntime;
      },
    }
  );

  assert.equal(capturedRuntimeSyncOptions.appVersion, '1.2.3');
  assert.equal(capturedRuntimeSyncOptions.routeManifest.healthz, '/healthz');
  assert.equal(
    capturedMiddlewareOptions.options.ensureRuntimeStateHydratedFromSupabase,
    runtimeSyncRuntime.ensureRuntimeStateHydratedFromSupabase
  );
  assert.equal(capturedColdcallingOptions.verboseCallWebhookLogs, true);
  assert.equal(capturedColdcallingOptions.createQueueId(), 'queue-1');
  assert.equal(result.runtimeSyncRuntime, runtimeSyncRuntime);
  assert.equal(result.coldcallingServiceRuntime, coldcallingServiceRuntime);
  assert.deepEqual(result.premiumLoginRateLimiter, { scope: 'premium-login' });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildServerAppEnvConfig,
  buildServerAppRuntimeMemoryState,
  createServerAppRuntimeBootstrap,
} = require('../../server/services/server-app-runtime-bootstrap');

test('server app runtime bootstrap flattens env config without changing values', () => {
  const envConfig = buildServerAppEnvConfig({
    app: { port: 3000, isProduction: true, publicBaseUrl: 'https://softora.test' },
    ai: {
      retellApiBaseUrl: 'https://retell.test',
      twilioApiBaseUrl: 'https://twilio.test',
      openaiApiBaseUrl: 'https://api.openai.test',
      openaiModel: 'gpt-test',
      openaiImageModel: 'gpt-image-test',
      anthropicApiBaseUrl: 'https://anthropic.test',
      anthropicModel: 'claude-test',
      websiteAnthropicModel: 'claude-website',
      dossierAnthropicModel: 'claude-dossier',
      verboseCallWebhookLogs: true,
      defaultTwilioMediaWsUrl: 'wss://twilio.test/media',
    },
    websiteGeneration: {
      provider: 'anthropic',
      strictAnthropic: true,
      strictHtml: false,
      timeoutMs: 120000,
    },
    activeOrderAutomation: {
      enabled: true,
      githubToken: 'gh-token',
      githubOwner: 'softora',
      githubPrivate: true,
      githubOwnerIsOrg: false,
      githubRepoPrefix: 'softora-',
      githubDefaultBranch: 'main',
      vercelToken: 'vercel-token',
      vercelScope: 'softora-scope',
      stratoCommand: 'deploy',
      stratoWebhookUrl: 'https://strato.test/webhook',
      stratoWebhookToken: 'strato-token',
    },
    supabase: {
      url: 'https://supabase.test',
      serviceRoleKey: 'service-role',
      stateTable: 'runtime_state',
      stateKey: 'runtime_key',
      callUpdateStateKeyPrefix: 'call_update:',
      dismissedLeadsStateKey: 'dismissed',
      callUpdateRowsFetchLimit: 50,
    },
    premiumAuth: {
      loginEmails: ['serve@softora.test'],
      loginPassword: 'secret',
      loginPasswordHash: 'hash',
      sessionSecret: 'session-secret',
      sessionTtlHours: 24,
      sessionRememberTtlDays: 30,
      sessionCookieName: 'premium_session',
      mfaTotpSecret: 'totp',
      adminIpAllowlist: ['127.0.0.1'],
      enforceSameOriginRequests: true,
      enableRuntimeDebugRoutes: true,
    },
    mail: {
      smtpHost: 'smtp.test',
      smtpPort: 587,
      smtpUser: 'mailer',
      smtpPass: 'smtp-pass',
      smtpSecure: false,
      fromAddress: 'noreply@test.invalid',
      fromName: 'Softora',
      replyTo: 'reply@test.invalid',
      imapHost: 'imap.test',
      imapPort: 993,
      imapSecure: true,
      imapUser: 'imap-user',
      imapPass: 'imap-pass',
      imapMailbox: 'INBOX',
      imapExtraMailboxes: ['Sent'],
      imapPollCooldownMs: 1000,
    },
    securityContactEmail: 'security@test.invalid',
    demoConfirmationTaskEnabled: true,
  });

  assert.equal(envConfig.PORT, 3000);
  assert.equal(envConfig.OPENAI_MODEL, 'gpt-test');
  assert.equal(envConfig.SUPABASE_STATE_TABLE, 'runtime_state');
  assert.deepEqual(envConfig.PREMIUM_LOGIN_EMAILS, ['serve@softora.test']);
  assert.equal(envConfig.MAIL_IMAP_MAILBOX, 'INBOX');
  assert.equal(envConfig.SECURITY_CONTACT_EMAIL, 'security@test.invalid');
});

test('server app runtime bootstrap preserves runtime memory references', () => {
  const runtimeMemory = {
    recentWebhookEvents: [],
    recentCallUpdates: [],
    callUpdatesById: new Map(),
    retellCallStatusRefreshByCallId: new Map(),
    recentAiCallInsights: [],
    recentDashboardActivities: [],
    recentSecurityAuditEvents: [],
    inMemoryUiStateByScope: new Map(),
    aiCallInsightsByCallId: new Map(),
    aiAnalysisFingerprintByCallId: new Map(),
    aiAnalysisInFlightCallIds: new Set(),
    callRecordingTranscriptionPromiseByCallId: new Map(),
    generatedAgendaAppointments: [],
    agendaAppointmentIdByCallId: new Map(),
    dismissedInterestedLeadCallIds: new Set(),
    dismissedInterestedLeadKeys: new Set(),
    dismissedInterestedLeadKeyUpdatedAtMsByKey: new Map(),
    leadOwnerAssignmentsByCallId: new Map(),
    sequentialDispatchQueues: new Map(),
    sequentialDispatchQueueIdByCallId: new Map(),
    confirmationMailRuntimeState: {},
    runtimeStateSyncState: {},
    getNextLeadOwnerRotationIndex: () => 1,
    setNextLeadOwnerRotationIndex: () => null,
    getNextGeneratedAgendaAppointmentId: () => 7,
    takeNextGeneratedAgendaAppointmentId: () => 7,
    createSequentialDispatchQueueId: () => 'queue-1',
  };

  const mapped = buildServerAppRuntimeMemoryState(runtimeMemory);

  assert.equal(mapped.callUpdatesById, runtimeMemory.callUpdatesById);
  assert.equal(mapped.runtimeStateSyncState, runtimeMemory.runtimeStateSyncState);
  assert.equal(mapped.createSequentialDispatchQueueId, runtimeMemory.createSequentialDispatchQueueId);
});

test('server app runtime bootstrap creates app, runtime state and known page mappings', () => {
  const expressApp = {
    setCalls: [],
    set(key, value) {
      this.setCalls.push([key, value]);
    },
  };
  const runtimeEnv = {
    app: { port: 3000, isProduction: false, publicBaseUrl: 'https://softora.test' },
    ai: {
      retellApiBaseUrl: 'https://retell.test',
      twilioApiBaseUrl: 'https://twilio.test',
      openaiApiBaseUrl: 'https://api.openai.test',
      openaiModel: 'gpt-test',
      openaiImageModel: 'gpt-image-test',
      anthropicApiBaseUrl: 'https://anthropic.test',
      anthropicModel: 'claude-test',
      websiteAnthropicModel: 'claude-website',
      dossierAnthropicModel: 'claude-dossier',
      verboseCallWebhookLogs: false,
      defaultTwilioMediaWsUrl: 'wss://twilio.test/media',
    },
    websiteGeneration: { provider: 'anthropic', strictAnthropic: true, strictHtml: true, timeoutMs: 120000 },
    activeOrderAutomation: {
      enabled: false,
      githubToken: '',
      githubOwner: '',
      githubPrivate: false,
      githubOwnerIsOrg: false,
      githubRepoPrefix: 'softora-',
      githubDefaultBranch: 'main',
      vercelToken: '',
      vercelScope: '',
      stratoCommand: '',
      stratoWebhookUrl: '',
      stratoWebhookToken: '',
    },
    supabase: {
      url: '',
      serviceRoleKey: '',
      stateTable: 'runtime_state',
      stateKey: 'runtime_key',
      callUpdateStateKeyPrefix: 'call_update:',
      dismissedLeadsStateKey: 'dismissed',
      callUpdateRowsFetchLimit: 25,
    },
    premiumAuth: {
      loginEmails: [],
      loginPassword: '',
      loginPasswordHash: '',
      sessionSecret: '',
      sessionTtlHours: 24,
      sessionRememberTtlDays: 30,
      sessionCookieName: 'premium_session',
      mfaTotpSecret: '',
      adminIpAllowlist: [],
      enforceSameOriginRequests: true,
      enableRuntimeDebugRoutes: false,
    },
    mail: {
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpSecure: false,
      fromAddress: '',
      fromName: '',
      replyTo: '',
      imapHost: '',
      imapPort: 993,
      imapSecure: true,
      imapUser: '',
      imapPass: '',
      imapMailbox: 'INBOX',
      imapExtraMailboxes: [],
      imapPollCooldownMs: 1000,
    },
    securityContactEmail: '',
    demoConfirmationTaskEnabled: false,
  };
  const runtimeMemory = {
    recentWebhookEvents: [],
    recentCallUpdates: [],
    callUpdatesById: new Map(),
    retellCallStatusRefreshByCallId: new Map(),
    recentAiCallInsights: [],
    recentDashboardActivities: [],
    recentSecurityAuditEvents: [],
    inMemoryUiStateByScope: new Map(),
    aiCallInsightsByCallId: new Map(),
    aiAnalysisFingerprintByCallId: new Map(),
    aiAnalysisInFlightCallIds: new Set(),
    callRecordingTranscriptionPromiseByCallId: new Map(),
    generatedAgendaAppointments: [],
    agendaAppointmentIdByCallId: new Map(),
    dismissedInterestedLeadCallIds: new Set(),
    dismissedInterestedLeadKeys: new Set(),
    dismissedInterestedLeadKeyUpdatedAtMsByKey: new Map(),
    leadOwnerAssignmentsByCallId: new Map(),
    sequentialDispatchQueues: new Map(),
    sequentialDispatchQueueIdByCallId: new Map(),
    confirmationMailRuntimeState: {},
    runtimeStateSyncState: {},
    getNextLeadOwnerRotationIndex: () => 0,
    setNextLeadOwnerRotationIndex: () => null,
    getNextGeneratedAgendaAppointmentId: () => 1,
    takeNextGeneratedAgendaAppointmentId: () => 1,
    createSequentialDispatchQueueId: () => 'queue-1',
  };

  const result = createServerAppRuntimeBootstrap(
    {
      env: { VERCEL: '1' },
      expressImpl: () => expressApp,
      projectRootDir: '/tmp/project',
      logger: { log: () => null },
    },
    {
      loadRuntimeEnvImpl: () => runtimeEnv,
      createRuntimeMemoryStateImpl: () => runtimeMemory,
      getKnownHtmlPageFilesImpl: () => ['premium-test.html'],
      createKnownPrettyPageSlugToFileImpl: () => new Map([['premium-test', 'premium-test.html']]),
      createPremiumPublicHtmlFilesSetImpl: () => new Set(['premium-public.html']),
    }
  );

  assert.equal(result.app, expressApp);
  assert.deepEqual(expressApp.setCalls, [['trust proxy', 1]]);
  assert.equal(result.runtimeEnv, runtimeEnv);
  assert.equal(result.runtimeMemory, runtimeMemory);
  assert.equal(result.envConfig.PORT, 3000);
  assert.equal(result.bootstrapState.NOINDEX_HEADER_VALUE, 'noindex, nofollow, noarchive, nosnippet');
  assert.deepEqual(result.bootstrapState.knownHtmlPageFiles, ['premium-test.html']);
  assert.equal(result.bootstrapState.knownPrettyPageSlugToFile.get('premium-test'), 'premium-test.html');
  assert.equal(result.isServerlessRuntime, true);
});

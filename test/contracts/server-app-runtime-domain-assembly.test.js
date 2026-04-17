const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assembleServerAppRuntimeDomainsWithFactories,
} = require('../../server/services/server-app-runtime-domain-assembly');

function createFallbackProxy(overrides = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (..._args) => null;
    },
  });
}

test('server app runtime domain assembly keeps late-bound refs and page bootstrap wiring intact', async () => {
  const runtimeCallbackRefs = {
    extractRetellTranscriptText: () => 'initial-transcript',
    getLatestCallUpdateByCallId: () => 'initial-call',
  };
  const captured = {};

  const runtimeSyncRuntime = createFallbackProxy({
    ensureRuntimeStateHydratedFromSupabase: async () => true,
    buildRuntimeBackupForOps: () => ({ ok: true }),
    buildRuntimeStateSnapshotPayloadWithLimits: () => ({ limited: true }),
  });
  const coldcallingServiceRuntime = createFallbackProxy({});
  const agendaSupportRuntime = createFallbackProxy({
    getLatestCallUpdateByCallId: () => 'assembled-call',
    maybeAnalyzeCallUpdateWithAi: async () => ({ ok: true }),
    resolveCallDurationSeconds: () => 33,
    isSmtpMailConfigured: () => true,
    isImapMailConfigured: () => true,
    upsertAiCallInsight: () => ({ ok: true }),
  });
  const aiHelpers = createFallbackProxy({
    extractRetellTranscriptText: () => 'assembled-transcript',
    extractOpenAiTextContent: () => 'openai-text',
    parseJsonLoose: () => ({ ok: true }),
  });
  const uiSeoRuntime = createFallbackProxy({
    websiteLinkCoordinator: {
      sendPublishedWebsiteLinkResponse: () => null,
    },
  });

  const result = assembleServerAppRuntimeDomainsWithFactories(
    {
      app: { locals: {} },
      env: { NODE_ENV: 'test' },
      expressImpl: { json: () => null },
      runtimeEnv: { app: { port: 3000 } },
      runtimeMemory: {},
      envConfig: {},
      bootstrapState: {},
      appVersion: '1.0.0-test',
      routeManifest: [],
      featureFlags: {},
      getPublicFeatureFlags: () => ({}),
      isServerlessRuntime: false,
      projectRootDir: '/tmp/softora',
      platformRuntime: createFallbackProxy({
        isSupabaseConfigured: () => true,
        getColdcallingProvider: () => 'retell',
        getMissingEnvVars: () => [],
      }),
      securityRuntime: createFallbackProxy({}),
      bindRuntimeSyncRuntime: () => runtimeSyncRuntime,
      upsertRecentCallUpdate: () => ({ ok: true }),
      queueRuntimeStatePersist: () => ({ queued: true }),
      buildRuntimeStateSnapshotPayload: () => ({ snapshot: true }),
      getEffectivePublicBaseUrl: () => 'https://softora.test',
      normalizePremiumSessionEmail: (value) => String(value || '').trim().toLowerCase(),
      resolveCallUpdateTimestamp: () => '2026-04-17T10:00:00.000Z',
      normalizeAbsoluteHttpUrl: (value) => String(value || ''),
      appendQueryParamsToUrl: (value) => String(value || ''),
      resolveLegacyPrettyPageRedirect: () => null,
      toPrettyPagePathFromHtmlFile: (value) => value,
      runtimeCallbackRefs,
      shared: {
        normalizeString: (value) => String(value || '').trim(),
        truncateText: (value) => String(value || ''),
        normalizeColdcallingStack: (value) => String(value || ''),
        parseIntSafe: Number,
        parseNumberSafe: Number,
        fetchJsonWithTimeout: async () => ({}),
        fetchBinaryWithTimeout: async () => Buffer.from(''),
        fetchTextWithTimeout: async () => '',
        clipText: (value) => String(value || ''),
        timingSafeEqualStrings: () => true,
        getClientIpFromRequest: () => '127.0.0.1',
        getRequestOriginFromHeaders: () => 'https://softora.test',
        getRequestPathname: () => '/premium',
        isSecureHttpRequest: () => true,
        escapeHtml: (value) => String(value || ''),
        assertWebsitePreviewUrlIsPublic: () => true,
        normalizeWebsitePreviewTargetUrl: (value) => String(value || ''),
      },
    },
    {
      createAgendaSupportRuntimeImpl: () => agendaSupportRuntime,
      createAgendaLeadDetailServiceImpl: () => createFallbackProxy({}),
      createAgendaPostCallHelpersImpl: () => createFallbackProxy({}),
      createServerAppOperationalRuntimeImpl: () => ({
        runtimeSyncRuntime,
        coldcallingServiceRuntime,
        premiumLoginRateLimiter: () => true,
      }),
      createServerAppUiContentRuntimeImpl: (context) => {
        captured.uiContentContext = context;
        return {
          websiteInputRuntime: createFallbackProxy({
            sanitizeReferenceImages: (value) => value,
            sanitizeLaunchDomainName: (value) => value,
          }),
          aiHelpers,
          uiSeoRuntime,
          aiContentRuntime: createFallbackProxy({
            aiSummaryService: {
              generateTextSummaryWithAi: async () => 'samenvatting',
              normalizeAiSummaryStyle: () => 'medium',
              summaryContainsEnglishMarkers: () => false,
            },
          }),
        };
      },
      createServerAppFeatureWiringImpl: () => ({}),
      createServerAppAgendaWiringImpl: (context) => {
        captured.agendaWiringContext = context;
        return {
          agendaInterestedLeadReadService: {
            findInterestedLeadRowByCallId: () => ({ id: 'lead-1' }),
          },
          backfillOpenLeadFollowUpAppointmentsFromLatestCalls: async () => [],
          upsertGeneratedAgendaAppointment: async () => ({ id: 'appt-1' }),
          buildRuntimeHtmlPageBootstrapData: async () => ({ from: 'agenda-wiring' }),
        };
      },
      createServerAppOpsWiringImpl: () => ({
        seedDemoConfirmationTaskForUiTesting: () => 'seeded',
      }),
      buildAgendaSupportRuntimeCompositionOptionsImpl: (options) => options,
      buildAgendaLeadDetailServiceOptionsImpl: (options) => options,
      buildAgendaPostCallHelpersOptionsImpl: (options) => options,
      buildServerAppAgendaWiringRuntimeContextImpl: (context) => context,
      buildServerAppFeatureWiringRuntimeContextImpl: (context) => context,
      buildServerAppOperationalRuntimeContextImpl: (context) => context,
      buildServerAppOpsWiringRuntimeContextImpl: (context) => context,
      buildServerAppUiContentRuntimeCompositionContextImpl: (context) => context,
      normalizeAgendaRuntimePostCallStatusImpl: (value) => value,
      sanitizeAgendaRuntimePostCallTextImpl: (value) => value,
    }
  );

  assert.equal(runtimeCallbackRefs.getLatestCallUpdateByCallId(), 'assembled-call');
  assert.equal(runtimeCallbackRefs.extractRetellTranscriptText(), 'assembled-transcript');
  assert.deepEqual(
    await captured.uiContentContext.getPageBootstrapData({}, 'premium-ai-lead-generator.html'),
    { from: 'agenda-wiring' }
  );
  assert.equal(result.runtimeSyncRuntime, runtimeSyncRuntime);
  assert.equal(result.seedDemoConfirmationTaskForUiTesting(), 'seeded');
  assert.equal(
    captured.agendaWiringContext.shared.normalizeAbsoluteHttpUrl('https://softora.test'),
    'https://softora.test'
  );
});

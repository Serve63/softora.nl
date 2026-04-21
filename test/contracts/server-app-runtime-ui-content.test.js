const test = require('node:test');
const assert = require('node:assert/strict');

const { createServerAppUiContentRuntime } = require('../../server/services/server-app-runtime-ui-content');

function createContext() {
  return {
    env: { NODE_ENV: 'test' },
    runtimeEnv: {
      ai: {
        openaiApiBaseUrl: 'https://openai.test',
        openaiModel: 'gpt-test',
        openaiImageModel: 'gpt-image-test',
        anthropicApiBaseUrl: 'https://anthropic.test',
        anthropicModel: 'claude-test',
      },
      websiteGeneration: {
        timeoutMs: 120000,
        strictAnthropic: true,
        strictHtml: false,
      },
      supabase: {
        url: 'https://supabase.test',
        serviceRoleKey: 'service-role',
        stateTable: 'runtime_state',
        stateKey: 'runtime_key',
      },
    },
    runtimeMemory: {
      recentWebhookEvents: [],
      recentCallUpdates: [],
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [],
      inMemoryUiStateByScope: new Map(),
    },
    projectRootDir: '/tmp/softora',
    knownHtmlPageFiles: ['premium-test.html'],
    knownPrettyPageSlugToFile: new Map([['premium-test', 'premium-test.html']]),
    uiSeoConfig: {
      uiStateScopePrefix: 'ui_state:',
      seoDefaultSiteOrigin: 'https://softora.test',
      seoMaxImagesPerPage: 8,
      seoModelPresets: [{ label: 'Fast', value: 'fast' }],
      seoPageFieldDefs: [{ key: 'title', maxLength: 100 }],
      seoConfigScope: 'seo',
      seoConfigKey: 'seo_config',
      seoConfigCacheTtlMs: 60000,
    },
    shared: {
      normalizeString: (value) => String(value || ''),
      truncateText: (value) => String(value || '').slice(0, 100),
      clipText: (value) => value,
      escapeHtml: (value) => value,
      parseIntSafe: Number.parseInt,
      fetchJsonWithTimeout: async () => ({}),
      fetchTextWithTimeout: async () => '<html></html>',
      fetchBinaryWithTimeout: async () => ({ response: { ok: true, status: 200 }, bytes: Buffer.from('') }),
      assertWebsitePreviewUrlIsPublic: async () => true,
      normalizeAbsoluteHttpUrl: (value) => value,
      normalizeWebsitePreviewTargetUrl: (value) => value,
    },
    platform: {
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({ url: 'supabase-client' }),
      fetchSupabaseRowByKeyViaRest: async () => null,
      upsertSupabaseRowViaRest: async () => null,
      getOpenAiApiKey: () => 'openai-key',
      getAnthropicApiKey: () => 'anthropic-key',
      getWebsiteGenerationProvider: () => 'anthropic',
      getWebsiteAnthropicModel: () => 'claude-website',
      getDossierAnthropicModel: () => 'claude-dossier',
      getAnthropicDossierMaxTokens: () => 4096,
      redactSupabaseUrlForDebug: () => 'supabase.test',
      toBooleanSafe: Boolean,
    },
    runtimeSync: {
      persistRuntimeStateToSupabase: async () => null,
      ensureRuntimeStateHydratedFromSupabase: async () => true,
      runtimeStateSyncState: {
        supabaseStateHydrated: true,
        supabaseLastHydrateError: null,
        supabaseLastPersistError: null,
        supabaseLastCallUpdatePersistError: null,
        supabaseHydrateRetryNotBeforeMs: 0,
      },
    },
    uiCallbacks: {
      resolvePremiumHtmlPageAccess: () => ({ allowed: true }),
      appendDashboardActivity: () => null,
      appendSecurityAuditEvent: () => null,
      getPageBootstrapData: async () => ({ ok: true }),
      getEffectivePublicBaseUrl: () => 'https://softora.test',
      resolveLegacyPrettyPageRedirect: () => null,
    },
  };
}

test('server app runtime ui/content wiring preserves ui-seo config and runtime sync callbacks', () => {
  const context = createContext();
  const websiteInputRuntime = {
    parseImageDataUrl: () => ({}),
    sanitizeReferenceImages: () => [],
    sanitizeLaunchDomainName: (value) => value,
    slugifyAutomationText: (value) => value,
  };
  const websiteGenerationRuntime = {
    buildAnthropicWebsiteHtmlPrompts: () => ({}),
    buildLocalWebsiteBlueprint: () => ({}),
    buildWebsiteGenerationContext: () => ({}),
    buildWebsiteGenerationPrompts: () => ({}),
    buildWebsitePreviewBriefFromScan: () => ({}),
    buildWebsitePreviewDownloadFileName: () => 'preview.png',
    buildWebsitePreviewPromptFromScan: () => 'prompt',
    ensureHtmlDocument: () => '<html></html>',
    ensureStrictAnthropicHtml: () => '<html></html>',
    getAnthropicWebsiteStageEffort: () => 'medium',
    getAnthropicWebsiteStageMaxTokens: () => 4096,
    isLikelyUsableWebsiteHtml: () => true,
    supportsAnthropicAdaptiveThinking: () => true,
  };
  const aiHelpers = {
    estimateAnthropicTextCost: () => 1,
    estimateAnthropicUsageCost: () => 2,
    estimateOpenAiTextCost: () => 3,
    estimateOpenAiUsageCost: () => 4,
    extractAnthropicTextContent: () => 'anthropic',
    extractOpenAiTextContent: () => 'openai',
    extractRetellTranscriptText: () => 'retell',
    extractTranscriptFull: () => 'full',
    extractTranscriptSnippet: () => 'snippet',
    extractTranscriptText: () => 'text',
    parseJsonLoose: () => ({}),
  };
  const uiSeoRuntime = {
    extractWebsitePreviewScanFromHtml: () => ({ title: 'Preview' }),
    getUiStateValues: () => ({}),
    normalizeUiStateScope: (value) => value,
    sanitizeUiStateValues: (value) => value,
    setUiStateValues: async () => null,
    sendSeoManagedHtmlPageResponse: () => null,
    seoReadCoordinator: {},
    seoWriteCoordinator: {},
    runtimeOpsCoordinator: {},
    runtimeDebugOpsCoordinator: {},
    websiteLinkCoordinator: {},
    websitePreviewLibraryCoordinator: {},
  };
  const aiContentRuntime = {
    aiSummaryService: {},
    buildOrderDossierFallbackLayout: () => ({}),
    buildOrderDossierInput: () => ({}),
    buildWebsitePromptFallback: () => 'fallback',
    extractMeetingNotesFromImageWithAi: async () => '',
    fetchWebsitePreviewScanFromUrl: async () => ({}),
    generateDynamicOrderDossierWithAnthropic: async () => ({}),
    generateWebsiteHtmlWithAi: async () => '<html></html>',
    generateWebsitePreviewImageWithAi: async () => 'data:image/png;base64,abc',
    generateWebsitePromptFromTranscriptWithAi: async () => 'prompt',
  };
  let capturedUiSeoOptions = null;
  let capturedAiContentOptions = null;

  const result = createServerAppUiContentRuntime(context, {
    createWebsiteInputHelpersImpl: () => websiteInputRuntime,
    createWebsiteGenerationHelpersImpl: () => websiteGenerationRuntime,
    createAiHelpersImpl: () => aiHelpers,
    createUiSeoRuntimeImpl: (options) => {
      capturedUiSeoOptions = options;
      return uiSeoRuntime;
    },
    createAiContentRuntimeImpl: (options) => {
      capturedAiContentOptions = options;
      return aiContentRuntime;
    },
  });

  assert.equal(capturedUiSeoOptions.uiStateScopePrefix, 'ui_state:');
  assert.equal(capturedUiSeoOptions.supabaseStateTable, 'runtime_state');
  assert.equal(capturedUiSeoOptions.appendSecurityAuditEvent, context.uiCallbacks.appendSecurityAuditEvent);
  assert.equal(
    capturedUiSeoOptions.ensureRuntimeStateHydratedFromSupabase,
    context.runtimeSync.ensureRuntimeStateHydratedFromSupabase
  );
  assert.equal(capturedAiContentOptions.openAiApiBaseUrl, 'https://openai.test');
  assert.equal(capturedAiContentOptions.anthropicApiBaseUrl, 'https://anthropic.test');
  assert.equal(capturedAiContentOptions.openAiImageModel, 'gpt-image-test');
  assert.equal(capturedAiContentOptions.extractWebsitePreviewScanFromHtml, uiSeoRuntime.extractWebsitePreviewScanFromHtml);
  assert.equal(capturedAiContentOptions.fetchBinaryWithTimeout, context.shared.fetchBinaryWithTimeout);
  assert.equal(result.websiteInputRuntime, websiteInputRuntime);
  assert.equal(result.uiSeoRuntime, uiSeoRuntime);
  assert.equal(result.aiContentRuntime, aiContentRuntime);
});

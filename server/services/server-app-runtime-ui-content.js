const { createAiContentRuntime } = require('./ai-content-runtime');
const { createAiHelpers } = require('./ai-helpers');
const { createUiSeoRuntime } = require('./ui-seo-runtime');
const { createWebsiteGenerationHelpers } = require('./website-generation');
const { createWebsiteInputHelpers } = require('./website-inputs');
const {
  buildAiContentRuntimeOptions,
  buildUiSeoRuntimeOptions,
} = require('./server-app-runtime-ui-content-options');

function createServerAppUiContentRuntime(context, dependencies = {}) {
  const {
    createAiContentRuntimeImpl = createAiContentRuntime,
    createAiHelpersImpl = createAiHelpers,
    createUiSeoRuntimeImpl = createUiSeoRuntime,
    createWebsiteGenerationHelpersImpl = createWebsiteGenerationHelpers,
    createWebsiteInputHelpersImpl = createWebsiteInputHelpers,
  } = dependencies;

  const {
    env,
    runtimeEnv,
    runtimeMemory,
    projectRootDir,
    knownHtmlPageFiles,
    knownPrettyPageSlugToFile,
    uiSeoConfig,
    shared,
    platform,
    runtimeSync,
    uiCallbacks,
  } = context;

  const {
    ai: {
      openaiApiBaseUrl,
      openaiModel,
      openaiImageModel,
      anthropicApiBaseUrl,
      anthropicModel,
    },
    websiteGeneration: {
      timeoutMs: websiteGenerationTimeoutMs,
      strictAnthropic: websiteGenerationStrictAnthropic,
      strictHtml: websiteGenerationStrictHtml,
    },
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      stateTable: supabaseStateTable,
      stateKey: supabaseStateKey,
    },
  } = runtimeEnv;

  const {
    recentWebhookEvents,
    recentCallUpdates,
    recentAiCallInsights,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    inMemoryUiStateByScope,
  } = runtimeMemory;

  const {
    normalizeString,
    truncateText,
    clipText,
    escapeHtml,
    parseIntSafe,
    fetchJsonWithTimeout,
    fetchTextWithTimeout,
    fetchBinaryWithTimeout,
    assertWebsitePreviewUrlIsPublic,
    normalizeAbsoluteHttpUrl,
    normalizeWebsitePreviewTargetUrl,
  } = shared;

  const {
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseRowByKeyViaRest,
    fetchSupabaseRowsByStateKeyPrefixViaRest,
    deleteSupabaseRowByStateKeyViaRest,
    upsertSupabaseRowViaRest,
    getOpenAiApiKey,
    getAnthropicApiKey,
    getWebsiteGenerationProvider,
    getWebsiteAnthropicModel,
    getDossierAnthropicModel,
    getAnthropicDossierMaxTokens,
    redactSupabaseUrlForDebug,
    toBooleanSafe,
  } = platform;

  const { persistRuntimeStateToSupabase, ensureRuntimeStateHydratedFromSupabase, runtimeStateSyncState } =
    runtimeSync;

  const {
    resolvePremiumHtmlPageAccess,
    appendDashboardActivity,
    appendSecurityAuditEvent,
    getPageBootstrapData,
    getEffectivePublicBaseUrl,
    resolveLegacyPrettyPageRedirect,
  } = uiCallbacks;

  const websiteInputRuntime = createWebsiteInputHelpersImpl({
    normalizeString,
    truncateText,
  });

  const websiteGenerationRuntime = createWebsiteGenerationHelpersImpl({
    env,
    normalizeString,
    truncateText,
    clipText,
    escapeHtml,
    sanitizeReferenceImages: websiteInputRuntime.sanitizeReferenceImages,
  });

  const aiHelpers = createAiHelpersImpl({
    anthropicModel,
    env,
    normalizeString,
    openAiModel: openaiModel,
    truncateText,
  });

  const uiSeoRuntime = createUiSeoRuntimeImpl(
    buildUiSeoRuntimeOptions({
      uiStateScopePrefix: uiSeoConfig.uiStateScopePrefix,
      inMemoryUiStateByScope,
      isSupabaseConfigured,
      getSupabaseClient,
      supabaseStateTable,
      fetchSupabaseRowByKeyViaRest,
      fetchSupabaseRowsByStateKeyPrefixViaRest,
      deleteSupabaseRowByStateKeyViaRest,
      upsertSupabaseRowViaRest,
      normalizeString,
      truncateText,
      knownHtmlPageFiles,
      normalizeAbsoluteHttpUrl,
      normalizeWebsitePreviewTargetUrl,
      parseIntSafe,
      seoDefaultSiteOrigin: uiSeoConfig.seoDefaultSiteOrigin,
      seoMaxImagesPerPage: uiSeoConfig.seoMaxImagesPerPage,
      seoModelPresets: uiSeoConfig.seoModelPresets,
      seoPageFieldDefs: uiSeoConfig.seoPageFieldDefs,
      toBooleanSafe,
      pagesDir: projectRootDir,
      logger: console,
      knownPrettyPageSlugToFile,
      resolvePremiumHtmlPageAccess,
      getPageBootstrapData,
      appendDashboardActivity,
      appendSecurityAuditEvent,
      recentDashboardActivities,
      recentSecurityAuditEvents,
      supabaseUrl,
      supabaseStateKey,
      supabaseServiceRoleKey,
      redactSupabaseUrlForDebug,
      fetchImpl: fetch,
      getBeforeState: () => ({
        hydrated: runtimeStateSyncState.supabaseStateHydrated,
        lastHydrateError: runtimeStateSyncState.supabaseLastHydrateError || null,
        lastPersistError: runtimeStateSyncState.supabaseLastPersistError || null,
        lastCallUpdatePersistError: runtimeStateSyncState.supabaseLastCallUpdatePersistError || null,
      }),
      persistRuntimeStateToSupabase,
      resetHydrationState: () => {
        runtimeStateSyncState.supabaseStateHydrated = false;
        runtimeStateSyncState.supabaseHydrateRetryNotBeforeMs = 0;
      },
      ensureRuntimeStateHydratedFromSupabase,
      getAfterState: () => ({
        hydrated: runtimeStateSyncState.supabaseStateHydrated,
        lastHydrateError: runtimeStateSyncState.supabaseLastHydrateError || null,
        lastPersistError: runtimeStateSyncState.supabaseLastPersistError || null,
        lastCallUpdatePersistError: runtimeStateSyncState.supabaseLastCallUpdatePersistError || null,
        counts: {
          webhookEvents: recentWebhookEvents.length,
          callUpdates: recentCallUpdates.length,
          aiCallInsights: recentAiCallInsights.length,
          appointments: generatedAgendaAppointments.length,
        },
      }),
      slugifyAutomationText: websiteInputRuntime.slugifyAutomationText,
      resolveLegacyPrettyPageRedirect,
      getPublicBaseUrlFromRequest: getEffectivePublicBaseUrl,
      websiteLinkStateKeyPrefix: `${supabaseStateKey}:website_link:`,
      seoConfigScope: uiSeoConfig.seoConfigScope,
      seoConfigKey: uiSeoConfig.seoConfigKey,
      seoConfigCacheTtlMs: uiSeoConfig.seoConfigCacheTtlMs,
    })
  );

  const aiContentRuntime = createAiContentRuntimeImpl(
    buildAiContentRuntimeOptions({
      normalizeString,
      truncateText,
      parseIntSafe,
      fetchJsonWithTimeout,
      getOpenAiApiKey,
      extractOpenAiTextContent: aiHelpers.extractOpenAiTextContent,
      openAiApiBaseUrl: openaiApiBaseUrl,
      openAiModel: openaiModel,
      clipText,
      escapeHtml,
      env,
      getAnthropicApiKey,
      getWebsiteGenerationProvider,
      getWebsiteAnthropicModel,
      getDossierAnthropicModel,
      getAnthropicDossierMaxTokens,
      fetchTextWithTimeout,
      fetchBinaryWithTimeout,
      extractAnthropicTextContent: aiHelpers.extractAnthropicTextContent,
      parseJsonLoose: aiHelpers.parseJsonLoose,
      assertWebsitePreviewUrlIsPublic,
      normalizeWebsitePreviewTargetUrl,
      extractWebsitePreviewScanFromHtml: uiSeoRuntime.extractWebsitePreviewScanFromHtml,
      buildWebsitePreviewPromptFromScan: websiteGenerationRuntime.buildWebsitePreviewPromptFromScan,
      buildWebsitePreviewBriefFromScan: websiteGenerationRuntime.buildWebsitePreviewBriefFromScan,
      buildWebsitePreviewDownloadFileName:
        websiteGenerationRuntime.buildWebsitePreviewDownloadFileName,
      buildWebsiteGenerationPrompts: websiteGenerationRuntime.buildWebsiteGenerationPrompts,
      ensureHtmlDocument: websiteGenerationRuntime.ensureHtmlDocument,
      ensureStrictAnthropicHtml: websiteGenerationRuntime.ensureStrictAnthropicHtml,
      isLikelyUsableWebsiteHtml: websiteGenerationRuntime.isLikelyUsableWebsiteHtml,
      buildLocalWebsiteBlueprint: websiteGenerationRuntime.buildLocalWebsiteBlueprint,
      buildAnthropicWebsiteHtmlPrompts:
        websiteGenerationRuntime.buildAnthropicWebsiteHtmlPrompts,
      getAnthropicWebsiteStageEffort: websiteGenerationRuntime.getAnthropicWebsiteStageEffort,
      getAnthropicWebsiteStageMaxTokens:
        websiteGenerationRuntime.getAnthropicWebsiteStageMaxTokens,
      supportsAnthropicAdaptiveThinking:
        websiteGenerationRuntime.supportsAnthropicAdaptiveThinking,
      sanitizeReferenceImages: websiteInputRuntime.sanitizeReferenceImages,
      parseImageDataUrl: websiteInputRuntime.parseImageDataUrl,
      estimateOpenAiUsageCost: aiHelpers.estimateOpenAiUsageCost,
      estimateOpenAiTextCost: aiHelpers.estimateOpenAiTextCost,
      estimateAnthropicUsageCost: aiHelpers.estimateAnthropicUsageCost,
      estimateAnthropicTextCost: aiHelpers.estimateAnthropicTextCost,
      openAiImageModel: openaiImageModel,
      anthropicApiBaseUrl: anthropicApiBaseUrl,
      anthropicModel: anthropicModel,
      websiteGenerationTimeoutMs,
      websiteGenerationStrictAnthropic,
      websiteGenerationStrictHtml,
    })
  );

  return {
    aiContentRuntime,
    aiHelpers,
    uiSeoRuntime,
    websiteGenerationRuntime,
    websiteInputRuntime,
  };
}

module.exports = {
  createServerAppUiContentRuntime,
};

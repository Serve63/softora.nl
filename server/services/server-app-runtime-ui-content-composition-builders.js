const {
  buildServerAppUiContentRuntimeContext,
} = require('./server-app-runtime-composition-options');

function buildServerAppUiContentRuntimeCompositionContext({
  env,
  runtimeEnv,
  runtimeMemory,
  projectRootDir,
  bootstrapState,
  platformRuntime,
  securityRuntime,
  runtimeSyncRuntime,
  getPageBootstrapData,
  getEffectivePublicBaseUrl,
  resolveLegacyPrettyPageRedirect,
  shared,
}) {
  return buildServerAppUiContentRuntimeContext({
    env,
    runtimeEnv,
    runtimeMemory,
    projectRootDir,
    knownHtmlPageFiles: bootstrapState.knownHtmlPageFiles,
    knownPrettyPageSlugToFile: bootstrapState.knownPrettyPageSlugToFile,
    uiSeoConfig: {
      uiStateScopePrefix: bootstrapState.UI_STATE_SCOPE_PREFIX,
      seoDefaultSiteOrigin: bootstrapState.SEO_DEFAULT_SITE_ORIGIN,
      seoMaxImagesPerPage: bootstrapState.SEO_MAX_IMAGES_PER_PAGE,
      seoModelPresets: bootstrapState.SEO_MODEL_PRESETS,
      seoPageFieldDefs: bootstrapState.SEO_PAGE_FIELD_DEFS,
      seoConfigScope: bootstrapState.SEO_UI_STATE_SCOPE,
      seoConfigKey: bootstrapState.SEO_UI_STATE_CONFIG_KEY,
      seoConfigCacheTtlMs: bootstrapState.SEO_CONFIG_CACHE_TTL_MS,
    },
    shared: {
      normalizeString: shared.normalizeString,
      truncateText: shared.truncateText,
      clipText: shared.clipText,
      escapeHtml: shared.escapeHtml,
      parseIntSafe: shared.parseIntSafe,
      fetchJsonWithTimeout: shared.fetchJsonWithTimeout,
      fetchTextWithTimeout: shared.fetchTextWithTimeout,
      assertWebsitePreviewUrlIsPublic: shared.assertWebsitePreviewUrlIsPublic,
      normalizeAbsoluteHttpUrl: shared.normalizeAbsoluteHttpUrl,
      normalizeWebsitePreviewTargetUrl: shared.normalizeWebsitePreviewTargetUrl,
    },
    platform: {
      isSupabaseConfigured: platformRuntime.isSupabaseConfigured,
      getSupabaseClient: platformRuntime.getSupabaseClient,
      fetchSupabaseRowByKeyViaRest: platformRuntime.fetchSupabaseRowByKeyViaRest,
      upsertSupabaseRowViaRest: platformRuntime.upsertSupabaseRowViaRest,
      getOpenAiApiKey: platformRuntime.getOpenAiApiKey,
      getAnthropicApiKey: platformRuntime.getAnthropicApiKey,
      getWebsiteGenerationProvider: platformRuntime.getWebsiteGenerationProvider,
      getWebsiteAnthropicModel: platformRuntime.getWebsiteAnthropicModel,
      getDossierAnthropicModel: platformRuntime.getDossierAnthropicModel,
      getAnthropicDossierMaxTokens: platformRuntime.getAnthropicDossierMaxTokens,
      redactSupabaseUrlForDebug: platformRuntime.redactSupabaseUrlForDebug,
      toBooleanSafe: platformRuntime.toBooleanSafe,
    },
    runtimeSync: {
      persistRuntimeStateToSupabase: runtimeSyncRuntime.persistRuntimeStateToSupabase,
      ensureRuntimeStateHydratedFromSupabase:
        runtimeSyncRuntime.ensureRuntimeStateHydratedFromSupabase,
      runtimeStateSyncState: runtimeMemory.runtimeStateSyncState,
    },
    uiCallbacks: {
      resolvePremiumHtmlPageAccess: securityRuntime.resolvePremiumHtmlPageAccess,
      appendDashboardActivity: securityRuntime.appendDashboardActivity,
      appendSecurityAuditEvent: securityRuntime.appendSecurityAuditEvent,
      getPageBootstrapData,
      getEffectivePublicBaseUrl,
      resolveLegacyPrettyPageRedirect,
    },
  });
}

module.exports = {
  buildServerAppUiContentRuntimeCompositionContext,
};

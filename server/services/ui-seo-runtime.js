const { createUiStateStore } = require('./ui-state');
const { createSeoCore } = require('./seo-core');
const { createSeoConfigStore } = require('./seo-config-store');
const { createHtmlPageCoordinator } = require('./html-pages');
const { createSeoReadCoordinator } = require('./seo-read');
const { createSeoWriteCoordinator } = require('./seo-write');
const { createRuntimeOpsCoordinator } = require('./runtime-ops');
const { createRuntimeDebugOpsCoordinator } = require('./runtime-debug-ops');
const { createWebsiteLinkCoordinator } = require('./website-links');

function createUiSeoRuntime(deps = {}) {
  const {
    uiStateScopePrefix,
    inMemoryUiStateByScope,
    isSupabaseConfigured,
    getSupabaseClient,
    supabaseStateTable,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    normalizeString,
    truncateText,
    knownHtmlPageFiles,
    normalizeAbsoluteHttpUrl,
    normalizeWebsitePreviewTargetUrl,
    parseIntSafe,
    seoDefaultSiteOrigin,
    seoMaxImagesPerPage,
    seoModelPresets,
    seoPageFieldDefs,
    toBooleanSafe,
    pagesDir,
    logger = console,
    knownPrettyPageSlugToFile,
    resolvePremiumHtmlPageAccess,
    getPageBootstrapData,
    appendDashboardActivity,
    appendSecurityAuditEvent,
    normalizeUiStateScopeInput,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    supabaseUrl,
    supabaseStateKey,
    supabaseServiceRoleKey,
    redactSupabaseUrlForDebug,
    fetchImpl,
    getBeforeState,
    persistRuntimeStateToSupabase,
    resetHydrationState,
    ensureRuntimeStateHydratedFromSupabase,
    getAfterState,
    slugifyAutomationText,
    resolveLegacyPrettyPageRedirect,
    getPublicBaseUrlFromRequest,
    websiteLinkStateKeyPrefix,
    seoConfigScope,
    seoConfigKey,
    seoConfigCacheTtlMs,
  } = deps;

  const uiStateStore = createUiStateStore({
    uiStateScopePrefix,
    inMemoryUiStateByScope,
    isSupabaseConfigured,
    getSupabaseClient,
    supabaseStateTable,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    normalizeString,
    truncateText,
    logger,
  });

  const { getUiStateValues, normalizeUiStateScope, sanitizeUiStateValues, setUiStateValues } =
    uiStateStore;

  const seoCore = createSeoCore({
    knownHtmlPageFiles,
    normalizeAbsoluteHttpUrl,
    normalizeString,
    normalizeWebsitePreviewTargetUrl,
    parseIntSafe,
    seoDefaultSiteOrigin,
    seoMaxImagesPerPage,
    seoModelPresets,
    seoPageFieldDefs,
    toBooleanSafe,
    truncateText,
  });

  const {
    applySeoAuditSuggestionsToConfig,
    applySeoOverridesToHtml,
    buildSeoPageAuditEntry,
    extractImageEntriesFromHtml,
    extractSeoSourceFromHtml,
    extractWebsitePreviewScanFromHtml,
    getDefaultSeoConfig,
    getSeoEditableHtmlFiles,
    getSeoModelPresetOptions,
    mergeSeoSourceWithOverrides,
    normalizeSeoAutomationSettings,
    normalizeSeoConfig,
    normalizeSeoImageOverridePatch,
    normalizeSeoModelPreset,
    normalizeSeoPageOverridePatch,
    normalizeSeoStoredImageOverrides,
    normalizeSeoStoredPageOverrides,
    sanitizeKnownHtmlFileName,
  } = seoCore;

  const { getSeoConfigCached, persistSeoConfig } = createSeoConfigStore({
    getUiStateValues,
    setUiStateValues,
    normalizeString,
    getDefaultSeoConfig,
    normalizeSeoConfig,
    scope: seoConfigScope,
    configKey: seoConfigKey,
    cacheTtlMs: seoConfigCacheTtlMs,
    logger,
  });

  const { readHtmlPageContent, resolveSeoPageFileFromRequest, sendSeoManagedHtmlPageResponse } =
    createHtmlPageCoordinator({
      pagesDir,
      logger,
      sanitizeKnownHtmlFileName,
      normalizeString,
      knownPrettyPageSlugToFile,
      resolvePremiumHtmlPageAccess,
      getSeoConfigCached,
      applySeoOverridesToHtml,
      getPageBootstrapData,
    });

  const seoReadCoordinator = createSeoReadCoordinator({
    logger,
    getSeoConfigCached,
    normalizeSeoConfig,
    getSeoEditableHtmlFiles,
    readHtmlPageContent,
    extractSeoSourceFromHtml,
    normalizeSeoStoredPageOverrides,
    normalizeSeoStoredImageOverrides,
    mergeSeoSourceWithOverrides,
    extractImageEntriesFromHtml,
    normalizeString,
    resolveSeoPageFileFromRequest,
    buildSeoPageAuditEntry,
    getSeoModelPresetOptions,
    normalizeSeoAutomationSettings,
  });

  const seoWriteCoordinator = createSeoWriteCoordinator({
    logger,
    resolveSeoPageFileFromRequest,
    normalizeSeoPageOverridePatch,
    normalizeSeoImageOverridePatch,
    getSeoConfigCached,
    normalizeSeoConfig,
    seoPageFieldDefs,
    normalizeString,
    persistSeoConfig,
    appendDashboardActivity,
    normalizeSeoModelPreset,
    applySeoAuditSuggestionsToConfig,
    seoReadCoordinator,
    normalizeSeoAutomationSettings,
    getSeoModelPresetOptions,
  });

  const runtimeOpsCoordinator = createRuntimeOpsCoordinator({
    parseIntSafe,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    normalizeString,
    appendDashboardActivity,
    appendSecurityAuditEvent,
    normalizeUiStateScope: normalizeUiStateScopeInput || normalizeUiStateScope,
    getUiStateValues,
    sanitizeUiStateValues,
    setUiStateValues,
  });

  const runtimeDebugOpsCoordinator = createRuntimeDebugOpsCoordinator({
    isSupabaseConfigured,
    supabaseUrl,
    supabaseStateTable,
    supabaseStateKey,
    supabaseServiceRoleKey,
    redactSupabaseUrlForDebug,
    truncateText,
    fetchImpl,
    getBeforeState,
    persistRuntimeStateToSupabase,
    resetHydrationState,
    ensureRuntimeStateHydratedFromSupabase,
    getAfterState,
  });

  const websiteLinkCoordinator = createWebsiteLinkCoordinator({
    logger,
    normalizeString,
    truncateText,
    slugifyAutomationText,
    isSupabaseConfigured,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    websiteLinkStateKeyPrefix,
    knownPrettyPageSlugToFile,
    resolveLegacyPrettyPageRedirect,
    getPublicBaseUrlFromRequest,
    appendDashboardActivity,
  });

  return {
    getUiStateValues,
    getSeoConfigCached,
    extractWebsitePreviewScanFromHtml,
    normalizeUiStateScope,
    persistSeoConfig,
    sanitizeUiStateValues,
    sendSeoManagedHtmlPageResponse,
    seoReadCoordinator,
    seoWriteCoordinator,
    setUiStateValues,
    runtimeOpsCoordinator,
    runtimeDebugOpsCoordinator,
    websiteLinkCoordinator,
  };
}

module.exports = {
  createUiSeoRuntime,
};

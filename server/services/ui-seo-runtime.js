const { createUiStateStore } = require('./ui-state');
const { createSeoCore } = require('./seo-core');
const { createSeoConfigStore } = require('./seo-config-store');
const { createHtmlPageCoordinator } = require('./html-pages');
const { createSeoReadCoordinator } = require('./seo-read');
const { createSeoWriteCoordinator } = require('./seo-write');
const { createRuntimeOpsCoordinator } = require('./runtime-ops');
const { createRuntimeDebugOpsCoordinator } = require('./runtime-debug-ops');
const { createWebsiteLinkCoordinator } = require('./website-links');
const { createWebsitePreviewLibraryCoordinator } = require('./website-preview-library');
const { createSoftoraDataOpsUiStateBridge } = require('./data-ops-ui-state-bridge');
const { createSoftoraDataOpsStore } = require('./data-ops-store');
const { createDataOpsHealthReporter } = require('./data-ops-health');

const COLDMAIL_CRITICAL_UI_STATE_READ_TIMEOUT_MS_BY_SCOPE = Object.freeze({
  premium_coldmail_autopilot: 8000,
  premium_coldmail_send_guard: 10000,
  premium_coldmailing_settings: 8000,
});
const COLDMAIL_CRITICAL_UI_STATE_READ_OPTIONS_BY_SCOPE = Object.freeze(
  Object.fromEntries(
    Object.keys(COLDMAIL_CRITICAL_UI_STATE_READ_TIMEOUT_MS_BY_SCOPE).map((scope) => [
      scope,
      Object.freeze({
        preferSupabaseRestRead: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
      }),
    ])
  )
);

function createUiSeoRuntime(deps = {}) {
  const {
    uiStateScopePrefix,
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
    dataOpsUiStateEnabled = true,
    dataOpsReadQueryTimeoutMs = 6000,
    dataOpsUiStateReadTimeoutMs = 2500,
    dataOpsUiStateReadTimeoutMsByScope = Object.freeze({
      premium_customers_database: 8000,
      premium_database_photos: 12000,
      premium_coldmail_send_guard: 12000,
    }),
    uiStateReadTimeoutMsByScope = Object.freeze({
      seo: 350,
      premium_database_photos: 8000,
      ...COLDMAIL_CRITICAL_UI_STATE_READ_TIMEOUT_MS_BY_SCOPE,
    }),
    uiStateReadOptionsByScope = COLDMAIL_CRITICAL_UI_STATE_READ_OPTIONS_BY_SCOPE,
    uiStateMemoryFallbackScopes = Object.freeze([
      'premium_customers_database',
      'premium_active_orders',
      'premium_database_photos',
    ]),
  } = deps;

  const uiStateStore = createUiStateStore({
    uiStateScopePrefix,
    inMemoryUiStateByScope,
    isSupabaseConfigured,
    getSupabaseClient,
    supabaseStateTable,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    uiStateReadTimeoutMsByScope,
    uiStateReadOptionsByScope,
    uiStateMemoryFallbackScopes,
    normalizeString,
    truncateText,
    logger,
  });

  const { getUiStateValues, normalizeUiStateScope, sanitizeUiStateValues, setUiStateValues } =
    uiStateStore;

  const dataOpsStore = createSoftoraDataOpsStore({
    isSupabaseConfigured,
    getSupabaseClient,
    dataOpsReadQueryTimeoutMs,
    logger,
  });
  const dataOpsUiStateBridge = createSoftoraDataOpsUiStateBridge({
    enabled: dataOpsUiStateEnabled,
    store: dataOpsStore,
    legacyContactMergeEnabled: true,
    legacyReadTimeoutMs: 2500,
    logger,
  });
  const dataOpsHealthReporter = createDataOpsHealthReporter({
    fetchSupabaseRowsByStateKeyPrefixViaRest,
    dataOpsStore,
  });

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
    dataOpsUiStateBridge,
    dataOpsUiStateReadTimeoutMs,
    dataOpsUiStateReadTimeoutMsByScope,
    logger,
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
    dataOpsHealthReporter,
  });

  const websitePreviewLibraryCoordinator = createWebsitePreviewLibraryCoordinator({
    logger,
    normalizeString,
    truncateText,
    slugifyAutomationText,
    isSupabaseConfigured,
    fetchSupabaseRowsByStateKeyPrefixViaRest,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    deleteSupabaseRowByStateKeyViaRest,
    supabaseStateKey,
  });

  const websiteLinkCoordinator = createWebsiteLinkCoordinator({
    logger,
    normalizeString,
    truncateText,
    slugifyAutomationText,
    isSupabaseConfigured,
    fetchSupabaseRowsByStateKeyPrefixViaRest,
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
    dataOpsStore,
    dataOpsHealthReporter,
    dataOpsUiStateBridge,
    websiteLinkCoordinator,
    websitePreviewLibraryCoordinator,
  };
}

module.exports = {
  createUiSeoRuntime,
};

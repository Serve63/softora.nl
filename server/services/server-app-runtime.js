const path = require('path');
const express = require('express');
const { FEATURE_FLAGS, getPublicFeatureFlags } = require('../config/feature-flags');
const {
  resolveLegacyPrettyPageRedirect,
  toPrettyPagePathFromHtmlFile,
} = require('../config/page-routing');
const { timingSafeEqualStrings } = require('../security/crypto-utils');
const {
  assertWebsitePreviewUrlIsPublic,
  appendQueryParamsToUrl,
  getEffectivePublicBaseUrl: resolveEffectivePublicBaseUrl,
  normalizeAbsoluteHttpUrl,
  normalizeWebsitePreviewTargetUrl,
} = require('../security/public-url');
const {
  getClientIpFromRequest,
  getRequestOriginFromHeaders,
  getRequestPathname,
  isSecureHttpRequest,
  normalizeIpAddress,
  normalizeOrigin,
} = require('../security/request-context');
const routeManifest = require('../routes/manifest');
const { resolveCallUpdateTimestamp } = require('./call-update-timestamp');
const {
  normalizeLeadLikePhoneKey: normalizeLeadLikePhoneKeyForCallUpdates,
} = require('./lead-identity');
const {
  fetchBinaryWithTimeout,
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
} = require('./runtime-fetch');
const {
  clipText,
  escapeHtml,
  normalizeColdcallingStack,
  normalizeNlPhoneToE164,
  normalizeString,
  parseIntSafe,
  parseNumberSafe,
  truncateText,
} = require('./runtime-primitives');
const {
  createServerAppFoundationRuntime,
} = require('./server-app-runtime-foundation');
const {
  createServerAppRuntimeBootstrap,
} = require('./server-app-runtime-bootstrap');
const {
  assembleServerAppRuntimeDomains,
} = require('./server-app-runtime-domain-assembly');
const {
  primeServerAppRuntime,
  startServerAppRuntime,
} = require('./server-app-runtime-startup');
require('dotenv').config();
const { version: APP_VERSION = '0.0.0' } = require('../../package.json');
const PROJECT_ROOT_DIR = path.resolve(__dirname, '../..');
const {
  app,
  runtimeEnv,
  runtimeMemory,
  isServerlessRuntime,
  envConfig,
  bootstrapState,
} = createServerAppRuntimeBootstrap({
  env: process.env,
  expressImpl: express,
  projectRootDir: PROJECT_ROOT_DIR,
  logger: console,
});

const {
  PORT,
  PUBLIC_BASE_URL,
  SUPABASE_STATE_TABLE,
  SUPABASE_STATE_KEY,
} = envConfig;

const {
  PREMIUM_PUBLIC_HTML_FILES,
  NOINDEX_HEADER_VALUE,
} = bootstrapState;

function getEffectivePublicBaseUrl(req = null, overrideValue = '') {
  return resolveEffectivePublicBaseUrl(req, overrideValue, PUBLIC_BASE_URL);
}

const normalizePremiumSessionEmail = (value) => {
  return normalizeString(value).toLowerCase();
};

const runtimeCallbackRefs = {
  extractRetellTranscriptText: () => '',
  getLatestCallUpdateByCallId: () => null,
};

const {
  platformRuntime,
  securityRuntime,
  upsertRecentCallUpdate,
  queueRuntimeStatePersist,
  buildRuntimeStateSnapshotPayload,
  bindRuntimeSyncRuntime,
} = createServerAppFoundationRuntime({
  env: process.env,
  runtimeEnv,
  runtimeMemory,
  premiumPublicHtmlFiles: PREMIUM_PUBLIC_HTML_FILES,
  noindexHeaderValue: NOINDEX_HEADER_VALUE,
  foundationCallbacks: {
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    normalizeNlPhoneToE164,
    normalizeLeadLikePhoneKey: normalizeLeadLikePhoneKeyForCallUpdates,
    normalizePremiumSessionEmail,
    extractRetellTranscriptText: (...args) =>
      runtimeCallbackRefs.extractRetellTranscriptText(...args),
    getLatestCallUpdateByCallId: (...args) =>
      runtimeCallbackRefs.getLatestCallUpdateByCallId(...args),
  },
  shared: {
    normalizeString,
    truncateText,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    fetchJsonWithTimeout,
    timingSafeEqualStrings,
    normalizeIpAddress,
    normalizeOrigin,
    getClientIpFromRequest,
    getRequestOriginFromHeaders,
    getRequestPathname,
    isSecureHttpRequest,
    escapeHtml,
  },
});

const {
  getColdcallingProvider,
  getMissingEnvVars,
  isSupabaseConfigured,
} = platformRuntime;

const {
  buildRuntimeBackupForOps,
  buildRuntimeStateSnapshotPayloadWithLimits,
  ensureRuntimeStateHydratedFromSupabase,
  seedDemoConfirmationTaskForUiTesting,
} = assembleServerAppRuntimeDomains({
  app,
  env: process.env,
  expressImpl: express,
  runtimeEnv,
  runtimeMemory,
  envConfig,
  bootstrapState,
  appVersion: APP_VERSION,
  routeManifest,
  featureFlags: FEATURE_FLAGS,
  getPublicFeatureFlags,
  isServerlessRuntime,
  projectRootDir: PROJECT_ROOT_DIR,
  platformRuntime,
  securityRuntime,
  bindRuntimeSyncRuntime,
  upsertRecentCallUpdate,
  queueRuntimeStatePersist,
  buildRuntimeStateSnapshotPayload,
  getEffectivePublicBaseUrl,
  normalizePremiumSessionEmail,
  resolveCallUpdateTimestamp,
  normalizeAbsoluteHttpUrl,
  appendQueryParamsToUrl,
  resolveLegacyPrettyPageRedirect,
  toPrettyPagePathFromHtmlFile,
  runtimeCallbackRefs,
  shared: {
    normalizeString,
    truncateText,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    fetchBinaryWithTimeout,
    fetchJsonWithTimeout,
    fetchTextWithTimeout,
    clipText,
    timingSafeEqualStrings,
    getClientIpFromRequest,
    getRequestOriginFromHeaders,
    getRequestPathname,
    isSecureHttpRequest,
    escapeHtml,
    assertWebsitePreviewUrlIsPublic,
    normalizeWebsitePreviewTargetUrl,
  },
});

// In serverless (zoals Vercel) wordt startServer() niet aangeroepen, dus hydrate
// de runtime ook bij module-load.
primeServerAppRuntime({
  ensureRuntimeStateHydratedFromSupabase,
});

function startServer() {
  startServerAppRuntime({
    app,
    port: PORT,
    getColdcallingProvider,
    getMissingEnvVars,
    isSupabaseConfigured,
    supabaseStateTable: SUPABASE_STATE_TABLE,
    supabaseStateKey: SUPABASE_STATE_KEY,
    seedDemoConfirmationTaskForUiTesting,
    ensureRuntimeStateHydratedFromSupabase,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });
}

module.exports = {
  app,
  isServerlessRuntime,
  normalizeNlPhoneToE164,
  startServer,
  buildRuntimeStateSnapshotPayloadWithLimits,
  buildRuntimeBackupForOps,
};

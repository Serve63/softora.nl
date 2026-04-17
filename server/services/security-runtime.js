const { createPremiumUsersStore } = require('../../lib/premium-users-store');
const {
  createPremiumApiAccessGuard,
  createPremiumAuthStateManager,
} = require('../security/premium-auth');
const { createRequestSecurityContext } = require('../security/request-context');
const { createRuntimeDebugAccessGuard } = require('../security/runtime-debug');
const { createRuntimeEventStore } = require('../security/runtime-events');
const { createPremiumHtmlPageAccessController } = require('../security/premium-pages');
const { createLeadOwnerService } = require('./lead-owners');
const { createPremiumAuthRuntime } = require('./premium-auth-runtime');

function createSecurityRuntime(deps = {}) {
  const {
    premiumLoginEmails,
    premiumLoginPassword,
    premiumLoginPasswordHash,
    premiumSessionSecret,
    premiumAuthUsersRowKey,
    premiumAuthUsersVersion,
    supabaseStateTable,
    normalizeString,
    truncateText,
    timingSafeEqualStrings,
    normalizePremiumSessionEmail,
    isSupabaseConfigured,
    getSupabaseClient,
    fetchSupabaseRowByKeyViaRest,
    upsertSupabaseRowViaRest,
    leadOwnerAssignmentsByCallId,
    getNextLeadOwnerRotationIndex,
    setNextLeadOwnerRotationIndex,
    queueRuntimeStatePersist,
    mfaTotpSecret,
    sessionCookieName,
    premiumSessionTtlHours,
    isProduction,
    isSecureHttpRequest,
    getRequestPathname,
    enforceSameOriginRequests,
    getEffectivePublicBaseUrl,
    premiumAdminIpAllowlist,
    normalizeIpAddress,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    normalizeOrigin,
    getClientIpFromRequest,
    getRequestOriginFromHeaders,
    premiumPublicHtmlFiles,
    noindexHeaderValue,
    enableRuntimeDebugRoutes,
  } = deps;

  const premiumUsersStore = createPremiumUsersStore({
    config: {
      premiumLoginEmails,
      premiumLoginPassword,
      premiumLoginPasswordHash,
      premiumSessionSecret,
      premiumAuthUsersRowKey,
      premiumAuthUsersVersion,
      supabaseStateTable,
    },
    deps: {
      normalizeString,
      truncateText,
      timingSafeEqualStrings,
      normalizePremiumSessionEmail,
      isSupabaseConfigured,
      getSupabaseClient,
      fetchSupabaseRowByKeyViaRest,
      upsertSupabaseRowViaRest,
    },
  });

  const { buildLeadOwnerFields, normalizeLeadOwnerRecord } = createLeadOwnerService({
    premiumUsersStore,
    normalizeString,
    truncateText,
    normalizePremiumSessionEmail,
    leadOwnerAssignmentsByCallId,
    getNextLeadOwnerRotationIndex,
    setNextLeadOwnerRotationIndex,
    queueRuntimeStatePersist,
  });

  const isPremiumAuthConfigured = () => premiumUsersStore.hasConfiguredUsers();

  const {
    isPremiumMfaConfigured,
    isPremiumMfaCodeValid,
    createPremiumSessionToken,
    readPremiumSessionTokenFromRequest,
    verifyPremiumSessionToken,
    clearPremiumSessionCookie,
    setPremiumSessionCookie,
  } = createPremiumAuthRuntime({
    mfaTotpSecret,
    sessionSecret: premiumSessionSecret,
    sessionCookieName,
    premiumSessionTtlHours,
    isProduction,
    isPremiumAuthConfigured,
    isSecureHttpRequest,
    normalizeString,
    truncateText,
    normalizePremiumSessionEmail,
  });

  const {
    buildPremiumAuthSessionPayload,
    getPremiumAuthState,
    getResolvedPremiumAuthState,
    getSafePremiumRedirectPath,
    isPremiumPublicApiRequest,
  } = createPremiumAuthStateManager({
    sessionSecret: premiumSessionSecret,
    normalizeString,
    truncateText,
    normalizeSessionEmail: normalizePremiumSessionEmail,
    readSessionTokenFromRequest: readPremiumSessionTokenFromRequest,
    verifySessionToken: verifyPremiumSessionToken,
    premiumUsersStore,
    isPremiumMfaConfigured,
    getRequestPathname,
  });

  const premiumAdminAllowedIpSet = new Set(
    String(premiumAdminIpAllowlist || '')
      .split(/[\s,]+/)
      .map((value) => normalizeIpAddress(value))
      .filter(Boolean)
  );

  const { getStateChangingApiProtectionDecision, isPremiumAdminIpAllowed } =
    createRequestSecurityContext({
      enforceSameOriginRequests,
      getEffectivePublicBaseUrl,
      premiumAdminAllowedIpSet,
    });

  const runtimeEventStore = createRuntimeEventStore({
    recentDashboardActivities,
    recentSecurityAuditEvents,
    queueRuntimeStatePersist,
    normalizeString,
    truncateText,
    normalizePremiumSessionEmail,
    normalizeIpAddress,
    normalizeOrigin,
  });

  const { appendDashboardActivity, appendSecurityAuditEvent } = runtimeEventStore;

  const { requirePremiumAdminApiAccess, requirePremiumApiAccess } = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest,
    getResolvedPremiumAuthState,
    isPremiumAdminIpAllowed,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
    clearPremiumSessionCookie,
  });

  const { resolvePremiumHtmlPageAccess } = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles,
    noindexHeaderValue,
    getResolvedPremiumAuthState,
    getSafePremiumRedirectPath,
    clearPremiumSessionCookie,
    isPremiumAdminIpAllowed,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestOriginFromHeaders,
  });

  const { requireRuntimeDebugAccess } = createRuntimeDebugAccessGuard({
    isProduction,
    enableRuntimeDebugRoutes,
    getResolvedPremiumAuthState,
    getPremiumAuthState,
    isPremiumAdminIpAllowed,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
    clearPremiumSessionCookie,
  });

  return {
    appendDashboardActivity,
    appendSecurityAuditEvent,
    buildLeadOwnerFields,
    buildPremiumAuthSessionPayload,
    clearPremiumSessionCookie,
    createPremiumSessionToken,
    getPremiumAuthState,
    getResolvedPremiumAuthState,
    getSafePremiumRedirectPath,
    getStateChangingApiProtectionDecision,
    isPremiumAuthConfigured,
    isPremiumMfaCodeValid,
    isPremiumMfaConfigured,
    isPremiumPublicApiRequest,
    isPremiumAdminIpAllowed,
    normalizeLeadOwnerRecord,
    premiumUsersStore,
    readPremiumSessionTokenFromRequest,
    requirePremiumAdminApiAccess,
    requirePremiumApiAccess,
    requireRuntimeDebugAccess,
    resolvePremiumHtmlPageAccess,
    setPremiumSessionCookie,
    verifyPremiumSessionToken,
  };
}

module.exports = {
  createSecurityRuntime,
};

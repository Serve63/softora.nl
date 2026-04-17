const { registerPremiumAuthRoutes } = require('../routes/premium-auth');
const { registerPremiumUserManagementRoutes } = require('../routes/premium-users');
const { createPremiumAuthRouteCoordinator } = require('./premium-auth');
const { createPremiumUserManagementCoordinator } = require('./premium-users');

function createPremiumRouteRuntime(deps = {}) {
  const {
    app,
    premiumLoginRateLimiter,
    requirePremiumApiAccess,
    requirePremiumAdminApiAccess,
    premiumUsersStore,
    buildPremiumAuthSessionPayload,
    normalizePremiumSessionEmail,
    normalizeString,
    truncateText,
    isPremiumMfaConfigured,
    isPremiumMfaCodeValid,
    getSafePremiumRedirectPath,
    getResolvedPremiumAuthState,
    isPremiumAdminIpAllowed,
    createPremiumSessionToken,
    setPremiumSessionCookie,
    clearPremiumSessionCookie,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
    sessionSecret,
    premiumSessionTtlHours,
    premiumSessionRememberTtlDays,
  } = deps;

  const premiumAuthRouteCoordinator = createPremiumAuthRouteCoordinator({
    sessionSecret,
    premiumSessionTtlHours,
    premiumSessionRememberTtlDays,
    premiumUsersStore,
    normalizePremiumSessionEmail,
    normalizeString,
    isPremiumMfaConfigured,
    isPremiumMfaCodeValid,
    getSafePremiumRedirectPath,
    getResolvedPremiumAuthState,
    buildPremiumAuthSessionPayload,
    isPremiumAdminIpAllowed,
    createPremiumSessionToken,
    setPremiumSessionCookie,
    clearPremiumSessionCookie,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
  });

  registerPremiumAuthRoutes(app, {
    coordinator: premiumAuthRouteCoordinator,
    premiumLoginRateLimiter,
  });

  app.use('/api', requirePremiumApiAccess);

  const premiumUserManagementCoordinator = createPremiumUserManagementCoordinator({
    premiumUsersStore,
    buildPremiumAuthSessionPayload,
    normalizeString,
    truncateText,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
  });

  registerPremiumUserManagementRoutes(app, {
    coordinator: premiumUserManagementCoordinator,
    requirePremiumAdminApiAccess,
  });
}

module.exports = {
  createPremiumRouteRuntime,
};

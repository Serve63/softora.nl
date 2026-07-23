const { registerPremiumAuthRoutes } = require('../routes/premium-auth');
const { registerPremiumUserManagementRoutes } = require('../routes/premium-users');
const { registerLiveMomentumAccessRoutes } = require('../routes/live-momentum-access');
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
    agendaAppPin,
    agendaAppPinHash,
    agendaAppServeEmail,
    agendaAppMartijnEmail,
    agendaAppSessionTtlDays,
    grantLiveMomentumAccess,
  } = deps;

  const premiumAuthRouteCoordinator = createPremiumAuthRouteCoordinator({
    sessionSecret,
    premiumSessionTtlHours,
    premiumSessionRememberTtlDays,
    agendaAppPin,
    agendaAppPinHash,
    agendaAppServeEmail,
    agendaAppMartijnEmail,
    agendaAppSessionTtlDays,
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

  registerLiveMomentumAccessRoutes(app, {
    premiumLoginRateLimiter,
    requirePremiumAdminApiAccess,
    grantLiveMomentumAccess,
    appendSecurityAuditEvent,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
  });

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

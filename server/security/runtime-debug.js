function createRuntimeDebugAccessGuard(options = {}) {
  const {
    isProduction = false,
    enableRuntimeDebugRoutes = false,
    getPremiumAuthState = () => ({ email: '' }),
    isPremiumAdminIpAllowed = () => true,
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/',
    getRequestOriginFromHeaders = () => '',
  } = options;

  function isRuntimeDebugRouteEnabled() {
    return !isProduction || enableRuntimeDebugRoutes;
  }

  function requireRuntimeDebugAccess(req, res, next) {
    if (!isRuntimeDebugRouteEnabled()) {
      appendSecurityAuditEvent(
        {
          type: 'debug_route_blocked',
          severity: 'warning',
          success: false,
          email: getPremiumAuthState(req)?.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Runtime debug route geblokkeerd in productie.',
        },
        'security_debug_route_blocked'
      );
      return res.status(404).json({ ok: false, error: 'Niet gevonden' });
    }

    if (!isPremiumAdminIpAllowed(req)) {
      appendSecurityAuditEvent(
        {
          type: 'admin_ip_blocked',
          severity: 'warning',
          success: false,
          email: getPremiumAuthState(req)?.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Runtime debug route geweigerd door admin IP allowlist.',
        },
        'security_admin_ip_blocked'
      );
      return res.status(403).json({ ok: false, error: 'Toegang geweigerd.' });
    }

    return next();
  }

  return {
    isRuntimeDebugRouteEnabled,
    requireRuntimeDebugAccess,
  };
}

module.exports = {
  createRuntimeDebugAccessGuard,
};

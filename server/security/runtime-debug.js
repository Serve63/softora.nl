function createRuntimeDebugAccessGuard(options = {}) {
  const {
    isProduction = false,
    enableRuntimeDebugRoutes = false,
    getResolvedPremiumAuthState = async () => ({
      configured: false,
      authenticated: false,
      expired: false,
      revoked: false,
      isAdmin: false,
      email: '',
    }),
    getPremiumAuthState = () => ({ email: '' }),
    isPremiumAdminIpAllowed = () => true,
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/',
    getRequestOriginFromHeaders = () => '',
    clearPremiumSessionCookie = () => {},
  } = options;

  function isRuntimeDebugRouteEnabled() {
    return !isProduction || enableRuntimeDebugRoutes;
  }

  async function requireRuntimeDebugAccess(req, res, next) {
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

    const authState = await getResolvedPremiumAuthState(req);
    res.setHeader('Cache-Control', 'no-store, private');

    if (!authState.configured) {
      return res.status(503).json({
        ok: false,
        error:
          'Premium auth is nog niet volledig via Supabase geconfigureerd op de server. Voeg eerst minimaal één premium gebruiker toe in Supabase en zet PREMIUM_SESSION_SECRET.',
      });
    }

    if (!authState.authenticated) {
      if (authState.expired || authState.revoked) {
        clearPremiumSessionCookie(req, res);
      }
      return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
    }

    if (!authState.isAdmin) {
      appendSecurityAuditEvent(
        {
          type: 'debug_admin_required',
          severity: 'warning',
          success: false,
          email: authState.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: req.get('user-agent'),
          detail: 'Runtime debug route geweigerd voor niet-admin account.',
        },
        'security_debug_admin_required'
      );
      return res.status(403).json({ ok: false, error: 'Alleen Full Acces-accounts hebben toegang.' });
    }

    if (!isPremiumAdminIpAllowed(req)) {
      appendSecurityAuditEvent(
        {
          type: 'admin_ip_blocked',
          severity: 'warning',
          success: false,
          email: authState.email || getPremiumAuthState(req)?.email || '',
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

    req.premiumAuth = authState;
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

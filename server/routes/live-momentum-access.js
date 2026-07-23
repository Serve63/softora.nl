function registerLiveMomentumAccessRoutes(app, deps = {}) {
  const {
    premiumLoginRateLimiter,
    requirePremiumAdminApiAccess,
    grantLiveMomentumAccess,
    appendSecurityAuditEvent = () => {},
    getClientIpFromRequest = () => '',
    getRequestPathname = () => '/api/live-momentum/access',
    getRequestOriginFromHeaders = () => '',
  } = deps;

  app.post(
    '/api/live-momentum/access',
    premiumLoginRateLimiter,
    requirePremiumAdminApiAccess,
    (req, res) => {
      const result = grantLiveMomentumAccess(req, res, req.premiumAuth, req.body?.code);
      const success = Boolean(result?.ok);
      appendSecurityAuditEvent(
        {
          type: success ? 'live_momentum_access_granted' : 'live_momentum_access_denied',
          severity: success ? 'info' : 'warning',
          success,
          email: req.premiumAuth?.email || '',
          ip: getClientIpFromRequest(req),
          path: getRequestPathname(req),
          origin: getRequestOriginFromHeaders(req),
          userAgent: typeof req.get === 'function' ? req.get('user-agent') : '',
          detail: success
            ? 'Winnen geopend met geldige toegangscode.'
            : 'Winnen geweigerd door ongeldige toegangscode.',
        },
        success ? 'security_live_momentum_access_granted' : 'security_live_momentum_access_denied'
      );

      if (!success) {
        return res.status(Number(result?.status) || 403).json({
          ok: false,
          error: result?.error || 'Toegang geweigerd.',
        });
      }
      return res.json({ ok: true, expiresInMs: result.expiresInMs });
    }
  );
}

module.exports = {
  registerLiveMomentumAccessRoutes,
};

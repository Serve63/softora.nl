function registerFacebookAdsProtectedRoutes(app, deps = {}) {
  const service = deps.service;
  if (!service) return;
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function'
    ? deps.requirePremiumAdminApiAccess
    : (_req, _res, next) => next();

  app.get('/api/facebook-ads/status', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await service.getStatus()) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });

  app.get('/api/facebook-ads/blueprint', requireAdmin, (_req, res) => {
    return res.json({ ok: true, ...service.getBlueprint() });
  });

  app.get('/api/facebook-ads/launch-pack', requireAdmin, (_req, res) => {
    try {
      return res.json({ ok: true, ...service.getLaunchPack() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });

  app.post('/api/facebook-ads/dry-run', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, result: await service.runDryRun() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });
}

module.exports = {
  registerFacebookAdsProtectedRoutes,
};

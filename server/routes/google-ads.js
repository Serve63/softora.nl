function registerGoogleAdsRoutes(app, deps = {}) {
  const service = deps.service;
  if (!service) return;
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function'
    ? deps.requirePremiumAdminApiAccess
    : (_req, _res, next) => next();

  app.post('/api/public-conversion', async (req, res) => {
    try {
      const event = await service.recordConversion(req.body);
      if (!event) return res.status(400).json({ ok: false, error: 'Ongeldige conversie.' });
      return res.status(202).json({ ok: true });
    } catch (error) {
      return res.status(503).json({ ok: false, error: 'Conversieregistratie tijdelijk niet beschikbaar.' });
    }
  });

  app.get('/api/google-ads/daily-run', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'Google Ads-cron is niet geconfigureerd.' });
    if (String(req.headers?.authorization || '').trim() !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'Google Ads-cron geweigerd.' });
    }
    try {
      return res.json({ ok: true, result: await service.runDryRun() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });

  app.get('/api/google-ads/status', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await service.getStatus()) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });

  app.get('/api/google-ads/blueprint', requireAdmin, (_req, res) => {
    return res.json({ ok: true, ...service.getBlueprint() });
  });

  app.post('/api/google-ads/dry-run', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, result: await service.runDryRun() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });
}

module.exports = { registerGoogleAdsRoutes };

function registerWhoopHealthPublicRoutes(app, deps = {}) {
  const service = deps.service;
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  if (!service) return;

  app.get('/api/health/whoop/callback', async (req, res) => {
    if (req.query?.error) {
      return res.redirect(302, `/premium-gezondheidsdossier?whoop=error&message=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
    }
    try {
      await service.completeAuthorization({ code: req.query?.code, state: req.query?.state });
      return res.redirect(302, '/premium-gezondheidsdossier?whoop=connected');
    } catch (error) {
      return res.redirect(302, `/premium-gezondheidsdossier?whoop=error&message=${encodeURIComponent(String(error.message || error).slice(0, 300))}`);
    }
  });

  app.get('/api/health/whoop/daily-sync', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (String(req.headers?.authorization || '').trim() !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    }
    try {
      return res.json(await service.sync({ mode: 'daily', enforceSchedule: true }));
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });
}

function registerWhoopHealthProtectedRoutes(app, deps = {}) {
  const service = deps.service;
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function'
    ? deps.requirePremiumAdminApiAccess
    : (_req, _res, next) => next();
  if (!service) return;

  app.get('/api/health/whoop/status', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await service.getStatus()) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });

  app.get('/api/health/whoop/authorize', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, authorizationUrl: await service.createAuthorizationUrl() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });

  app.get('/api/health/whoop/data', requireAdmin, async (req, res) => {
    try {
      return res.json({ ok: true, ...(await service.getDashboard(req.query?.days)) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });

  app.post('/api/health/whoop/sync', requireAdmin, async (req, res) => {
    try {
      const mode = req.body?.mode === 'backfill' ? 'backfill' : 'manual';
      return res.json(await service.sync({ mode, targetDay: req.body?.targetDay }));
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });
}

module.exports = { registerWhoopHealthProtectedRoutes, registerWhoopHealthPublicRoutes };

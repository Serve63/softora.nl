function registerWhoopHealthPublicRoutes(app, deps = {}) {
  const service = deps.service;
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  if (!service) return;

  function cronAuthorized(req) {
    return Boolean(cronSecret) && String(req.headers?.authorization || '').trim() === `Bearer ${cronSecret}`;
  }

  app.get('/api/health/whoop/callback', async (req, res) => {
    if (req.query?.error) {
      return res.redirect(302, `/premium-gezondheidsdossier?whoop=error&message=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
    }
    try {
      await service.completeAuthorization({ code: req.query?.code, state: req.query?.state });
      let repair = null;
      try {
        repair = await service.repairGap();
      } catch (repairError) {
        console.error('[WHOOP][RepairGapAfterAuthorization]', repairError);
      }
      return res.redirect(302, `/premium-gezondheidsdossier?whoop=connected${repair?.ok ? '&repaired=1' : ''}`);
    } catch (error) {
      return res.redirect(302, `/premium-gezondheidsdossier?whoop=error&message=${encodeURIComponent(String(error.message || error).slice(0, 300))}`);
    }
  });

  app.post('/api/health/whoop/webhook', async (req, res) => {
    const signature = String(req.get?.('x-whoop-signature') || req.headers?.['x-whoop-signature'] || '');
    const timestamp = String(req.get?.('x-whoop-signature-timestamp') || req.headers?.['x-whoop-signature-timestamp'] || '');
    if (!service.verifyWebhookRequest({ rawBody: req.rawBody, signature, timestamp })) {
      return res.status(401).json({ ok: false, error: 'Ongeldige WHOOP-webhookhandtekening.' });
    }
    try {
      const result = await service.enqueueWebhookEvent(req.body || {});
      return res.status(202).json({ ok: true, queued: !result.ignored, duplicate: Boolean(result.duplicate) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 300) });
    }
  });

  app.get('/api/health/whoop/process-events', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    try {
      return res.json(await service.processWebhookEvents());
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });

  app.get('/api/health/whoop/reconcile', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    try {
      return res.json(await service.sync({ mode: 'daily', enforceScheduleHour: 12 }));
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });

  app.get('/api/health/whoop/daily-sync', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    try {
      return res.json(await service.sync({ mode: 'daily' }));
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

  app.get('/api/health/whoop/reconnect', requireAdmin, async (_req, res) => {
    try {
      return res.redirect(302, await service.createAuthorizationUrl());
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

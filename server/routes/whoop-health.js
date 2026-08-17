function headerValue(req, name) {
  if (req && typeof req.get === 'function') return String(req.get(name) || '');
  const headers = req?.headers || {};
  return String(headers[name] || headers[String(name).toLowerCase()] || '');
}

function hasCronAccess(req, cronSecret) {
  return Boolean(
    cronSecret &&
    String(req?.headers?.authorization || '').trim() === `Bearer ${cronSecret}`
  );
}

function safeErrorPayload(error) {
  return {
    ok: false,
    errorCode: String(error?.code || 'WHOOP_REQUEST_FAILED').slice(0, 120),
    error: String(error?.message || error)
      .replace(/[A-Za-z0-9_-]{40,}/g, '[afgeschermd]')
      .slice(0, 500),
  };
}

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

  app.post('/api/health/whoop/webhook', async (req, res) => {
    try {
      const result = await service.acceptWebhook({
        rawBody: req.rawBody,
        payload: req.body,
        signature: headerValue(req, 'x-whoop-signature'),
        timestamp: headerValue(req, 'x-whoop-signature-timestamp'),
      });
      return res.status(202).json(result);
    } catch (error) {
      const code = String(error?.code || '');
      const status = code === 'WHOOP_WEBHOOK_SIGNATURE_INVALID' ? 401 : 400;
      return res.status(status).json({ ok: false, error: String(error.message || error).slice(0, 500) });
    }
  });

  app.get('/api/health/whoop/daily-sync', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!hasCronAccess(req, cronSecret)) {
      return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    }
    try {
      const run = typeof service.syncTodayFallback === 'function'
        ? service.syncTodayFallback({ enforceSchedule: true })
        : service.sync({ mode: 'daily' });
      return res.json(await run);
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
    }
  });

  app.get('/api/health/whoop/token-worker', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!hasCronAccess(req, cronSecret)) {
      return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    }
    try {
      return res.json(await service.maintainToken());
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
    }
  });

  app.get('/api/health/whoop/reconcile', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!hasCronAccess(req, cronSecret)) {
      return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    }
    try {
      return res.json(await service.reconcileToday({ enforceSchedule: true }));
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
    }
  });

  app.get('/api/health/whoop/webhook-worker', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WHOOP-cron is niet geconfigureerd.' });
    if (!hasCronAccess(req, cronSecret)) {
      return res.status(401).json({ ok: false, error: 'WHOOP-cron geweigerd.' });
    }
    try {
      return res.json(await service.processWebhookQueue({ limit: 5 }));
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
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
      return res.status(500).json(safeErrorPayload(error));
    }
  });

  app.get('/api/health/whoop/authorize', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, authorizationUrl: await service.createAuthorizationUrl() });
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
    }
  });

  app.get('/api/health/whoop/data', requireAdmin, async (req, res) => {
    try {
      return res.json({ ok: true, ...(await service.getDashboard(req.query?.days)) });
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
    }
  });

  app.post('/api/health/whoop/sync', requireAdmin, async (req, res) => {
    try {
      const mode = req.body?.mode === 'backfill' ? 'backfill' : 'manual';
      return res.json(await service.sync({ mode, targetDay: req.body?.targetDay }));
    } catch (error) {
      return res.status(500).json(safeErrorPayload(error));
    }
  });
}

module.exports = { registerWhoopHealthProtectedRoutes, registerWhoopHealthPublicRoutes };

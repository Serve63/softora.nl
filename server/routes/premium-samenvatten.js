const { rateLimit } = require('express-rate-limit');
const { createPremiumSamenvattenService } = require('../services/premium-samenvatten');

function sameOrigin(req) {
  const origin = req.get('origin');
  if (origin === 'https://www.softora.nl' || origin === 'https://softora.nl') return true;
  return process.env.NODE_ENV !== 'production'
    && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
}

function registerPremiumSamenvattenCleanupRoute(app, { service, cronSecret } = {}) {
  app.get('/api/samenvatten/cleanup', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!cronSecret || req.get('authorization') !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false });
    }
    try {
      return res.json({ ok: true, ...(await service.cleanup()) });
    } catch (_) {
      return res.status(503).json({ ok: false, error: 'Opschonen tijdelijk niet beschikbaar.' });
    }
  });
}

function registerPremiumSamenvattenRoutes(app, { service = createPremiumSamenvattenService() } = {}) {
  const writes = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const reads = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false });
  const jsonWrite = (req, res, next) => {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Ongeldige herkomst.' });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'JSON vereist.' });
    return next();
  };
  const handle = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try { return res.json({ ok: true, ...(await fn(req)) }); }
    catch (error) {
      const status = Number(error?.status);
      return res.status(status >= 400 && status <= 499 ? status : 503).json({
        ok: false,
        error: status >= 400 && status <= 499 ? error.message : 'Samenvatten is tijdelijk niet beschikbaar.',
      });
    }
  };
  app.get('/api/samenvatten/config', reads, handle(async () => ({ enabled: service.enabled(), maxBytes: 100 * 1024 * 1024 })));
  app.post('/api/samenvatten/plan', writes, jsonWrite, handle((req) => service.plan(req.premiumAuth, req.body)));
  app.post('/api/samenvatten/jobs/:id/start', writes, jsonWrite, handle((req) => service.start(req.premiumAuth, req.params.id)));
  app.get('/api/samenvatten/jobs/recent', reads, handle((req) => service.recent(req.premiumAuth)));
  app.get('/api/samenvatten/jobs/:id', reads, handle((req) => service.status(req.premiumAuth, req.params.id)));
}

module.exports = {
  registerPremiumSamenvattenRoutes,
  registerPremiumSamenvattenCleanupRoute,
};

const { createMailAnalyticsService } = require('../services/mail-analytics');
function registerMailAnalyticsRoutes(app, deps = {}) {
  if (typeof deps.requirePremiumAdminApiAccess !== 'function') return;
  const service = deps.service || createMailAnalyticsService(deps);
  app.get('/api/mailbox/analytics', deps.requirePremiumAdminApiAccess, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    try { res.json(await service.get(req.query || {})); }
    catch (error) { res.status(error.status || 503).json({ ok: false, message: error.status ? error.message : 'Analytics is tijdelijk niet beschikbaar.' }); }
  });
}
module.exports = { registerMailAnalyticsRoutes };

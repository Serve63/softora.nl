const { createWorldWatcherService } = require('../services/world-watcher');

function registerWorldWatcherRoutes(app, deps = {}) {
  const service = deps.service || createWorldWatcherService();
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function' ? deps.requirePremiumAdminApiAccess : (_req, res) => res.status(503).json({ ok: false, error: 'Toegangscontrole niet beschikbaar.' });
  app.get('/api/world-watcher', requireAdmin, async (_req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
      const snapshot = await service.getSnapshot();
      return res.status(snapshot.ok ? 200 : 503).json(snapshot);
    } catch {
      return res.status(503).json({ ok: false, error: 'De nieuwsbronnen zijn tijdelijk niet bereikbaar.' });
    }
  });
}
module.exports = { registerWorldWatcherRoutes };

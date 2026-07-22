function registerRevenueProofRoutes(app, deps = {}) {
  const service = deps.service;
  if (!service) return;
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function'
    ? deps.requirePremiumAdminApiAccess
    : (_req, res) => res.status(503).json({
        ok: false,
        error: 'Revenue-proof beheerbeveiliging is niet geconfigureerd.',
      });

  app.post('/api/revenue-proof/bunq-webhook', (req, res, next) =>
    Promise.resolve(service.bunqWebhookResponse(req, res)).catch(next)
  );
  app.post('/api/revenue-proof/events', requireAdmin, (req, res, next) =>
    Promise.resolve(service.automationEventResponse(req, res)).catch(next)
  );
  app.get('/api/revenue-proof/status', requireAdmin, (req, res, next) =>
    Promise.resolve(service.statusResponse(req, res)).catch(next)
  );
}

module.exports = {
  registerRevenueProofRoutes,
};

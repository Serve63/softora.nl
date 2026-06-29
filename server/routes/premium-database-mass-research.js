function passThrough(_req, _res, next) {
  if (typeof next === 'function') next();
}

function registerPremiumDatabaseMassResearchRoutes(app, deps = {}) {
  const {
    coordinator,
    requirePremiumAdminApiAccess = passThrough,
  } = deps;

  app.post('/api/premium-database/mass-research-jobs', requirePremiumAdminApiAccess, (req, res) =>
    coordinator.sendCreateJobResponse(req, res)
  );

  app.get('/api/premium-database/mass-research-jobs/:jobId', requirePremiumAdminApiAccess, (req, res) =>
    coordinator.sendGetJobResponse(req, res)
  );

  app.post('/api/premium-database/mass-research-jobs/:jobId/run', requirePremiumAdminApiAccess, (req, res) =>
    coordinator.sendRunJobResponse(req, res)
  );

  app.post('/api/premium-database/mass-research-jobs/:jobId/cancel', requirePremiumAdminApiAccess, (req, res) =>
    coordinator.sendCancelJobResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseMassResearchRoutes,
};

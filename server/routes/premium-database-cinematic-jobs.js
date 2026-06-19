function registerPremiumDatabaseCinematicJobRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const requirePremiumApiAccess =
    typeof deps.requirePremiumApiAccess === 'function'
      ? deps.requirePremiumApiAccess
      : (_req, _res, next) => next();

  app.post('/api/premium-database/cinematic-jobs', requirePremiumApiAccess, (req, res) =>
    coordinator.startJobResponse(req, res)
  );
  app.get('/api/premium-database/cinematic-jobs/config', requirePremiumApiAccess, (req, res) =>
    coordinator.configResponse(req, res)
  );
  app.get('/api/premium-database/cinematic-jobs/:jobId/video', requirePremiumApiAccess, (req, res) =>
    coordinator.getVideoResponse(req, res)
  );
  app.get('/api/premium-database/cinematic-jobs/:jobId/frame/:frameIndex', requirePremiumApiAccess, (req, res) =>
    coordinator.getFrameResponse(req, res)
  );
  app.get('/api/premium-database/cinematic-jobs/:jobId', requirePremiumApiAccess, (req, res) =>
    coordinator.getJobResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseCinematicJobRoutes,
};

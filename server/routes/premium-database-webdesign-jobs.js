function registerPremiumDatabaseWebdesignJobRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;

  app.post('/api/premium-database/webdesign-photo-jobs', (req, res) =>
    coordinator.startJobResponse(req, res)
  );
  app.get('/api/premium-database/webdesign-photo-jobs', (req, res) =>
    coordinator.listJobsResponse(req, res)
  );
  app.get('/api/premium-database/webdesign-photo-jobs/:jobId', (req, res) =>
    coordinator.getJobResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseWebdesignJobRoutes,
};

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
  app.post('/api/premium-database/webdesign-photo-batches', (req, res) =>
    coordinator.startBatchResponse(req, res)
  );
  app.get('/api/premium-database/webdesign-photo-batches', (req, res) =>
    coordinator.listBatchesResponse(req, res)
  );
  app.post('/api/premium-database/webdesign-photo-batches/:batchId/chunks', (req, res) =>
    coordinator.appendBatchChunkResponse(req, res)
  );
  app.post('/api/premium-database/webdesign-photo-batches/:batchId/commit', (req, res) =>
    coordinator.commitBatchResponse(req, res)
  );
  app.get('/api/premium-database/webdesign-photo-batches/:batchId', (req, res) =>
    coordinator.getBatchResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseWebdesignJobRoutes,
};

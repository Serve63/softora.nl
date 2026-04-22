function registerWebsitePreviewBatchRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;

  app.post('/api/website-preview/batch', (req, res) =>
    coordinator.startBatchResponse(req, res)
  );
  app.get('/api/website-preview/batch/:jobId', (req, res) =>
    coordinator.getBatchResponse(req, res)
  );
}

module.exports = {
  registerWebsitePreviewBatchRoutes,
};

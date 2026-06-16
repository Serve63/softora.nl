function registerPremiumDatabaseWebdesignJobRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  const requirePremiumApiAccess =
    typeof deps.requirePremiumApiAccess === 'function'
      ? deps.requirePremiumApiAccess
      : (_req, _res, next) => next();

  function requireCronAccess(req, res, next) {
    if (!cronSecret) {
      return res.status(503).json({
        ok: false,
        code: 'WEBDESIGN_BULK_CRON_NOT_CONFIGURED',
        message: 'Webdesign-bulk cron is niet geconfigureerd.',
      });
    }
    const authorization = String(req.headers?.authorization || '').trim();
    if (authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({
        ok: false,
        code: 'WEBDESIGN_BULK_CRON_UNAUTHORIZED',
        message: 'Webdesign-bulk cron geweigerd.',
      });
    }
    return next();
  }

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
  app.post('/api/premium-database/webdesign-photo-batches/run', requirePremiumApiAccess, (req, res) =>
    coordinator.runBatchWorkerResponse(req, res)
  );
  app.get('/api/premium-database/webdesign-photo-batches/run', requireCronAccess, (req, res) =>
    coordinator.runBatchWorkerResponse(req, res)
  );
  app.post('/api/premium-database/webdesign-photo-batches/:batchId/chunks', (req, res) =>
    coordinator.appendBatchChunkResponse(req, res)
  );
  app.post('/api/premium-database/webdesign-photo-batches/:batchId/commit', (req, res) =>
    coordinator.commitBatchResponse(req, res)
  );
  app.post('/api/premium-database/webdesign-photo-batches/:batchId/cancel', requirePremiumApiAccess, (req, res) =>
    coordinator.cancelBatchResponse(req, res)
  );
  app.get('/api/premium-database/webdesign-photo-batches/:batchId', (req, res) =>
    coordinator.getBatchResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseWebdesignJobRoutes,
};

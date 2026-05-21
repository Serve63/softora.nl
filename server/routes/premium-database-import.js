function registerPremiumDatabaseImportRoutes(app, deps = {}) {
  const { coordinator } = deps;

  app.post('/api/premium-database/import-spreadsheet', (req, res) =>
    coordinator.sendImportResponse(req, res)
  );

  app.post('/api/premium-database/sync-spreadsheet', (req, res) =>
    coordinator.sendSyncResponse(req, res)
  );

  app.post('/api/premium-database/add-real-businesses', (req, res) =>
    coordinator.sendRealBusinessesResponse(req, res)
  );

  app.get('/api/premium-database/deep-search-estimate', (req, res) =>
    coordinator.sendDeepSearchEstimateResponse(req, res)
  );

  app.post('/api/premium-database/deep-search-businesses', (req, res) =>
    coordinator.sendDeepSearchBusinessesResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseImportRoutes,
};

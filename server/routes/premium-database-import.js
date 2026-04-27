function registerPremiumDatabaseImportRoutes(app, deps = {}) {
  const { coordinator } = deps;

  app.post('/api/premium-database/import-spreadsheet', (req, res) =>
    coordinator.sendImportResponse(req, res)
  );

  app.post('/api/premium-database/sync-spreadsheet', (req, res) =>
    coordinator.sendSyncResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseImportRoutes,
};

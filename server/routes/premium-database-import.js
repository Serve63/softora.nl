function registerPremiumDatabaseImportRoutes(app, deps = {}) {
  const { coordinator } = deps;

  app.post('/api/premium-database/import-spreadsheet', (req, res) =>
    coordinator.sendImportResponse(req, res)
  );
}

module.exports = {
  registerPremiumDatabaseImportRoutes,
};

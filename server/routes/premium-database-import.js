function registerPremiumDatabaseImportRoutes(app, deps = {}) {
  const {
    coordinator,
    mailReadySnapshotService = null,
    requirePremiumApiAccess = (_req, _res, next) => next(),
  } = deps;

  app.post('/api/premium-database/import-spreadsheet', (req, res) =>
    coordinator.sendImportResponse(req, res)
  );

  app.post('/api/premium-database/sync-spreadsheet', (req, res) =>
    coordinator.sendSyncResponse(req, res)
  );

  app.post('/api/premium-database/add-real-businesses', (req, res) =>
    coordinator.sendRealBusinessesResponse(req, res)
  );

  app.post('/api/premium-database/delete-lead', (req, res) =>
    coordinator.sendDeleteLeadResponse(req, res)
  );

  app.post('/api/premium-database/remove-webdesign-assets', requirePremiumApiAccess, (req, res) =>
    coordinator.sendRemoveWebdesignAssetsResponse(req, res)
  );

  app.get('/api/premium-database/mail-ready-snapshot', (req, res) =>
    mailReadySnapshotService && typeof mailReadySnapshotService.sendMailReadySnapshotResponse === 'function'
      ? mailReadySnapshotService.sendMailReadySnapshotResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Mailklare snapshot is tijdelijk niet beschikbaar.' })
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

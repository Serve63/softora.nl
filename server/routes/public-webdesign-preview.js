function registerPublicWebdesignPreviewRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;

  app.get('/webdesign/:companySlug/asset/:assetType', (req, res) =>
    coordinator.getPreviewAssetResponse(req, res)
  );

  app.get('/webdesign/:companySlug/concept', (req, res) =>
    coordinator.getConceptPageResponse(req, res)
  );

  app.get('/webdesign/:companySlug', (req, res) =>
    coordinator.getPreviewPageResponse(req, res)
  );

  app.get('/mailklaar/:customerId/concept', (req, res) =>
    coordinator.getConceptPageResponse(req, res)
  );

  app.get('/mailklaar/:customerId/asset/:assetType', (req, res) =>
    coordinator.getPreviewAssetResponse(req, res)
  );

  app.get('/mailklaar/:customerId', (req, res) =>
    coordinator.getPreviewPageResponse(req, res)
  );
}

module.exports = {
  registerPublicWebdesignPreviewRoutes,
};

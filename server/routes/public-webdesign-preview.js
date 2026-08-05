function getCrossOriginPreviewAssetResponse(coordinator, req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return coordinator.getPreviewAssetResponse(req, res);
}

function registerPublicWebdesignPreviewRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;

  app.get('/webdesign/:companySlug/asset/:assetType', (req, res) =>
    getCrossOriginPreviewAssetResponse(coordinator, req, res)
  );

  app.get('/webdesign/:companySlug/concept', (req, res) =>
    coordinator.getConceptPageResponse(req, res)
  );

  app.get('/webdesign/:companySlug', (req, res) =>
    coordinator.getConceptPageResponse(req, res)
  );

  app.get('/mailklaar/:customerId/concept', (req, res) =>
    coordinator.getConceptPageResponse(req, res)
  );

  app.get('/mailklaar/:customerId/asset/:assetType', (req, res) =>
    getCrossOriginPreviewAssetResponse(coordinator, req, res)
  );

  app.get('/mailklaar/:customerId', (req, res) =>
    coordinator.getPreviewPageResponse(req, res)
  );
}

module.exports = {
  registerPublicWebdesignPreviewRoutes,
};

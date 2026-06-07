function registerPublicWebdesignPreviewRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;

  app.get('/webdesign/:companySlug/poster.png', (req, res) =>
    coordinator.getPreviewPosterResponse(req, res)
  );

  app.get('/webdesign/:companySlug', (req, res) =>
    coordinator.getPreviewPageResponse(req, res)
  );

  app.get('/mailklaar/:customerId/poster.png', (req, res) =>
    coordinator.getPreviewPosterResponse(req, res)
  );

  app.get('/mailklaar/:customerId', (req, res) =>
    coordinator.getPreviewPageResponse(req, res)
  );
}

module.exports = {
  registerPublicWebdesignPreviewRoutes,
};

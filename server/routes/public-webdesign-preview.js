function registerPublicWebdesignPreviewRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;

  app.get('/mailklaar/:customerId', (req, res) =>
    coordinator.getPreviewPageResponse(req, res)
  );
}

module.exports = {
  registerPublicWebdesignPreviewRoutes,
};

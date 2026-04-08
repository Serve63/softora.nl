function registerSeoWriteRoutes(app, deps) {
  app.post('/api/seo/page', (req, res) => deps.writeCoordinator.saveSeoPageResponse(req, res));
  app.post('/api/seo/site-optimize', (req, res) =>
    deps.writeCoordinator.siteOptimizeResponse(req, res)
  );
  app.post('/api/seo/automation', (req, res) =>
    deps.writeCoordinator.saveSeoAutomationResponse(req, res)
  );
}

module.exports = {
  registerSeoWriteRoutes,
};

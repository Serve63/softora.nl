function registerSeoReadRoutes(app, deps) {
  app.get('/api/seo/pages', (req, res) => deps.readCoordinator.listSeoPagesResponse(req, res));
  app.get('/api/seo/page', (req, res) => deps.readCoordinator.getSeoPageResponse(req, res));
  app.get('/api/seo/site-audit', (req, res) => deps.readCoordinator.getSeoSiteAuditResponse(req, res));
}

module.exports = {
  registerSeoReadRoutes,
};

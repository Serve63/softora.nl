function registerWebsiteLinkRoutes(app, deps) {
  app.get('/api/website-links', (req, res) =>
    deps.coordinator.listWebsiteLinksResponse(req, res)
  );
  app.post('/api/website-links/create', (req, res) =>
    deps.coordinator.saveWebsiteLinkResponse(req, res)
  );
}

module.exports = {
  registerWebsiteLinkRoutes,
};

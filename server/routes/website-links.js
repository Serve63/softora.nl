function registerWebsiteLinkRoutes(app, deps) {
  app.post('/api/website-links/create', (req, res) =>
    deps.coordinator.saveWebsiteLinkResponse(req, res)
  );
}

module.exports = {
  registerWebsiteLinkRoutes,
};

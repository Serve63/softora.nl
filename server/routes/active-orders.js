function registerActiveOrderRoutes(app, deps) {
  app.post('/api/active-orders/generate-site', (req, res) =>
    deps.coordinator.sendGenerateSiteResponse(req, res)
  );
  app.post('/api/active-order-generate-site', (req, res) =>
    deps.coordinator.sendGenerateSiteResponse(req, res)
  );
  app.post('/api/active-orders/launch-site', (req, res) =>
    deps.coordinator.sendLaunchSiteResponse(req, res)
  );
  app.post('/api/active-order-launch-site', (req, res) =>
    deps.coordinator.sendLaunchSiteResponse(req, res)
  );
}

module.exports = {
  registerActiveOrderRoutes,
};

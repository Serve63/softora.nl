function registerPublicContactRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;

  app.post('/api/public-contact', (req, res) => coordinator.submitResponse(req, res));
}

module.exports = {
  registerPublicContactRoutes,
};

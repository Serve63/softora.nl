function registerPublicConversionRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;

  app.post('/api/public-conversion', (req, res) => coordinator.recordResponse(req, res));
}

module.exports = {
  registerPublicConversionRoutes,
};

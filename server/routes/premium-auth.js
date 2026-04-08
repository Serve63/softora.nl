function registerPremiumAuthRoutes(app, deps) {
  app.use('/api/auth/login', deps.premiumLoginRateLimiter);

  app.get('/api/auth/session', (req, res) => deps.coordinator.sendSessionResponse(req, res));
  app.post('/api/auth/login', (req, res) => deps.coordinator.loginResponse(req, res));
  app.post('/api/auth/logout', (req, res) => deps.coordinator.logoutResponse(req, res));
}

module.exports = {
  registerPremiumAuthRoutes,
};

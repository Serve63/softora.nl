function registerCompanyWebsiteVideoRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const requirePremiumApiAccess = typeof deps.requirePremiumApiAccess === 'function'
    ? deps.requirePremiumApiAccess
    : (_req, _res, next) => next();

  app.get('/bedrijven/:companyId/video', requirePremiumApiAccess, (req, res) =>
    coordinator.pageResponse(req, res)
  );
  app.get('/api/bedrijven/:companyId/website-video', requirePremiumApiAccess, (req, res) =>
    coordinator.statusResponse(req, res)
  );
  app.post('/api/bedrijven/:companyId/website-video', requirePremiumApiAccess, (req, res) =>
    coordinator.startResponse(req, res)
  );
  app.get('/api/bedrijven/:companyId/website-video/file', requirePremiumApiAccess, (req, res) =>
    coordinator.fileResponse(req, res)
  );
}

module.exports = {
  registerCompanyWebsiteVideoRoutes,
};

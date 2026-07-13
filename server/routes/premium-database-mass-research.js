function passThrough(_req, _res, next) { if (typeof next === 'function') next(); }
function registerPremiumDatabaseMassResearchRoutes(app, deps = {}) {
  const { coordinator, requirePremiumAdminApiAccess = passThrough } = deps;
  [
    ['post', '/api/premium-database/mass-research-jobs', 'sendCreateJobResponse'],
    ['get', '/api/premium-database/mass-research-jobs/status', 'sendGetStatusResponse'],
    ['get', '/api/premium-database/mass-research-jobs/:jobId', 'sendGetJobResponse'],
    ['post', '/api/premium-database/mass-research-jobs/:jobId/run', 'sendRunJobResponse'],
    ['post', '/api/premium-database/mass-research-jobs/:jobId/cancel', 'sendCancelJobResponse'],
  ].forEach(([method, route, handler]) => {
    app[method](route, requirePremiumAdminApiAccess, (req, res) => coordinator[handler](req, res));
  });
}
module.exports = { registerPremiumDatabaseMassResearchRoutes };

function registerRuntimeOpsRoutes(app, deps) {
  app.get('/api/dashboard/activity', (req, res) =>
    deps.coordinator.sendDashboardActivityResponse(req, res)
  );
  app.get('/api/security/audit-log', deps.requireRuntimeDebugAccess, (req, res) =>
    deps.coordinator.sendSecurityAuditLogResponse(req, res)
  );
  app.get('/api/ui-state/:scope', async (req, res) =>
    deps.coordinator.sendUiStateGetResponse(req, res, req.params.scope)
  );
  app.get('/api/ui-state-get', async (req, res) =>
    deps.coordinator.sendUiStateGetResponse(req, res, req.query.scope)
  );
  app.post('/api/ui-state/:scope', async (req, res) =>
    deps.coordinator.sendUiStateSetResponse(req, res, req.params.scope)
  );
  app.post('/api/ui-state-set', async (req, res) =>
    deps.coordinator.sendUiStateSetResponse(req, res, req.query.scope)
  );
  app.post('/api/dashboard/activity', (req, res) =>
    deps.coordinator.sendDashboardActivityCreateResponse(req, res)
  );
}

module.exports = {
  registerRuntimeOpsRoutes,
};

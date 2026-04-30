function registerRuntimeDebugOpsRoutes(app, deps) {
  app.get('/api/supabase-probe', deps.requireRuntimeDebugAccess, (req, res) =>
    deps.coordinator.sendSupabaseProbeResponse(req, res)
  );
  app.post('/api/runtime-sync-now', deps.requireRuntimeDebugAccess, (req, res) =>
    deps.coordinator.sendRuntimeSyncNowResponse(req, res)
  );
  app.get('/api/data-health', deps.requireRuntimeDebugAccess, (req, res) =>
    deps.coordinator.sendDataHealthResponse(req, res)
  );
}

module.exports = {
  registerRuntimeDebugOpsRoutes,
};

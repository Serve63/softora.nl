const {
  createSupabaseMaintenanceAccessGuard,
  createSupabaseMaintenanceCoordinator,
} = require('../services/supabase-maintenance');

function registerSupabaseMaintenanceRoutes(app, deps = {}) {
  const coordinator = deps.coordinator || createSupabaseMaintenanceCoordinator(deps);
  if (!coordinator) return;
  const requireMaintenance =
    typeof deps.requireSupabaseMaintenanceAccess === 'function'
      ? deps.requireSupabaseMaintenanceAccess
      : createSupabaseMaintenanceAccessGuard(deps);

  if (typeof coordinator.sendSupabaseDatabaseRestartResponse === 'function') {
    app.post('/api/supabase/database/restart', requireMaintenance, (req, res) =>
      coordinator.sendSupabaseDatabaseRestartResponse(req, res)
    );
  }
}

module.exports = {
  registerSupabaseMaintenanceRoutes,
};

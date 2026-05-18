const { createSupabaseCostSummaryCoordinator } = require('../services/supabase-costs');

function registerSupabaseCostRoutes(app, deps = {}) {
  const coordinator = deps.coordinator || createSupabaseCostSummaryCoordinator(deps);
  if (!coordinator) return;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();

  if (typeof coordinator.sendSupabaseCostSummaryResponse === 'function') {
    app.get('/api/supabase/cost-summary', requireAdmin, (req, res) =>
      coordinator.sendSupabaseCostSummaryResponse(req, res)
    );
  }
}

module.exports = {
  registerSupabaseCostRoutes,
};

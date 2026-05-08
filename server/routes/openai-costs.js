const { createOpenAiCostSummaryCoordinator } = require('../services/openai-costs');

function registerOpenAiCostRoutes(app, deps = {}) {
  const coordinator = deps.coordinator || createOpenAiCostSummaryCoordinator(deps);
  if (!coordinator) return;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();

  if (typeof coordinator.sendCostSummaryResponse === 'function') {
    app.get('/api/openai/cost-summary', requireAdmin, (req, res) =>
      coordinator.sendCostSummaryResponse(req, res)
    );
  }
  if (typeof coordinator.sendCombinedCostSummaryResponse === 'function') {
    app.get('/api/api-cost-summary', requireAdmin, (req, res) =>
      coordinator.sendCombinedCostSummaryResponse(req, res)
    );
  }
}

module.exports = {
  registerOpenAiCostRoutes,
};

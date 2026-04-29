const { createOpenAiCostSummaryCoordinator } = require('../services/openai-costs');

function registerOpenAiCostRoutes(app, deps = {}) {
  const coordinator = deps.coordinator || createOpenAiCostSummaryCoordinator(deps);
  if (!coordinator || typeof coordinator.sendCostSummaryResponse !== 'function') return;

  app.get('/api/openai/cost-summary', (req, res) =>
    coordinator.sendCostSummaryResponse(req, res)
  );
}

module.exports = {
  registerOpenAiCostRoutes,
};

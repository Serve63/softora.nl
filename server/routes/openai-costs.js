const { createOpenAiCostSummaryCoordinator } = require('../services/openai-costs');

function registerOpenAiCostRoutes(app, deps = {}) {
  const coordinator = deps.coordinator || createOpenAiCostSummaryCoordinator(deps);
  if (!coordinator) return;

  if (typeof coordinator.sendOpenAiCostsDashboardResponse === 'function') {
    app.get('/api/openai-costs', (req, res) =>
      coordinator.sendOpenAiCostsDashboardResponse(req, res)
    );
  }
  if (typeof coordinator.sendCostSummaryResponse === 'function') {
    app.get('/api/openai/cost-summary', (req, res) =>
      coordinator.sendCostSummaryResponse(req, res)
    );
  }
  if (typeof coordinator.sendCombinedCostSummaryResponse === 'function') {
    app.get('/api/api-cost-summary', (req, res) =>
      coordinator.sendCombinedCostSummaryResponse(req, res)
    );
  }
}

module.exports = {
  registerOpenAiCostRoutes,
};

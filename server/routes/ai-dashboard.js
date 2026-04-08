function registerAiDashboardRoutes(app, deps) {
  app.post('/api/ai/dashboard-chat', (req, res) =>
    deps.coordinator.sendPremiumDashboardChatResponse(req, res)
  );
  app.post('/api/ai-dashboard-chat', (req, res) =>
    deps.coordinator.sendPremiumDashboardChatResponse(req, res)
  );
  app.post('/api/ai/summarize', (req, res) =>
    deps.coordinator.sendAiSummarizeResponse(req, res)
  );
}

module.exports = {
  registerAiDashboardRoutes,
};

function registerAiToolRoutes(app, deps) {
  app.post('/api/website-preview/generate', (req, res) =>
    deps.coordinator.sendWebsitePreviewGenerateResponse(req, res)
  );
  app.post('/api/website-preview-generate', (req, res) =>
    deps.coordinator.sendWebsitePreviewGenerateResponse(req, res)
  );
  app.post('/api/ai/order-dossier', (req, res) =>
    deps.coordinator.sendOrderDossierResponse(req, res)
  );
  app.post('/api/ai-order-dossier', (req, res) =>
    deps.coordinator.sendOrderDossierResponse(req, res)
  );
  app.post('/api/ai/transcript-to-prompt', (req, res) =>
    deps.coordinator.sendTranscriptToPromptResponse(req, res)
  );
  app.post('/api/ai-transcript-to-prompt', (req, res) =>
    deps.coordinator.sendTranscriptToPromptResponse(req, res)
  );
  app.post('/api/ai/notes-image-to-text', (req, res) =>
    deps.coordinator.sendNotesImageToTextResponse(req, res)
  );
  app.post('/api/ai-notes-image-to-text', (req, res) =>
    deps.coordinator.sendNotesImageToTextResponse(req, res)
  );
}

module.exports = {
  registerAiToolRoutes,
};

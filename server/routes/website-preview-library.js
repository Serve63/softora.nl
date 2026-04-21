function registerWebsitePreviewLibraryRoutes(app, deps = {}) {
  app.get('/api/website-preview-library', (req, res) =>
    deps.coordinator.listLibraryResponse(req, res)
  );
  app.post('/api/website-preview-library', (req, res) =>
    deps.coordinator.saveLibraryResponse(req, res)
  );
  app.delete('/api/website-preview-library/:id', (req, res) =>
    deps.coordinator.deleteLibraryResponse(req, res)
  );
}

module.exports = {
  registerWebsitePreviewLibraryRoutes,
};

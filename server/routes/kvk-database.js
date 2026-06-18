function registerKvkDatabaseRoutes(app, deps = {}) {
  const { coordinator } = deps;

  app.get('/api/kvk-database/snapshot', (req, res) =>
    coordinator && typeof coordinator.sendGetSnapshotResponse === 'function'
      ? coordinator.sendGetSnapshotResponse(req, res)
      : res.status(503).json({ ok: false, error: 'KVK database snapshot is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/snapshot', (req, res) =>
    coordinator && typeof coordinator.sendPostSnapshotResponse === 'function'
      ? coordinator.sendPostSnapshotResponse(req, res)
      : res.status(503).json({ ok: false, error: 'KVK database snapshot sync is tijdelijk niet beschikbaar.' })
  );
}

module.exports = {
  registerKvkDatabaseRoutes,
};

function passThrough(_req, _res, next) {
  if (typeof next === 'function') next();
}

function registerKvkDatabaseRoutes(app, deps = {}) {
  const {
    coordinator,
    controlCoordinator,
    directoryCoordinator,
    apiWorkersCoordinator,
    requirePremiumAdminApiAccess = passThrough,
  } = deps;

  app.get('/api/kvk-database/snapshot', (req, res) =>
    coordinator && typeof coordinator.sendGetSnapshotResponse === 'function'
      ? coordinator.sendGetSnapshotResponse(req, res)
      : res.status(503).json({ ok: false, error: 'KVK database snapshot is tijdelijk niet beschikbaar.' })
  );

  app.get('/api/kvk-database/snapshot/progress', (req, res) =>
    coordinator && typeof coordinator.sendGetProgressResponse === 'function'
      ? coordinator.sendGetProgressResponse(req, res)
      : res.status(503).json({ ok: false, error: 'KVK database voortgang is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/snapshot/progress', (req, res) =>
    coordinator && typeof coordinator.sendPostProgressResponse === 'function'
      ? coordinator.sendPostProgressResponse(req, res)
      : coordinator && typeof coordinator.sendPostSnapshotResponse === 'function'
        ? coordinator.sendPostSnapshotResponse(req, res)
        : res.status(503).json({ ok: false, error: 'KVK database voortgang-sync is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/snapshot', (req, res) =>
    coordinator && typeof coordinator.sendPostSnapshotResponse === 'function'
      ? coordinator.sendPostSnapshotResponse(req, res)
      : res.status(503).json({ ok: false, error: 'KVK database snapshot sync is tijdelijk niet beschikbaar.' })
  );

  app.get('/api/kvk-database/location-stats', requirePremiumAdminApiAccess, (req, res) =>
    coordinator && typeof coordinator.sendGetLocationStatsResponse === 'function'
      ? coordinator.sendGetLocationStatsResponse(req, res)
      : res.status(503).json({ ok: false, error: 'KVK locatiestatistieken zijn tijdelijk niet beschikbaar.' })
  );

  app.get('/api/kvk-database/company-directory', requirePremiumAdminApiAccess, (req, res) =>
    directoryCoordinator && typeof directoryCoordinator.sendGetDirectoryResponse === 'function'
      ? directoryCoordinator.sendGetDirectoryResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Online bedrijvendatabase is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/company-directory/sync', (req, res) =>
    directoryCoordinator && typeof directoryCoordinator.sendPostDirectorySyncResponse === 'function'
      ? directoryCoordinator.sendPostDirectorySyncResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Online bedrijvendatabase-sync is tijdelijk niet beschikbaar.' })
  );

  app.get('/api/kvk-database/control', requirePremiumAdminApiAccess, (req, res) =>
    controlCoordinator && typeof controlCoordinator.sendGetControlResponse === 'function'
      ? controlCoordinator.sendGetControlResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Databasevulling-besturing is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/control', requirePremiumAdminApiAccess, (req, res) =>
    controlCoordinator && typeof controlCoordinator.sendPostControlResponse === 'function'
      ? controlCoordinator.sendPostControlResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Databasevulling-besturing is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/control/command', (req, res) =>
    controlCoordinator && typeof controlCoordinator.sendCommandControlResponse === 'function'
      ? controlCoordinator.sendCommandControlResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Databasevulling-chatbesturing is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/control/poll', (req, res) =>
    controlCoordinator && typeof controlCoordinator.sendPollControlResponse === 'function'
      ? controlCoordinator.sendPollControlResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Databasevulling-workerbesturing is tijdelijk niet beschikbaar.' })
  );

  app.post('/api/kvk-database/control/worker', (req, res) =>
    controlCoordinator && typeof controlCoordinator.sendReportWorkerResponse === 'function'
      ? controlCoordinator.sendReportWorkerResponse(req, res)
      : res.status(503).json({ ok: false, error: 'Databasevulling-workerstatus is tijdelijk niet beschikbaar.' })
  );

  app.get('/api/kvk-database/api-workers', requirePremiumAdminApiAccess, (req, res) =>
    apiWorkersCoordinator.getStatus(req, res)
  );
  app.post('/api/kvk-database/api-workers', requirePremiumAdminApiAccess, (req, res) =>
    apiWorkersCoordinator.setEnabled(req, res)
  );
  app.post('/api/kvk-database/api-workers/poll', (req, res) =>
    apiWorkersCoordinator.poll(req, res)
  );
  app.post('/api/kvk-database/api-workers/report', (req, res) =>
    apiWorkersCoordinator.report(req, res)
  );
  app.post('/api/kvk-database/api-workers/research', (req, res) =>
    apiWorkersCoordinator.research(req, res)
  );
}

module.exports = {
  registerKvkDatabaseRoutes,
};

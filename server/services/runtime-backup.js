function buildRuntimeBackupEnvelope(options = {}) {
  const appName = String(options.appName || 'softora-runtime').trim();
  const appVersion = String(options.appVersion || '0.0.0').trim();
  const generatedAt = new Date().toISOString();
  const featureFlags = options.featureFlags && typeof options.featureFlags === 'object'
    ? { ...options.featureFlags }
    : {};
  const routeManifest = options.routeManifest && typeof options.routeManifest === 'object'
    ? {
        criticalFlowChecklist: Array.isArray(options.routeManifest.criticalFlowChecklist)
          ? options.routeManifest.criticalFlowChecklist.slice()
          : [],
        pageSmokeTargets: Array.isArray(options.routeManifest.pageSmokeTargets)
          ? options.routeManifest.pageSmokeTargets.slice()
          : [],
        contractTargets: Array.isArray(options.routeManifest.contractTargets)
          ? options.routeManifest.contractTargets.slice()
          : [],
      }
    : { criticalFlowChecklist: [], pageSmokeTargets: [], contractTargets: [] };
  const snapshotPayload =
    options.snapshotPayload && typeof options.snapshotPayload === 'object'
      ? options.snapshotPayload
      : {};
  const metadata =
    options.metadata && typeof options.metadata === 'object' ? { ...options.metadata } : {};

  return {
    ok: true,
    generatedAt,
    app: {
      name: appName,
      version: appVersion,
    },
    featureFlags,
    routeManifest,
    rollback: {
      recommendation: 'Herdeploy de laatst bekende stabiele release en herstel daarna indien nodig de runtime-backup.',
      backupScript: 'npm run backup:runtime',
      backupRoute: '/api/debug/runtime-backup',
    },
    metadata,
    snapshot: snapshotPayload,
  };
}

module.exports = {
  buildRuntimeBackupEnvelope,
};

const serverRuntime = require('./server/services/server-app-runtime');

const {
  app,
  isServerlessRuntime,
  normalizeNlPhoneToE164,
  startServer,
  buildRuntimeStateSnapshotPayloadWithLimits,
  buildRuntimeBackupForOps,
} = serverRuntime;

if (require.main === module && !isServerlessRuntime) {
  startServer();
}

module.exports = app;
module.exports.app = app;
module.exports.normalizeNlPhoneToE164 = normalizeNlPhoneToE164;
module.exports.startServer = startServer;
module.exports.buildRuntimeStateSnapshotPayloadWithLimits = buildRuntimeStateSnapshotPayloadWithLimits;
module.exports.buildRuntimeBackupForOps = buildRuntimeBackupForOps;

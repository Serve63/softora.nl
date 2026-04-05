function readBooleanEnvFlag(name, defaultValue = false) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return Boolean(defaultValue);
  return /^(1|true|yes|on)$/i.test(raw);
}

const FEATURE_FLAGS = Object.freeze({
  compatRollbackEnabled: readBooleanEnvFlag('SOFTORA_COMPAT_ROLLBACK_ENABLED', true),
  runtimeBackupRouteEnabled: readBooleanEnvFlag('SOFTORA_RUNTIME_BACKUP_ROUTE_ENABLED', true),
  publicDependencyHealthEnabled: readBooleanEnvFlag('SOFTORA_PUBLIC_DEPENDENCY_HEALTH_ENABLED', true),
  strictSecurityMode: readBooleanEnvFlag('SOFTORA_STRICT_SECURITY_MODE', false),
});

function getPublicFeatureFlags() {
  return {
    compatRollbackEnabled: FEATURE_FLAGS.compatRollbackEnabled,
    runtimeBackupRouteEnabled: FEATURE_FLAGS.runtimeBackupRouteEnabled,
    publicDependencyHealthEnabled: FEATURE_FLAGS.publicDependencyHealthEnabled,
    strictSecurityMode: FEATURE_FLAGS.strictSecurityMode,
  };
}

module.exports = {
  FEATURE_FLAGS,
  getPublicFeatureFlags,
  readBooleanEnvFlag,
};

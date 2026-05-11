function cloneObject(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {};
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildDeploymentPayload(deps) {
  const deployment = cloneObject(deps.deployment);
  return {
    commitSha: normalizeText(deployment.commitSha) || null,
    commitRef: normalizeText(deployment.commitRef) || null,
    provider: normalizeText(deployment.provider) || null,
  };
}

function buildBaselineHealthPayload(deps) {
  return {
    ok: true,
    service: deps.appName,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.max(0, Math.round(Number(process.uptime?.() || 0))),
    deployment: buildDeploymentPayload(deps),
  };
}

function buildDependencyHealthPayload(deps) {
  const supabase = cloneObject(deps.getSupabaseStatus());
  const mail = cloneObject(deps.getMailStatus());
  const ai = cloneObject(deps.getAiStatus());
  const sessions = cloneObject(deps.getSessionStatus());
  return {
    ok: true,
    service: deps.appName,
    version: deps.appVersion,
    timestamp: new Date().toISOString(),
    flags: deps.getPublicFeatureFlags(),
    deployment: buildDeploymentPayload(deps),
    dependencies: {
      supabase: {
        enabled: Boolean(supabase.enabled),
        hydrated: Boolean(supabase.hydrated),
        healthy: !supabase.enabled || (Boolean(supabase.hydrated) && !supabase.lastHydrateError),
        lastHydrateError: supabase.lastHydrateError || null,
        lastPersistError: supabase.lastPersistError || null,
        lastCallUpdatePersistError: supabase.lastCallUpdatePersistError || null,
      },
      mail: {
        smtpConfigured: Boolean(mail.smtpConfigured),
        imapConfigured: Boolean(mail.imapConfigured),
        imapMailbox: mail.imapMailbox || null,
        imapLastSync: mail.imapLastSync || null,
      },
      ai: {
        coldcallingProvider: ai.coldcallingProvider || null,
        openaiConfigured: Boolean(ai.openaiConfigured),
        anthropicConfigured: Boolean(ai.anthropicConfigured),
        retellConfigured: Boolean(ai.retellConfigured),
        twilioConfigured: Boolean(ai.twilioConfigured),
        missingProviderEnv: Array.isArray(ai.missingProviderEnv) ? ai.missingProviderEnv.slice() : [],
      },
      sessions: {
        configured: Boolean(sessions.configured),
        cookieName: sessions.cookieName || null,
        mfaConfigured: Boolean(sessions.mfaConfigured),
      },
    },
  };
}

function buildRuntimeHealthDebugPayload(deps) {
  const supabase = cloneObject(deps.getSupabaseStatus());
  const mail = cloneObject(deps.getMailStatus());
  return {
    ok: true,
    timestamp: new Date().toISOString(),
    flags: deps.getPublicFeatureFlags(),
    deployment: buildDeploymentPayload(deps),
    runtime: cloneObject(deps.getRuntimeStatus()),
    supabase,
    mail,
    criticalFlows: Array.isArray(deps.routeManifest?.criticalFlowChecklist)
      ? deps.routeManifest.criticalFlowChecklist.slice()
      : [],
  };
}

function registerHealthAndOpsRoutes(app, deps) {
  const sendBaseline = (_req, res) => {
    return res.status(200).json(buildBaselineHealthPayload(deps));
  };

  app.get('/healthz', sendBaseline);
  app.get('/api/healthz', sendBaseline);
  app.get('/api/health/baseline', sendBaseline);

  if (deps.featureFlags?.publicDependencyHealthEnabled) {
    app.get('/api/health/dependencies', deps.requireRuntimeDebugAccess, (_req, res) => {
      return res.status(200).json(buildDependencyHealthPayload(deps));
    });
  }

  const sendRuntimeHealthDebug = (_req, res) => {
    return res.status(200).json(buildRuntimeHealthDebugPayload(deps));
  };
  app.get('/api/debug/runtime-health', deps.requireRuntimeDebugAccess, sendRuntimeHealthDebug);
  app.get('/api/runtime-health', deps.requireRuntimeDebugAccess, sendRuntimeHealthDebug);

  if (deps.featureFlags?.runtimeBackupRouteEnabled) {
    const sendRuntimeBackup = (req, res) => {
      return res.status(200).json(
        deps.buildRuntimeBackupForOps({
          metadata: {
            source: 'runtime-backup-route',
            path: req.originalUrl || req.url || '/api/debug/runtime-backup',
          },
        })
      );
    };
    app.get('/api/debug/runtime-backup', deps.requireRuntimeDebugAccess, sendRuntimeBackup);
    app.get('/api/runtime-backup', deps.requireRuntimeDebugAccess, sendRuntimeBackup);
  }
}

module.exports = {
  buildBaselineHealthPayload,
  buildDependencyHealthPayload,
  buildDeploymentPayload,
  buildRuntimeHealthDebugPayload,
  registerHealthAndOpsRoutes,
};

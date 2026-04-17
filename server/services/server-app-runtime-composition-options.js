function buildServerAppUiContentRuntimeContext({
  env,
  runtimeEnv,
  runtimeMemory,
  projectRootDir,
  knownHtmlPageFiles,
  knownPrettyPageSlugToFile,
  uiSeoConfig,
  shared,
  platform,
  runtimeSync,
  uiCallbacks,
}) {
  return {
    env,
    runtimeEnv,
    runtimeMemory,
    projectRootDir,
    knownHtmlPageFiles,
    knownPrettyPageSlugToFile,
    uiSeoConfig,
    shared,
    platform,
    runtimeSync,
    uiCallbacks,
  };
}

function buildServerAppFeatureWiringContext({
  app,
  aiDashboardOptions,
  featureRouteOptions,
}) {
  return {
    app,
    aiDashboardOptions,
    featureRouteOptions,
  };
}

function buildServerAppAgendaWiringContext({
  app,
  agendaAppOptions,
}) {
  return {
    app,
    agendaAppOptions,
  };
}

function buildServerAppOpsWiringContext({
  appOpsOptions,
}) {
  return {
    appOpsOptions,
  };
}

module.exports = {
  buildServerAppAgendaWiringContext,
  buildServerAppFeatureWiringContext,
  buildServerAppOpsWiringContext,
  buildServerAppUiContentRuntimeContext,
};

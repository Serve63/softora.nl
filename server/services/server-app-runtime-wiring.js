const { createAiDashboardRuntime } = require('./ai-dashboard-runtime');
const { createAgendaAppRuntime } = require('./agenda-app-runtime');
const { createAppOpsRuntime } = require('./app-ops-runtime');
const { registerFeatureRoutes } = require('./feature-routes-runtime');
const {
  buildAgendaAppRuntimeOptions,
  buildAiDashboardRuntimeOptions,
  buildAppOpsRuntimeOptions,
  buildFeatureRoutesOptions,
} = require('./server-app-runtime-feature-options');

function createServerAppFeatureWiring(context, dependencies = {}) {
  const {
    createAiDashboardRuntimeImpl = createAiDashboardRuntime,
    registerFeatureRoutesImpl = registerFeatureRoutes,
  } = dependencies;

  const { app, aiDashboardOptions, featureRouteOptions } = context;
  const { activeOrdersCoordinator, aiDashboardCoordinator, aiToolsCoordinator } =
    createAiDashboardRuntimeImpl(buildAiDashboardRuntimeOptions(aiDashboardOptions));

  registerFeatureRoutesImpl(
    app,
    buildFeatureRoutesOptions({
      ...featureRouteOptions,
      aiDashboardCoordinator,
      aiToolsCoordinator,
      activeOrdersCoordinator,
    })
  );

  return {
    activeOrdersCoordinator,
    aiDashboardCoordinator,
    aiToolsCoordinator,
  };
}

function createServerAppAgendaWiring(context, dependencies = {}) {
  const { createAgendaAppRuntimeImpl = createAgendaAppRuntime } = dependencies;
  const { app, agendaAppOptions } = context;

  return createAgendaAppRuntimeImpl(app, buildAgendaAppRuntimeOptions(agendaAppOptions));
}

function createServerAppOpsWiring(context, dependencies = {}) {
  const { createAppOpsRuntimeImpl = createAppOpsRuntime } = dependencies;
  const { appOpsOptions } = context;

  return createAppOpsRuntimeImpl(buildAppOpsRuntimeOptions(appOpsOptions));
}

module.exports = {
  createServerAppAgendaWiring,
  createServerAppFeatureWiring,
  createServerAppOpsWiring,
};

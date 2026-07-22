const { createAiDashboardRuntime } = require('./ai-dashboard-runtime');
const { createAgendaAppRuntime } = require('./agenda-app-runtime');
const { createAppOpsRuntime } = require('./app-ops-runtime');
const { registerFeatureRoutes } = require('./feature-routes-runtime');
const { createWebsitePreviewBatchCoordinator } = require('./website-preview-batch');
const {
  createPremiumDatabaseWebdesignJobsCoordinator,
} = require('./premium-database-webdesign-jobs');
const {
  createPremiumDatabaseCinematicJobsCoordinator,
} = require('./premium-database-cinematic-jobs');
const { createMailboxService } = require('./mailbox');
const { createPublicContactService } = require('./public-contact');
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

  const websitePreviewBatchCoordinator = createWebsitePreviewBatchCoordinator({
    logger: aiDashboardOptions.logger || console,
    normalizeString: aiDashboardOptions.normalizeString,
    aiToolsCoordinator,
    websitePreviewLibraryCoordinator: featureRouteOptions.websitePreviewLibraryCoordinator,
    getUiStateValues: featureRouteOptions.getUiStateValues,
    setUiStateValues: featureRouteOptions.setUiStateValues,
  });
  const premiumDatabaseWebdesignJobsCoordinator = createPremiumDatabaseWebdesignJobsCoordinator({
    logger: aiDashboardOptions.logger || console,
    normalizeString: aiDashboardOptions.normalizeString,
    truncateText: aiDashboardOptions.truncateText,
    aiToolsCoordinator,
    getUiStateValues: featureRouteOptions.getUiStateValues,
    setUiStateValues: featureRouteOptions.setUiStateValues,
    dataOpsStore: featureRouteOptions.dataOpsStore,
  });
  const premiumDatabaseCinematicJobsCoordinator = createPremiumDatabaseCinematicJobsCoordinator({
    logger: aiDashboardOptions.logger || console,
    normalizeString: aiDashboardOptions.normalizeString,
    truncateText: aiDashboardOptions.truncateText,
    fetchWebsitePreviewScanFromUrl: aiDashboardOptions.fetchWebsitePreviewScanFromUrl,
    fetchJsonWithTimeout: aiDashboardOptions.fetchJsonWithTimeout,
    getOpenAiApiKey: aiDashboardOptions.getOpenAiApiKey,
    openAiApiBaseUrl: aiDashboardOptions.openAiApiBaseUrl,
    openAiImageModel: aiDashboardOptions.openAiImageModel,
    getUiStateValues: featureRouteOptions.getUiStateValues,
    setUiStateValues: featureRouteOptions.setUiStateValues,
    dataOpsStore: featureRouteOptions.dataOpsStore,
  });
  const coldmailCampaignService =
    featureRouteOptions.coldmailing && featureRouteOptions.coldmailing.coldmailCampaignService;
  if (
    coldmailCampaignService &&
    typeof coldmailCampaignService.setWebdesignPreparationCoordinator === 'function'
  ) {
    coldmailCampaignService.setWebdesignPreparationCoordinator(premiumDatabaseWebdesignJobsCoordinator);
  }
  const mailboxCoordinator = createMailboxService(featureRouteOptions.mailbox || {});
  const publicContactCoordinator = createPublicContactService(
    featureRouteOptions.publicContact || {}
  );

  registerFeatureRoutesImpl(
    app,
    buildFeatureRoutesOptions({
      ...featureRouteOptions,
      aiDashboardCoordinator,
      aiToolsCoordinator,
      activeOrdersCoordinator,
      websitePreviewBatchCoordinator,
      premiumDatabaseWebdesignJobsCoordinator,
      premiumDatabaseCinematicJobsCoordinator,
      mailboxCoordinator,
      publicContactCoordinator,
    })
  );

  return {
    activeOrdersCoordinator,
    aiDashboardCoordinator,
    aiToolsCoordinator,
    mailboxCoordinator,
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

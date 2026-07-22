const {
  registerColdcallingRoutes,
  registerColdcallingWebhookRoutes,
} = require('../routes/coldcalling');
const { registerColdmailingRoutes } = require('../routes/coldmailing');
const { registerInstantlyRoutes } = require('../routes/instantly');
const { registerAiDashboardRoutes } = require('../routes/ai-dashboard');
const { registerAiToolRoutes } = require('../routes/ai-tools');
const { registerWebsiteLinkRoutes } = require('../routes/website-links');
const { registerWebsitePreviewLibraryRoutes } = require('../routes/website-preview-library');
const { registerWebsitePreviewBatchRoutes } = require('../routes/website-preview-batch');
const {
  registerPremiumDatabaseWebdesignJobRoutes,
} = require('../routes/premium-database-webdesign-jobs');
const {
  registerPremiumDatabaseCinematicJobRoutes,
} = require('../routes/premium-database-cinematic-jobs');
const {
  registerCompanyWebsiteVideoRoutes,
} = require('../routes/company-website-video');
const {
  registerPublicWebdesignPreviewRoutes,
} = require('../routes/public-webdesign-preview');
const { registerOpenAiCostRoutes } = require('../routes/openai-costs');
const { registerSupabaseCostRoutes } = require('../routes/supabase-costs');
const { registerSupabaseMaintenanceRoutes } = require('../routes/supabase-maintenance');
const { registerMailboxRoutes } = require('../routes/mailbox');
const { registerPublicContactRoutes } = require('../routes/public-contact');
const { registerActiveOrderRoutes } = require('../routes/active-orders');
const { registerPremiumDatabaseImportRoutes } = require('../routes/premium-database-import');
const { registerKvkDatabaseRoutes } = require('../routes/kvk-database');
const {
  registerPremiumDatabaseMassResearchRoutes,
} = require('../routes/premium-database-mass-research');
const { registerRuntimeOpsRoutes } = require('../routes/runtime-ops');
const { registerRuntimeDebugOpsRoutes } = require('../routes/runtime-debug-ops');
const { registerSeoReadRoutes } = require('../routes/seo-read');
const { registerSeoWriteRoutes } = require('../routes/seo-write');
const { registerGoogleAdsRoutes } = require('../routes/google-ads');
const {
  registerWhoopHealthProtectedRoutes,
  registerWhoopHealthPublicRoutes,
} = require('../routes/whoop-health');
const {
  createPremiumDatabaseImportCoordinator,
} = require('./premium-database-import');
const {
  createPremiumDatabaseMailReadySnapshotService,
} = require('./premium-database-mail-ready-snapshot');
const { createKvkDatabaseSnapshotService } = require('./kvk-database-snapshot');
const {
  createPremiumDatabaseMassResearchCoordinator,
} = require('./premium-database-mass-research');
const {
  createPublicWebdesignPreviewService,
} = require('./public-webdesign-preview');
const { createPremiumRouteRuntime } = require('./premium-route-runtime');
const {
  createCompanyWebsiteVideoCoordinator,
} = require('./company-website-video');
const { createGoogleHealthSheetService } = require('./google-health-sheet');
const { createWhoopHealthService } = require('./whoop-health');
const { createGoogleAdsControlService } = require('./google-ads-control');

function registerFeatureRoutes(app, deps = {}) {
  const {
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    handleRetellWebhook,
    premiumRouteRuntime,
    coldcalling,
    coldmailing,
    instantly,
    aiDashboardCoordinator,
    aiToolsCoordinator,
    websiteLinkCoordinator,
    websitePreviewLibraryCoordinator,
    websitePreviewBatchCoordinator = null,
    premiumDatabaseWebdesignJobsCoordinator = null,
    premiumDatabaseCinematicJobsCoordinator = null,
    openAiCostSummary = null,
    supabaseCostSummary = null,
    supabaseMaintenance = null,
    mailboxCoordinator = null,
    mailboxCronSecret = '',
    publicContactCoordinator = null,
    activeOrdersCoordinator,
    runtimeOpsCoordinator,
    runtimeDebugOpsCoordinator,
    requireRuntimeDebugAccess,
    seoReadCoordinator,
    seoWriteCoordinator,
    kvkDatabaseSnapshot,
    whoopHealth = {},
  } = deps;
  const premiumDatabaseMailReadySnapshotService = createPremiumDatabaseMailReadySnapshotService({
    dataOpsStore: deps.dataOpsStore,
    getUiStateValues: deps.getUiStateValues,
    setUiStateValues: deps.setUiStateValues,
  });
  const premiumDatabaseImportCoordinator = createPremiumDatabaseImportCoordinator({
    getUiStateValues: deps.getUiStateValues,
    setUiStateValues: deps.setUiStateValues,
    dataOpsStore: deps.dataOpsStore,
    mailReadySnapshotService: premiumDatabaseMailReadySnapshotService,
  });
  if (
    premiumDatabaseWebdesignJobsCoordinator &&
    typeof premiumDatabaseWebdesignJobsCoordinator.setMailReadySnapshotService === 'function'
  ) {
    premiumDatabaseWebdesignJobsCoordinator.setMailReadySnapshotService(premiumDatabaseMailReadySnapshotService);
  }
  if (
    coldmailing &&
    coldmailing.coldmailCampaignService &&
    typeof coldmailing.coldmailCampaignService.setMailReadySnapshotService === 'function'
  ) {
    coldmailing.coldmailCampaignService.setMailReadySnapshotService(premiumDatabaseMailReadySnapshotService);
  }
  const premiumDatabaseMassResearchCoordinator = createPremiumDatabaseMassResearchCoordinator({
    dataOpsStore: deps.dataOpsStore,
    getUiStateValues: deps.getUiStateValues,
    setUiStateValues: deps.setUiStateValues,
  });
  const publicWebdesignPreviewCoordinator = createPublicWebdesignPreviewService({
    getUiStateValues: deps.getUiStateValues,
    dataOpsStore: deps.dataOpsStore,
  });
  const kvkDatabaseSnapshotCoordinator = createKvkDatabaseSnapshotService({
    ...(kvkDatabaseSnapshot || {}),
    fallbackSyncToken: mailboxCronSecret,
  });
  const companyWebsiteVideoCoordinator = createCompanyWebsiteVideoCoordinator({
    dataOpsStore: deps.dataOpsStore,
    logger: deps.logger || console,
  });
  const googleHealthSheetService = createGoogleHealthSheetService({
    config: whoopHealth.googleSheet,
    fetchImpl: whoopHealth.fetchImpl,
  });
  const whoopHealthService = createWhoopHealthService({
    config: whoopHealth.whoop,
    fetchImpl: whoopHealth.fetchImpl,
    getSupabaseClient: whoopHealth.getSupabaseClient,
    sheetService: googleHealthSheetService,
  });
  const googleAdsService = createGoogleAdsControlService({
    getUiStateValues: deps.getUiStateValues,
    setUiStateValues: deps.setUiStateValues,
    env: deps.env || process.env,
  });

  registerColdcallingWebhookRoutes(app, {
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    handleRetellWebhook,
  });

  registerPublicContactRoutes(app, { coordinator: publicContactCoordinator });

  registerSupabaseMaintenanceRoutes(app, {
    ...(supabaseMaintenance || {}),
  });

  registerWhoopHealthPublicRoutes(app, {
    service: whoopHealthService,
    cronSecret: mailboxCronSecret,
  });

  registerGoogleAdsRoutes(app, {
    service: googleAdsService,
    cronSecret: mailboxCronSecret,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });

  createPremiumRouteRuntime({
    app,
    ...premiumRouteRuntime,
  });

  registerWhoopHealthProtectedRoutes(app, {
    service: whoopHealthService,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });

  registerColdcallingRoutes(app, {
    ...coldcalling,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerColdmailingRoutes(app, {
    ...coldmailing,
    requirePremiumApiAccess: premiumRouteRuntime?.requirePremiumApiAccess,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerInstantlyRoutes(app, {
    ...instantly,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerAiDashboardRoutes(app, { coordinator: aiDashboardCoordinator });
  registerAiToolRoutes(app, { coordinator: aiToolsCoordinator });
  registerWebsiteLinkRoutes(app, { coordinator: websiteLinkCoordinator });
  registerWebsitePreviewLibraryRoutes(app, { coordinator: websitePreviewLibraryCoordinator });
  registerWebsitePreviewBatchRoutes(app, { coordinator: websitePreviewBatchCoordinator });
  registerPremiumDatabaseWebdesignJobRoutes(app, {
    coordinator: premiumDatabaseWebdesignJobsCoordinator,
    cronSecret: mailboxCronSecret,
    requirePremiumApiAccess: premiumRouteRuntime?.requirePremiumApiAccess,
  });
  registerPremiumDatabaseCinematicJobRoutes(app, {
    coordinator: premiumDatabaseCinematicJobsCoordinator,
    requirePremiumApiAccess: premiumRouteRuntime?.requirePremiumApiAccess,
  });
  registerCompanyWebsiteVideoRoutes(app, {
    coordinator: companyWebsiteVideoCoordinator,
    requirePremiumApiAccess: premiumRouteRuntime?.requirePremiumApiAccess,
  });
  registerPublicWebdesignPreviewRoutes(app, {
    coordinator: publicWebdesignPreviewCoordinator,
  });
  registerOpenAiCostRoutes(app, {
    ...(openAiCostSummary || {}),
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerSupabaseCostRoutes(app, {
    ...(supabaseCostSummary || {}),
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerMailboxRoutes(app, {
    coordinator: mailboxCoordinator,
    cronSecret: mailboxCronSecret,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerActiveOrderRoutes(app, { coordinator: activeOrdersCoordinator });
  registerPremiumDatabaseImportRoutes(app, {
    coordinator: premiumDatabaseImportCoordinator,
    mailReadySnapshotService: premiumDatabaseMailReadySnapshotService,
    requirePremiumApiAccess: premiumRouteRuntime?.requirePremiumApiAccess,
  });
  registerKvkDatabaseRoutes(app, {
    coordinator: kvkDatabaseSnapshotCoordinator,
  });
  registerPremiumDatabaseMassResearchRoutes(app, {
    coordinator: premiumDatabaseMassResearchCoordinator,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerRuntimeOpsRoutes(app, {
    coordinator: runtimeOpsCoordinator,
    requireRuntimeDebugAccess,
  });
  registerRuntimeDebugOpsRoutes(app, {
    coordinator: runtimeDebugOpsCoordinator,
    requireRuntimeDebugAccess,
  });
  registerSeoReadRoutes(app, {
    readCoordinator: seoReadCoordinator,
  });
  registerSeoWriteRoutes(app, {
    writeCoordinator: seoWriteCoordinator,
  });
}

module.exports = {
  registerFeatureRoutes,
};

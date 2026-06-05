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
  registerPublicWebdesignPreviewRoutes,
} = require('../routes/public-webdesign-preview');
const { registerOpenAiCostRoutes } = require('../routes/openai-costs');
const { registerSupabaseCostRoutes } = require('../routes/supabase-costs');
const { registerSupabaseMaintenanceRoutes } = require('../routes/supabase-maintenance');
const { registerMailboxRoutes } = require('../routes/mailbox');
const { registerPublicContactRoutes } = require('../routes/public-contact');
const { registerActiveOrderRoutes } = require('../routes/active-orders');
const { registerPremiumDatabaseImportRoutes } = require('../routes/premium-database-import');
const { registerRuntimeOpsRoutes } = require('../routes/runtime-ops');
const { registerRuntimeDebugOpsRoutes } = require('../routes/runtime-debug-ops');
const { registerSeoReadRoutes } = require('../routes/seo-read');
const { registerSeoWriteRoutes } = require('../routes/seo-write');
const {
  createPremiumDatabaseImportCoordinator,
} = require('./premium-database-import');
const {
  createPublicWebdesignPreviewService,
} = require('./public-webdesign-preview');
const { createPremiumRouteRuntime } = require('./premium-route-runtime');

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
  } = deps;
  const premiumDatabaseImportCoordinator = createPremiumDatabaseImportCoordinator({
    getUiStateValues: deps.getUiStateValues,
    setUiStateValues: deps.setUiStateValues,
  });
  const publicWebdesignPreviewCoordinator = createPublicWebdesignPreviewService({
    getUiStateValues: deps.getUiStateValues,
    dataOpsStore: deps.dataOpsStore,
  });

  registerColdcallingWebhookRoutes(app, {
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    handleRetellWebhook,
  });

  registerPublicContactRoutes(app, { coordinator: publicContactCoordinator });

  createPremiumRouteRuntime({
    app,
    ...premiumRouteRuntime,
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
  registerSupabaseMaintenanceRoutes(app, {
    ...(supabaseMaintenance || {}),
  });
  registerMailboxRoutes(app, {
    coordinator: mailboxCoordinator,
    cronSecret: mailboxCronSecret,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerActiveOrderRoutes(app, { coordinator: activeOrdersCoordinator });
  registerPremiumDatabaseImportRoutes(app, {
    coordinator: premiumDatabaseImportCoordinator,
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

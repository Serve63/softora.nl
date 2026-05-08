const {
  registerColdcallingRoutes,
  registerColdcallingWebhookRoutes,
} = require('../routes/coldcalling');
const { registerColdmailingRoutes } = require('../routes/coldmailing');
const { registerAiDashboardRoutes } = require('../routes/ai-dashboard');
const { registerAiToolRoutes } = require('../routes/ai-tools');
const { registerWebsiteLinkRoutes } = require('../routes/website-links');
const { registerWebsitePreviewLibraryRoutes } = require('../routes/website-preview-library');
const { registerWebsitePreviewBatchRoutes } = require('../routes/website-preview-batch');
const {
  registerPremiumDatabaseWebdesignJobRoutes,
} = require('../routes/premium-database-webdesign-jobs');
const { registerOpenAiCostRoutes } = require('../routes/openai-costs');
const { registerMailboxRoutes } = require('../routes/mailbox');
const { registerActiveOrderRoutes } = require('../routes/active-orders');
const { registerPremiumDatabaseImportRoutes } = require('../routes/premium-database-import');
const { registerRuntimeOpsRoutes } = require('../routes/runtime-ops');
const { registerRuntimeDebugOpsRoutes } = require('../routes/runtime-debug-ops');
const { registerSeoReadRoutes } = require('../routes/seo-read');
const { registerSeoWriteRoutes } = require('../routes/seo-write');
const {
  createPremiumDatabaseImportCoordinator,
} = require('./premium-database-import');
const { createPremiumRouteRuntime } = require('./premium-route-runtime');

function registerFeatureRoutes(app, deps = {}) {
  const {
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    handleRetellWebhook,
    premiumRouteRuntime,
    coldcalling,
    coldmailing,
    aiDashboardCoordinator,
    aiToolsCoordinator,
    websiteLinkCoordinator,
    websitePreviewLibraryCoordinator,
    websitePreviewBatchCoordinator = null,
    premiumDatabaseWebdesignJobsCoordinator = null,
    openAiCostSummary = null,
    mailboxCoordinator = null,
    activeOrdersCoordinator,
    runtimeOpsCoordinator,
    runtimeDebugOpsCoordinator,
    requireRuntimeDebugAccess,
    seoReadCoordinator,
    seoWriteCoordinator,
  } = deps;
  const premiumDatabaseImportCoordinator = createPremiumDatabaseImportCoordinator();

  registerColdcallingWebhookRoutes(app, {
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    handleRetellWebhook,
  });

  createPremiumRouteRuntime({
    app,
    ...premiumRouteRuntime,
  });

  registerColdcallingRoutes(app, {
    ...coldcalling,
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerColdmailingRoutes(app, coldmailing);
  registerAiDashboardRoutes(app, { coordinator: aiDashboardCoordinator });
  registerAiToolRoutes(app, { coordinator: aiToolsCoordinator });
  registerWebsiteLinkRoutes(app, { coordinator: websiteLinkCoordinator });
  registerWebsitePreviewLibraryRoutes(app, { coordinator: websitePreviewLibraryCoordinator });
  registerWebsitePreviewBatchRoutes(app, { coordinator: websitePreviewBatchCoordinator });
  registerPremiumDatabaseWebdesignJobRoutes(app, {
    coordinator: premiumDatabaseWebdesignJobsCoordinator,
  });
  registerOpenAiCostRoutes(app, {
    ...(openAiCostSummary || {}),
    requirePremiumAdminApiAccess: premiumRouteRuntime?.requirePremiumAdminApiAccess,
  });
  registerMailboxRoutes(app, {
    coordinator: mailboxCoordinator,
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

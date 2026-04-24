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
const { registerActiveOrderRoutes } = require('../routes/active-orders');
const { registerRuntimeOpsRoutes } = require('../routes/runtime-ops');
const { registerRuntimeDebugOpsRoutes } = require('../routes/runtime-debug-ops');
const { registerSeoReadRoutes } = require('../routes/seo-read');
const { registerSeoWriteRoutes } = require('../routes/seo-write');
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
    activeOrdersCoordinator,
    runtimeOpsCoordinator,
    runtimeDebugOpsCoordinator,
    requireRuntimeDebugAccess,
    seoReadCoordinator,
    seoWriteCoordinator,
  } = deps;

  registerColdcallingWebhookRoutes(app, {
    handleTwilioInboundVoice,
    handleTwilioStatusWebhook,
    handleRetellWebhook,
  });

  createPremiumRouteRuntime({
    app,
    ...premiumRouteRuntime,
  });

  registerColdcallingRoutes(app, coldcalling);
  registerColdmailingRoutes(app, coldmailing);
  registerAiDashboardRoutes(app, { coordinator: aiDashboardCoordinator });
  registerAiToolRoutes(app, { coordinator: aiToolsCoordinator });
  registerWebsiteLinkRoutes(app, { coordinator: websiteLinkCoordinator });
  registerWebsitePreviewLibraryRoutes(app, { coordinator: websitePreviewLibraryCoordinator });
  registerWebsitePreviewBatchRoutes(app, { coordinator: websitePreviewBatchCoordinator });
  registerActiveOrderRoutes(app, { coordinator: activeOrdersCoordinator });
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

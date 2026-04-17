const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createServerAppAgendaWiring,
  createServerAppFeatureWiring,
  createServerAppOpsWiring,
} = require('../../server/services/server-app-runtime-wiring');

test('server app runtime wiring composes AI dashboard coordinators into feature routes', () => {
  const app = { name: 'softora-app' };
  const activeOrdersCoordinator = { scope: 'orders' };
  const aiDashboardCoordinator = { scope: 'dashboard' };
  const aiToolsCoordinator = { scope: 'tools' };
  let capturedAiOptions = null;
  let capturedRouteApp = null;
  let capturedRouteOptions = null;

  const result = createServerAppFeatureWiring(
    {
      app,
      aiDashboardOptions: {
        activeOrderAutomation: { enabled: true },
        openAiModel: 'gpt-test',
        premiumActiveOrdersScope: 'premium_active_orders',
        parseCustomOrdersFromUiState: () => [],
      },
      featureRouteOptions: {
        handleTwilioInboundVoice: () => null,
        handleTwilioStatusWebhook: () => null,
        handleRetellWebhook: () => null,
        premiumRouteRuntime: { sessionSecret: 'secret' },
        coldcalling: { openAiModel: 'gpt-test' },
        websiteLinkCoordinator: { scope: 'website-link' },
        runtimeOpsCoordinator: { scope: 'runtime-ops' },
        runtimeDebugOpsCoordinator: { scope: 'runtime-debug' },
        requireRuntimeDebugAccess: () => true,
        seoReadCoordinator: { scope: 'seo-read' },
        seoWriteCoordinator: { scope: 'seo-write' },
      },
    },
    {
      createAiDashboardRuntimeImpl: (options) => {
        capturedAiOptions = options;
        return {
          activeOrdersCoordinator,
          aiDashboardCoordinator,
          aiToolsCoordinator,
        };
      },
      registerFeatureRoutesImpl: (appArg, options) => {
        capturedRouteApp = appArg;
        capturedRouteOptions = options;
      },
    }
  );

  assert.equal(result.activeOrdersCoordinator, activeOrdersCoordinator);
  assert.equal(result.aiDashboardCoordinator, aiDashboardCoordinator);
  assert.equal(result.aiToolsCoordinator, aiToolsCoordinator);
  assert.equal(capturedAiOptions.activeOrderAutomation.enabled, true);
  assert.equal(capturedAiOptions.openAiModel, 'gpt-test');
  assert.equal(capturedAiOptions.premiumActiveOrdersScope, 'premium_active_orders');
  assert.equal(capturedRouteApp, app);
  assert.equal(capturedRouteOptions.aiDashboardCoordinator, aiDashboardCoordinator);
  assert.equal(capturedRouteOptions.aiToolsCoordinator, aiToolsCoordinator);
  assert.equal(capturedRouteOptions.activeOrdersCoordinator, activeOrdersCoordinator);
  assert.equal(capturedRouteOptions.premiumRouteRuntime.sessionSecret, 'secret');
  assert.equal(capturedRouteOptions.coldcalling.openAiModel, 'gpt-test');
});

test('server app runtime wiring builds agenda app runtime options before delegation', () => {
  const app = { name: 'agenda-app' };
  const expectedResult = { buildRuntimeHtmlPageBootstrapData: () => ({}) };
  let capturedApp = null;
  let capturedOptions = null;

  const result = createServerAppAgendaWiring(
    {
      app,
      agendaAppOptions: {
        openAiModel: 'gpt-test',
        leadDatabaseUiScope: 'coldcalling',
        leadDatabaseRowsStorageKey: 'softora_coldcalling_lead_rows_json',
        demoConfirmationTaskEnabled: true,
      },
    },
    {
      createAgendaAppRuntimeImpl: (appArg, options) => {
        capturedApp = appArg;
        capturedOptions = options;
        return expectedResult;
      },
    }
  );

  assert.equal(result, expectedResult);
  assert.equal(capturedApp, app);
  assert.equal(capturedOptions.openAiModel, 'gpt-test');
  assert.equal(capturedOptions.leadDatabaseUiScope, 'coldcalling');
  assert.equal(capturedOptions.leadDatabaseRowsStorageKey, 'softora_coldcalling_lead_rows_json');
  assert.equal(capturedOptions.demoConfirmationTaskEnabled, true);
});

test('server app runtime wiring keeps app ops metadata and callbacks intact', () => {
  const ensureRuntimeStateHydratedFromSupabase = async () => true;
  const expectedResult = { seedDemoConfirmationTaskForUiTesting: () => null };
  let capturedOptions = null;

  const result = createServerAppOpsWiring(
    {
      appOpsOptions: {
        app: { name: 'softora-app' },
        appVersion: '1.2.3',
        demoConfirmationTaskEnabled: true,
        ensureRuntimeStateHydratedFromSupabase,
        log: () => null,
      },
    },
    {
      createAppOpsRuntimeImpl: (options) => {
        capturedOptions = options;
        return expectedResult;
      },
    }
  );

  assert.equal(result, expectedResult);
  assert.equal(capturedOptions.appVersion, '1.2.3');
  assert.equal(capturedOptions.demoConfirmationTaskEnabled, true);
  assert.equal(
    capturedOptions.ensureRuntimeStateHydratedFromSupabase,
    ensureRuntimeStateHydratedFromSupabase
  );
});

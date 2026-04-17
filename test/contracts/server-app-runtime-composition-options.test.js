const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildServerAppAgendaWiringContext,
  buildServerAppFeatureWiringContext,
  buildServerAppOpsWiringContext,
  buildServerAppUiContentRuntimeContext,
} = require('../../server/services/server-app-runtime-composition-options');

test('server app runtime composition builder preserves ui-content nested groups', () => {
  const shared = { normalizeString: String };
  const platform = { isSupabaseConfigured: () => true };
  const runtimeSync = { ensureRuntimeStateHydratedFromSupabase: async () => true };
  const uiCallbacks = { getPageBootstrapData: async () => ({ ok: true }) };

  const context = buildServerAppUiContentRuntimeContext({
    env: { NODE_ENV: 'test' },
    runtimeEnv: { app: { port: 3000 } },
    runtimeMemory: { recentCallUpdates: [] },
    projectRootDir: '/tmp/project',
    knownHtmlPageFiles: ['premium-test.html'],
    knownPrettyPageSlugToFile: new Map([['premium-test', 'premium-test.html']]),
    uiSeoConfig: { seoConfigScope: 'seo' },
    shared,
    platform,
    runtimeSync,
    uiCallbacks,
  });

  assert.equal(context.projectRootDir, '/tmp/project');
  assert.equal(context.shared, shared);
  assert.equal(context.platform, platform);
  assert.equal(context.runtimeSync, runtimeSync);
  assert.equal(context.uiCallbacks, uiCallbacks);
});

test('server app runtime composition builder preserves feature wiring payloads', () => {
  const aiDashboardOptions = { openAiModel: 'gpt-test' };
  const featureRouteOptions = { seoReadCoordinator: {} };

  const context = buildServerAppFeatureWiringContext({
    app: { locals: {} },
    aiDashboardOptions,
    featureRouteOptions,
  });

  assert.equal(context.aiDashboardOptions, aiDashboardOptions);
  assert.equal(context.featureRouteOptions, featureRouteOptions);
});

test('server app runtime composition builder preserves agenda wiring payloads', () => {
  const agendaAppOptions = { runtimeSyncCooldownMs: 4000 };

  const context = buildServerAppAgendaWiringContext({
    app: { locals: {} },
    agendaAppOptions,
  });

  assert.equal(context.agendaAppOptions, agendaAppOptions);
});

test('server app runtime composition builder preserves app ops payloads', () => {
  const appOpsOptions = { appVersion: '1.2.3', featureFlags: { foo: true } };

  const context = buildServerAppOpsWiringContext({ appOpsOptions });

  assert.equal(context.appOpsOptions, appOpsOptions);
});

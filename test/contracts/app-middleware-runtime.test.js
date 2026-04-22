const test = require('node:test');
const assert = require('node:assert/strict');

const { applyAppMiddleware } = require('../../server/services/app-middleware-runtime');

function createAppRecorder() {
  return {
    disabled: [],
    uses: [],
    disable(key) {
      this.disabled.push(key);
    },
    use(...args) {
      this.uses.push(args);
    },
  };
}

function createDeps(overrides = {}) {
  return {
    express: {
      json: () => (_req, _res, next) => next(),
    },
    isProduction: false,
    isPremiumPublicApiRequest: () => false,
    appendSecurityAuditEvent: () => null,
    getPremiumAuthState: () => ({ email: '' }),
    normalizePremiumSessionEmail: (value) => String(value || '').trim().toLowerCase(),
    getClientIpFromRequest: () => '127.0.0.1',
    getRequestPathname: (req) => req.path || '/',
    getRequestOriginFromHeaders: () => 'https://softora.test',
    getStateChangingApiProtectionDecision: () => ({ allowed: true }),
    noindexHeaderValue: 'noindex, nofollow',
    isSupabaseConfigured: () => true,
    ensureRuntimeStateHydratedFromSupabase: async () => true,
    ...overrides,
  };
}

function getLastMiddleware(app) {
  const lastUse = app.uses[app.uses.length - 1] || [];
  return lastUse[lastUse.length - 1];
}

test('app middleware releases API requests after a short Supabase hydration wait', async () => {
  const app = createAppRecorder();
  let resolveHydration = null;
  let nextCalls = 0;

  applyAppMiddleware(
    app,
    createDeps({
      supabaseHydrateMiddlewareWaitMs: 5,
      ensureRuntimeStateHydratedFromSupabase: () =>
        new Promise((resolve) => {
          resolveHydration = resolve;
        }),
    })
  );

  const middleware = getLastMiddleware(app);

  await new Promise((resolve) => {
    middleware({ path: '/api/agenda/confirmation-tasks' }, {}, () => {
      nextCalls += 1;
      resolve();
    });
  });

  assert.equal(nextCalls, 1);

  resolveHydration(true);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(nextCalls, 1, 'next() mag maar één keer worden aangeroepen');
});

test('app middleware skips Supabase hydration for non-api requests', async () => {
  const app = createAppRecorder();
  let hydrateCalls = 0;

  applyAppMiddleware(
    app,
    createDeps({
      ensureRuntimeStateHydratedFromSupabase: async () => {
        hydrateCalls += 1;
        return true;
      },
    })
  );

  const middleware = getLastMiddleware(app);

  await new Promise((resolve) => {
    middleware({ path: '/premium-website' }, {}, resolve);
  });

  assert.equal(hydrateCalls, 0);
});

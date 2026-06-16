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

test('app middleware releases non-critical API requests without starting Supabase hydration', async () => {
  const app = createAppRecorder();
  let hydrateCalls = 0;
  let nextCalls = 0;

  applyAppMiddleware(
    app,
    createDeps({
      supabaseHydrateMiddlewareWaitMs: 5,
      ensureRuntimeStateHydratedFromSupabase: async () => {
        hydrateCalls += 1;
        return true;
      },
    })
  );

  const middleware = getLastMiddleware(app);

  middleware({ path: '/api/non-critical-status' }, {}, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(hydrateCalls, 0);
});

test('app middleware skips Supabase hydration for isolated API requests', async () => {
  const app = createAppRecorder();
  let hydrateCalls = 0;
  let nextCalls = 0;

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
  for (const requestPath of [
    '/api/auth/login',
    '/api/auth/session',
    '/api/health/baseline',
    '/api/mailbox/sync',
    '/api/coldmailing/autopilot/run',
  ]) {
    await new Promise((resolve) => {
      middleware({ method: 'POST', path: requestPath }, {}, () => {
        nextCalls += 1;
        resolve();
      });
    });
  }

  assert.equal(nextCalls, 5);
  assert.equal(hydrateCalls, 0);
});

test('app middleware releases read-only critical API requests without starting Supabase hydration', async () => {
  const app = createAppRecorder();
  let hydrateCalls = 0;
  let nextCalls = 0;
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  applyAppMiddleware(
    app,
    createDeps({
      supabaseHydrateMiddlewareWaitMs: 5,
      ensureRuntimeStateHydratedFromSupabase: async () => {
        hydrateCalls += 1;
        return true;
      },
    })
  );

  const middleware = getLastMiddleware(app);

  middleware({ method: 'GET', path: '/api/ui-state-get' }, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(hydrateCalls, 0);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});

test('app middleware blocks state-changing critical API requests when Supabase hydration times out', async () => {
  const app = createAppRecorder();
  let nextCalls = 0;
  const hydrateOptions = [];
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  applyAppMiddleware(
    app,
    createDeps({
      supabaseHydrateMiddlewareWaitMs: 5,
      ensureRuntimeStateHydratedFromSupabase: (options) => {
        hydrateOptions.push(options);
        return new Promise(() => {});
      },
    })
  );

  const middleware = getLastMiddleware(app);

  await new Promise((resolve) => {
    middleware({ method: 'POST', path: '/api/ui-state-set' }, res, () => {
      nextCalls += 1;
      resolve();
    });
    setTimeout(resolve, 280);
  });

  assert.equal(nextCalls, 0);
  assert.deepEqual(hydrateOptions, [{ strict: true }]);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Supabase-opslag/i);
});

test('app middleware skips strict hydration for monthly costs ui-state writes', async () => {
  const app = createAppRecorder();
  let hydrateCalls = 0;
  let nextCalls = 0;

  applyAppMiddleware(
    app,
    createDeps({
      supabaseHydrateMiddlewareWaitMs: 5,
      ensureRuntimeStateHydratedFromSupabase: async () => {
        hydrateCalls += 1;
        return false;
      },
    })
  );

  const middleware = getLastMiddleware(app);
  const requests = [
    { method: 'POST', path: '/api/ui-state-set', query: { scope: 'premium_monthly_costs' } },
    { method: 'POST', path: '/api/ui-state/premium_monthly_costs', query: {} },
  ];

  for (const req of requests) {
    await new Promise((resolve) => {
      middleware(req, {}, () => {
        nextCalls += 1;
        resolve();
      });
    });
  }

  assert.equal(nextCalls, 2);
  assert.equal(hydrateCalls, 0);
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

test('app middleware geeft audio-notitie uploads een grotere JSON-limiet', async () => {
  const app = createAppRecorder();
  const selectedLimits = [];

  applyAppMiddleware(
    app,
    createDeps({
      express: {
        json: (options = {}) => (_req, _res, next) => {
          selectedLimits.push(options.limit);
          next();
        },
      },
    })
  );

  const bodyParserSelector = app.uses[2][0];
  await new Promise((resolve) => {
    bodyParserSelector(
      { method: 'POST', path: '/api/ai/notes-audio-to-text' },
      {},
      resolve
    );
  });

  assert.equal(selectedLimits.at(-1), '34mb');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

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

test('app middleware emits a nonce-based script csp without unsafe-inline script execution', async () => {
  const app = express();
  applyAppMiddleware(
    app,
    createDeps({
      express,
      isProduction: true,
      isSupabaseConfigured: () => false,
    })
  );
  app.get('/csp-test', (_req, res) => {
    res.status(200).send('<!doctype html><html><body>CSP</body></html>');
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/csp-test`);
    const csp = response.headers.get('content-security-policy') || '';
    const scriptSrc = csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src')) || '';

    assert.match(scriptSrc, /^script-src 'self' 'nonce-[^']+' https:\/\/cdnjs\.cloudflare\.com$/);
    assert.doesNotMatch(scriptSrc, /unsafe-inline/);
    assert.match(csp, /script-src-attr 'unsafe-inline'/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

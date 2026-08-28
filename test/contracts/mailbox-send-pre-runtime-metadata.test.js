const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { applyAppMiddleware } = require('../../server/services/app-middleware-runtime');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');
const { createPremiumApiAccessGuard } = require('../../server/security/premium-auth');
const { getRequestPathname } = require('../../server/security/request-context');

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

function middlewareDependencies(overrides = {}) {
  return {
    express,
    isProduction: false,
    isPremiumPublicApiRequest: () => false,
    appendSecurityAuditEvent: () => null,
    getPremiumAuthState: (req) => req.premiumAuth || { email: '' },
    normalizePremiumSessionEmail: (value) => String(value || '').trim().toLowerCase(),
    getClientIpFromRequest: (req) => req.ip || '127.0.0.1',
    getRequestPathname,
    getRequestOriginFromHeaders: () => 'https://softora.test',
    getStateChangingApiProtectionDecision: () => ({ allowed: true }),
    noindexHeaderValue: 'noindex, nofollow',
    isSupabaseConfigured: () => false,
    ensureRuntimeStateHydratedFromSupabase: async () => true,
    ...overrides,
  };
}

function authStateForRequest(req) {
  const mode = String(req.get('x-test-auth') || 'admin').trim().toLowerCase();
  if (mode === 'anonymous') {
    return {
      configured: true,
      authenticated: false,
      expired: false,
      revoked: false,
      token: '',
    };
  }
  if (mode === 'member') {
    return {
      configured: true,
      authenticated: true,
      isAdmin: false,
      email: 'member@softora.test',
      user: { id: 'member' },
    };
  }
  return {
    configured: true,
    authenticated: true,
    isAdmin: true,
    email: 'admin@softora.test',
    user: { id: 'admin' },
  };
}

function createMailboxCoordinator(overrides = {}) {
  return {
    preflightMessageResponse(_req, res) {
      return res.status(200).json({ ok: true, proof: 'test-proof' });
    },
    sendMessageResponse(_req, res) {
      return res.status(200).json({ ok: true });
    },
    ...overrides,
  };
}

function createProtectedMailboxApp(options = {}) {
  const app = express();
  applyAppMiddleware(app, middlewareDependencies({
    getStateChangingApiProtectionDecision: options.getProtectionDecision || (() => ({ allowed: true })),
  }));

  const guard = createPremiumApiAccessGuard({
    isPremiumPublicApiRequest: () => false,
    getResolvedPremiumAuthState: async (req) => authStateForRequest(req),
    isPremiumAdminIpAllowed: () => true,
    appendSecurityAuditEvent: () => null,
    getClientIpFromRequest: (req) => req.ip || '127.0.0.1',
    getRequestPathname,
    getRequestOriginFromHeaders: () => 'https://softora.test',
    clearPremiumSessionCookie: () => null,
  });

  app.use('/api', guard.requirePremiumApiAccess);
  registerMailboxRoutes(app, {
    coordinator: options.coordinator || createMailboxCoordinator(),
    requirePremiumAdminApiAccess: guard.requirePremiumAdminApiAccess,
    spellingService: {
      correctDraftResponse(_req, res) {
        return res.status(200).json({ ok: true });
      },
    },
  });

  app.get('/api/mailbox/send', (_req, res) => (
    res.status(409).json({ ok: false, code: 'GET_BOUNDARY' })
  ));
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Niet gevonden' }));
  app.use((_error, _req, res, _next) => (
    res.status(500).json({ ok: false, error: 'Interne serverfout' })
  ));
  return app;
}

async function listen(app, t) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function requestJson(baseUrl, pathname, options = {}) {
  const method = String(options.method || 'POST').toUpperCase();
  const headers = { ...(options.headers || {}) };
  const request = { method, headers };
  if (options.body !== undefined) {
    request.body = options.body;
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }
  const response = await fetch(`${baseUrl}${pathname}`, request);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function assertPreDispatchFailure(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.externalEffect, false);
  assert.equal(response.body.failurePhase, 'pre-dispatch');
}

test('invalid JSON op exact mailbox-send krijgt vóór auth veilig pre-dispatchbewijs', async (t) => {
  const baseUrl = await listen(createProtectedMailboxApp(), t);
  const response = await requestJson(baseUrl, '/api/mailbox/send', {
    body: '{',
    headers: { 'x-test-auth': 'anonymous' },
  });

  assertPreDispatchFailure(response, 500);
  assert.equal(response.body.error, 'Interne serverfout');
});

test('sensitive en algemene rate-limitafwijzingen krijgen veilig pre-dispatchbewijs', async (t) => {
  const recorder = createAppRecorder();
  applyAppMiddleware(recorder, middlewareDependencies());
  const bodyParserSelector = recorder.uses[2][0];
  const sensitiveLimiter = recorder.uses.find((entry) => (
    Array.isArray(entry[0]) && entry[0].includes('/api/mailbox/send')
  ))[1];
  const generalLimiter = recorder.uses.find((entry) => entry[0] === '/api')[1];

  await t.test('sensitive limiet', async (subtest) => {
    const app = express();
    app.use(bodyParserSelector);
    app.use(sensitiveLimiter);
    app.post('/api/mailbox/send', (_req, res) => (
      res.status(418).json({ ok: false, code: 'BELOW_SENSITIVE_LIMIT' })
    ));
    const baseUrl = await listen(app, subtest);
    let response = null;
    for (let index = 0; index < 41; index += 1) {
      response = await requestJson(baseUrl, '/api/mailbox/send', { body: '{}' });
    }
    assertPreDispatchFailure(response, 429);
    assert.match(response.body.error, /Te veel verzoeken/i);
  });

  await t.test('algemene API-limiet zonder de strengere route-limiter', async (subtest) => {
    const app = express();
    app.use(bodyParserSelector);
    app.use(generalLimiter);
    app.post('/api/mailbox/send', (_req, res) => (
      res.status(418).json({ ok: false, code: 'BELOW_GENERAL_LIMIT' })
    ));
    const baseUrl = await listen(app, subtest);
    let response = null;
    for (let index = 0; index < 501; index += 1) {
      response = await requestJson(baseUrl, '/api/mailbox/send', { body: '{}' });
    }
    assertPreDispatchFailure(response, 429);
    assert.match(response.body.error, /Te veel verzoeken/i);
  });
});

test('CSRF, globale premium-auth en route-adminauth blijven pre-runtime aantoonbaar effectvrij', async (t) => {
  await t.test('CSRF-blokkade', async (subtest) => {
    const app = createProtectedMailboxApp({
      getProtectionDecision: (req) => (
        req.get('x-test-csrf') === 'blocked'
          ? { allowed: false, reason: 'csrf_test_blocked', publicMessage: 'CSRF geweigerd.' }
          : { allowed: true }
      ),
    });
    const baseUrl = await listen(app, subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send', {
      body: '{}',
      headers: { 'x-test-csrf': 'blocked' },
    });
    assertPreDispatchFailure(response, 403);
    assert.equal(response.body.error, 'CSRF geweigerd.');
  });

  await t.test('globale premium-auth', async (subtest) => {
    const baseUrl = await listen(createProtectedMailboxApp(), subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send', {
      body: '{}',
      headers: { 'x-test-auth': 'anonymous' },
    });
    assertPreDispatchFailure(response, 401);
    assert.equal(response.body.error, 'Niet ingelogd.');
  });

  await t.test('route-adminauth vóór runtimemarker', async (subtest) => {
    let coordinatorCalls = 0;
    const baseUrl = await listen(createProtectedMailboxApp({
      coordinator: createMailboxCoordinator({
        sendMessageResponse(_req, res) {
          coordinatorCalls += 1;
          return res.status(200).json({ ok: true });
        },
      }),
    }), subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send', {
      body: '{}',
      headers: { 'x-test-auth': 'member' },
    });
    assertPreDispatchFailure(response, 403);
    assert.equal(response.body.error, 'Alleen Full Acces-accounts hebben toegang.');
    assert.equal(coordinatorCalls, 0);
  });
});

test('decorator kopieert pre-runtime foutpayload en begrenst method en pad exact', async (t) => {
  await t.test('originele foutpayload blijft ongemuteerd', async (subtest) => {
    const originalPayload = Object.freeze({ ok: false, code: 'PRE_RUNTIME_FIXTURE' });
    const app = express();
    applyAppMiddleware(app, middlewareDependencies());
    app.post('/api/mailbox/send', (_req, res) => res.status(409).json(originalPayload));
    const baseUrl = await listen(app, subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send?source=search', { body: '{}' });

    assertPreDispatchFailure(response, 409);
    assert.deepEqual(originalPayload, { ok: false, code: 'PRE_RUNTIME_FIXTURE' });
  });

  await t.test('GET op hetzelfde pad wordt niet gelabeld', async (subtest) => {
    const baseUrl = await listen(createProtectedMailboxApp(), subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send', {
      method: 'GET',
      headers: { 'x-test-auth': 'admin' },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { ok: false, code: 'GET_BOUNDARY' });
  });

  await t.test('send-preflight wordt niet gelabeld', async (subtest) => {
    const payload = Object.freeze({ ok: false, code: 'PREFLIGHT_BOUNDARY' });
    const baseUrl = await listen(createProtectedMailboxApp({
      coordinator: createMailboxCoordinator({
        preflightMessageResponse(_req, res) {
          return res.status(409).json(payload);
        },
      }),
    }), subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send/preflight', {
      body: '{}',
      headers: { 'x-test-auth': 'admin' },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { ok: false, code: 'PREFLIGHT_BOUNDARY' });
    assert.deepEqual(payload, { ok: false, code: 'PREFLIGHT_BOUNDARY' });
  });
});

test('decorator spiegelt Express send-route-equivalentie maar labelt geen near-miss', async (t) => {
  for (const pathname of [
    '/api/mailbox/send/',
    '/API/Mailbox/SeNd',
    '/API/Mailbox/SeNd/',
  ]) {
    await t.test(pathname, async (subtest) => {
      let coordinatorCalls = 0;
      let runtimeMarker = false;
      const runtimePayload = Object.freeze({
        ok: false,
        code: 'ROUTE_EQUIVALENT_RUNTIME_RESPONSE',
      });
      const baseUrl = await listen(createProtectedMailboxApp({
        coordinator: createMailboxCoordinator({
          sendMessageResponse(_req, res) {
            coordinatorCalls += 1;
            runtimeMarker = res.locals.mailboxSendRuntimeEntered === true;
            return res.status(503).json(runtimePayload);
          },
        }),
      }), subtest);

      const runtimeResponse = await requestJson(baseUrl, pathname, {
        body: '{}',
        headers: { 'x-test-auth': 'admin' },
      });
      assert.equal(runtimeResponse.status, 503);
      assert.deepEqual(runtimeResponse.body, runtimePayload);
      assert.equal(coordinatorCalls, 1);
      assert.equal(runtimeMarker, true);

      const authResponse = await requestJson(baseUrl, pathname, {
        body: '{}',
        headers: { 'x-test-auth': 'anonymous' },
      });
      assertPreDispatchFailure(authResponse, 401);
      assert.equal(coordinatorCalls, 1);
    });
  }

  await t.test('near-miss bereikt de send-route niet en blijft ongelabeld', async (subtest) => {
    let coordinatorCalls = 0;
    const baseUrl = await listen(createProtectedMailboxApp({
      coordinator: createMailboxCoordinator({
        sendMessageResponse(_req, res) {
          coordinatorCalls += 1;
          return res.status(200).json({ ok: true });
        },
      }),
    }), subtest);
    const response = await requestJson(baseUrl, '/api/mailbox/send-extra', {
      body: '{}',
      headers: { 'x-test-auth': 'admin' },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { ok: false, error: 'Niet gevonden' });
    assert.equal(coordinatorCalls, 0);
  });
});

test('mailboxruntime beheert na admin zelf pre-dispatch- en post-providerresponses', async (t) => {
  const cases = [
    {
      label: 'runtime pre-dispatch',
      payload: Object.freeze({
        ok: false,
        code: 'RUNTIME_PRE_DISPATCH',
        externalEffect: false,
        failurePhase: 'pre-dispatch',
      }),
    },
    {
      label: 'post-provider ambigu',
      payload: Object.freeze({
        ok: false,
        code: 'POST_PROVIDER_AMBIGUOUS',
        error: 'Providerstatus onbekend',
      }),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.label, async (subtest) => {
      let runtimeMarker = false;
      const baseUrl = await listen(createProtectedMailboxApp({
        coordinator: createMailboxCoordinator({
          sendMessageResponse(_req, res) {
            runtimeMarker = res.locals.mailboxSendRuntimeEntered === true;
            return res.status(503).json(fixture.payload);
          },
        }),
      }), subtest);
      const response = await requestJson(baseUrl, '/api/mailbox/send', {
        body: '{}',
        headers: { 'x-test-auth': 'admin' },
      });

      assert.equal(runtimeMarker, true);
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, fixture.payload);
    });
  }
});

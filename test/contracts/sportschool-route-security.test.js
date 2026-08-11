const test = require('node:test');
const assert = require('node:assert/strict');

const { registerRuntimeOpsRoutes } = require('../../server/routes/runtime-ops');

function createRouteRecorder() {
  const routes = [];
  return {
    routes,
    app: {
      get(path, ...handlers) {
        routes.push({ method: 'GET', path, handlers });
      },
      post(path, ...handlers) {
        routes.push({ method: 'POST', path, handlers });
      },
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runRouteHandlers(handlers, req, res) {
  let index = 0;
  async function next() {
    const handler = handlers[index];
    index += 1;
    if (handler) await handler(req, res, next);
  }
  await next();
}

test('sportschool logbook routes require the premium admin guard before storage access', () => {
  const { app, routes } = createRouteRecorder();
  const requireAdmin = () => {};

  registerRuntimeOpsRoutes(app, {
    coordinator: {},
    requireRuntimeDebugAccess: () => {},
    requirePremiumAdminApiAccess: requireAdmin,
  });

  for (const method of ['GET', 'POST']) {
    const route = routes.find(
      (entry) => entry.method === method && entry.path === '/api/sportschool-logboek'
    );
    assert.ok(route);
    assert.equal(route.handlers[0], requireAdmin);
    assert.equal(route.handlers.length, 2);
  }
});

test('sportschool logbook routes fail closed when the premium admin guard is not wired', () => {
  const { app, routes } = createRouteRecorder();
  registerRuntimeOpsRoutes(app, {
    coordinator: {},
    requireRuntimeDebugAccess: () => {},
  });

  const route = routes.find(
    (entry) => entry.method === 'GET' && entry.path === '/api/sportschool-logboek'
  );
  const res = createResponseRecorder();
  route.handlers[0]({}, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'PREMIUM_ADMIN_SECURITY_NOT_WIRED');
});

test('legacy ui-state aliases also keep the sportschool fallback behind admin access', async () => {
  const { app, routes } = createRouteRecorder();
  let storageCalls = 0;
  const requireAdmin = (_req, res) =>
    res.status(403).json({ ok: false, error: 'Alleen Full Acces-accounts hebben toegang.' });

  registerRuntimeOpsRoutes(app, {
    coordinator: {
      sendUiStateGetResponse() {
        storageCalls += 1;
      },
      sendUiStateSetResponse() {
        storageCalls += 1;
      },
    },
    requireRuntimeDebugAccess: () => {},
    requirePremiumAdminApiAccess: requireAdmin,
    requireFreshPasswordRegisterApiAccess: (_req, _res, next) => next(),
  });

  for (const { method, path } of [
    { method: 'GET', path: '/api/ui-state/:scope' },
    { method: 'GET', path: '/api/ui-state-get' },
    { method: 'POST', path: '/api/ui-state/:scope' },
    { method: 'POST', path: '/api/ui-state-set' },
    { method: 'POST', path: '/api/ui-state-read' },
  ]) {
    const route = routes.find((entry) => entry.method === method && entry.path === path);
    const req = path.includes(':scope')
      ? { params: { scope: 'sportschool_logboek' }, query: {} }
      : { params: {}, query: { scope: 'sportschool_logboek' } };
    const res = createResponseRecorder();
    await runRouteHandlers(route.handlers, req, res);
    assert.equal(res.statusCode, 403);
  }

  assert.equal(storageCalls, 0);
});

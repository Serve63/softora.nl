const test = require('node:test');
const assert = require('node:assert/strict');

const { fromBase64Url } = require('../../server/security/crypto-utils');
const { registerRuntimeOpsRoutes } = require('../../server/routes/runtime-ops');
const {
  PASSWORD_REGISTER_PROOF_MAX_TTL_MS,
  createPasswordRegisterWriteProofGuard,
  createPasswordRegisterWriteProofManager,
} = require('../../server/security/password-register-write-proof');

function createAuth(overrides = {}) {
  return {
    authenticated: true,
    freshUserValidated: true,
    user: { id: 'usr_owner', status: 'active' },
    userId: 'usr_owner',
    email: 'owner@softora.nl',
    token: 'raw-premium-session-token-never-expose',
    expiresAt: 1_800_000,
    ...overrides,
  };
}

function createV1Values() {
  return {
    entries_encrypted_v1: JSON.stringify({
      version: 1,
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 210000,
      salt: Buffer.alloc(16, 1).toString('base64'),
      iv: Buffer.alloc(12, 2).toString('base64'),
      ciphertext: Buffer.alloc(48, 3).toString('base64'),
    }),
    entries_json: '',
    updated_at: '2026-08-04T12:00:00.000Z',
    updated_by: 'legacy-client',
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

test('password register write proof is domain-signed and bound to fresh user plus current session', () => {
  let currentMs = 1_000_000;
  const manager = createPasswordRegisterWriteProofManager({
    sessionSecret: 'session-secret-for-tests',
    now: () => currentMs,
    randomBytes: () => Buffer.alloc(16, 7),
  });
  const auth = createAuth();
  const minted = manager.mint(auth);

  assert.equal(minted.ok, true);
  assert.equal(minted.writeProof.split('.').length, 3);
  assert.equal(minted.writeProofExpiresAt, new Date(currentMs + PASSWORD_REGISTER_PROOF_MAX_TTL_MS).toISOString());
  assert.equal(manager.verify(minted.writeProof, auth).ok, true);
  assert.equal(manager.verify(`${minted.writeProof}.extra`, auth).ok, false);
  assert.equal(manager.verify(`${minted.writeProof.slice(0, -1)}x`, auth).ok, false);
  assert.equal(manager.verify(minted.writeProof, createAuth({ token: 'different-session' })).ok, false);
  assert.equal(manager.verify(minted.writeProof, createAuth({ userId: 'usr_other' })).ok, false);
  assert.equal(manager.verify(minted.writeProof, createAuth({ freshUserValidated: false })).ok, false);

  const payload = JSON.parse(fromBase64Url(minted.writeProof.split('.')[1]));
  assert.equal(payload.scope, 'password-register');
  assert.equal(payload.uid, auth.userId);
  assert.equal(payload.email, auth.email);
  assert.notEqual(payload.sid, auth.token);
  assert.doesNotMatch(JSON.stringify(payload), /raw-premium-session-token-never-expose/);

  currentMs += PASSWORD_REGISTER_PROOF_MAX_TTL_MS;
  assert.equal(manager.verify(minted.writeProof, auth).ok, false);
});

test('password register write proof never outlives the current premium session', () => {
  const currentMs = 2_000_000;
  const auth = createAuth({ expiresAt: currentMs + 90_000 });
  const manager = createPasswordRegisterWriteProofManager({
    sessionSecret: 'session-secret-for-tests',
    now: () => currentMs,
    randomBytes: () => Buffer.alloc(16, 8),
  });
  const minted = manager.mint(auth);

  assert.equal(minted.ok, true);
  assert.equal(minted.writeProofExpiresAt, new Date(auth.expiresAt).toISOString());
  assert.equal(manager.verify(minted.writeProof, auth).ok, true);
});

test('password register proof guard requires a body proof for every vault read and write', () => {
  const audits = [];
  const manager = createPasswordRegisterWriteProofManager({
    sessionSecret: 'session-secret-for-tests',
    now: () => 1_000_000,
    randomBytes: () => Buffer.alloc(16, 9),
  });
  const auth = createAuth();
  const minted = manager.mint(auth);
  const ownerPolicy = {
    getAccessDecision(state) {
      return state?.userId === 'usr_owner'
        ? { ok: true }
        : { ok: false, statusCode: 403, code: 'PASSWORD_REGISTER_OWNER_REQUIRED', error: 'Owner vereist.' };
    },
  };
  const {
    requirePasswordRegisterAccessProof,
    requirePasswordRegisterWriteProof,
  } = createPasswordRegisterWriteProofGuard({
    manager,
    ownerPolicy,
    appendSecurityAuditEvent: (payload, reason) => audits.push({ payload, reason }),
  });
  let nextCalls = 0;
  const next = () => { nextCalls += 1; };
  const validReq = {
    query: { scope: 'premium_password_register' },
    premiumAuth: auth,
    body: { patch: { encrypted: 'opaque' }, writeProof: minted.writeProof },
  };
  requirePasswordRegisterWriteProof(validReq, createResponseRecorder(), next);

  const missingRes = createResponseRecorder();
  requirePasswordRegisterWriteProof(
    { ...validReq, body: { patch: { encrypted: 'opaque' } } },
    missingRes,
    next
  );
  const otherOwnerRes = createResponseRecorder();
  requirePasswordRegisterWriteProof(
    { ...validReq, premiumAuth: createAuth({ userId: 'usr_other' }) },
    otherOwnerRes,
    next
  );
  const legacyRes = createResponseRecorder();
  requirePasswordRegisterWriteProof(
    {
      ...validReq,
      body: { patch: createV1Values() },
    },
    legacyRes,
    next
  );
  const legacyExtraRes = createResponseRecorder();
  requirePasswordRegisterWriteProof(
    {
      ...validReq,
      body: { patch: createV1Values(), source: 'not-old-client-shape' },
    },
    legacyExtraRes,
    next
  );
  const misplacedWriteProofRes = createResponseRecorder();
  requirePasswordRegisterWriteProof(
    {
      ...validReq,
      query: { scope: 'premium_password_register', writeProof: minted.writeProof },
      headers: { 'x-password-register-proof': minted.writeProof },
      body: { patch: { encrypted: 'opaque' } },
    },
    misplacedWriteProofRes,
    next
  );

  assert.equal(nextCalls, 1);
  assert.equal(missingRes.statusCode, 403);
  assert.equal(missingRes.body.code, 'PASSWORD_REGISTER_PROOF_INVALID');
  assert.equal(otherOwnerRes.statusCode, 403);
  assert.equal(otherOwnerRes.body.code, 'PASSWORD_REGISTER_OWNER_REQUIRED');
  assert.equal(legacyRes.statusCode, 403);
  assert.equal(legacyRes.body.code, 'PASSWORD_REGISTER_PROOF_INVALID');
  assert.equal(legacyExtraRes.statusCode, 403);
  assert.equal(legacyExtraRes.body.code, 'PASSWORD_REGISTER_PROOF_INVALID');
  assert.equal(misplacedWriteProofRes.statusCode, 403);
  assert.equal(misplacedWriteProofRes.body.code, 'PASSWORD_REGISTER_PROOF_INVALID');
  assert.doesNotMatch(JSON.stringify(audits), /raw-premium-session-token|\.eyJ|nonce|writeProof/i);

  const readRes = createResponseRecorder();
  requirePasswordRegisterAccessProof(
    {
      query: { scope: 'premium_password_register' },
      premiumAuth: auth,
      body: { writeProof: minted.writeProof },
    },
    readRes,
    next
  );
  const legacyReadRes = createResponseRecorder();
  requirePasswordRegisterAccessProof(
    {
      query: { scope: 'premium_password_register' },
      premiumAuth: auth,
      body: { patch: createV1Values() },
    },
    legacyReadRes,
    next
  );
  assert.equal(nextCalls, 2);
  assert.equal(readRes.statusCode, null);
  assert.equal(legacyReadRes.statusCode, 400);
  assert.equal(legacyReadRes.body.code, 'PASSWORD_REGISTER_READ_BODY_INVALID');

  const misplacedReadProofRes = createResponseRecorder();
  requirePasswordRegisterAccessProof(
    {
      query: { scope: 'premium_password_register', writeProof: minted.writeProof },
      headers: { 'x-password-register-proof': minted.writeProof },
      premiumAuth: auth,
      body: {},
    },
    misplacedReadProofRes,
    next
  );
  assert.equal(misplacedReadProofRes.statusCode, 400);
  assert.equal(misplacedReadProofRes.body.code, 'PASSWORD_REGISTER_READ_BODY_INVALID');
});

test('legacy GET routes reject only the password-register scope after fresh authorization', async () => {
  const routes = [];
  let reads = 0;
  const app = {
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post() {},
  };
  const fresh = (req, res, next) => {
    if (!req.premiumAuth?.authenticated) {
      return res.status(401).json({ ok: false, code: 'PREMIUM_LOGIN_REQUIRED' });
    }
    if (req.premiumAuth.userId !== 'usr_owner') {
      return res.status(403).json({ ok: false, code: 'PASSWORD_REGISTER_OWNER_REQUIRED' });
    }
    return next();
  };
  registerRuntimeOpsRoutes(app, {
    coordinator: {
      sendUiStateGetResponse(_req, res, scope) {
        reads += 1;
        return res.status(200).json({ ok: true, scope });
      },
    },
    requireRuntimeDebugAccess: () => {},
    requireFreshPasswordRegisterApiAccess: fresh,
    requirePasswordRegisterAccessProof: () => {},
    requirePasswordRegisterWriteProof: () => {},
  });

  for (const path of ['/api/ui-state/:scope', '/api/ui-state-get']) {
    const route = routes.find((entry) => entry.path === path);
    assert.ok(route);
    assert.equal(route.handlers[0], fresh);

    const requestFor = (scope, auth) => path.includes(':scope')
      ? { params: { scope }, query: {}, premiumAuth: auth }
      : { params: {}, query: { scope }, premiumAuth: auth };

    const unauthenticatedRes = createResponseRecorder();
    await runRouteHandlers(route.handlers, requestFor('premium_password_register', {}), unauthenticatedRes);
    assert.equal(unauthenticatedRes.statusCode, 401);

    const wrongOwnerRes = createResponseRecorder();
    await runRouteHandlers(
      route.handlers,
      requestFor('premium_password_register', { authenticated: true, userId: 'usr_other' }),
      wrongOwnerRes
    );
    assert.equal(wrongOwnerRes.statusCode, 403);

    const legacyRes = createResponseRecorder();
    await runRouteHandlers(
      route.handlers,
      requestFor('premium_password_register', { authenticated: true, userId: 'usr_owner' }),
      legacyRes
    );
    assert.equal(legacyRes.statusCode, 405);
    assert.equal(legacyRes.body.code, 'PASSWORD_REGISTER_LEGACY_READ_DISABLED');

    const genericRes = createResponseRecorder();
    await runRouteHandlers(
      route.handlers,
      requestFor('premium_word', { authenticated: true, userId: 'usr_owner' }),
      genericRes
    );
    assert.equal(genericRes.statusCode, 200);
    assert.equal(genericRes.body.scope, 'premium_word');
  }
  assert.equal(reads, 2);
});

test('dedicated password-register read route requires fresh auth and access proof before ciphertext read', () => {
  const routes = [];
  const fresh = () => {};
  const proof = () => {};
  const coordinator = { sendUiStateGetResponse: () => {} };
  const app = {
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); },
  };
  registerRuntimeOpsRoutes(app, {
    coordinator,
    requireRuntimeDebugAccess: () => {},
    requireFreshPasswordRegisterApiAccess: fresh,
    requirePasswordRegisterAccessProof: proof,
    requirePasswordRegisterWriteProof: () => {},
  });

  const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/api/ui-state-read');
  assert.ok(route);
  assert.equal(route.handlers[0], fresh);
  assert.equal(route.handlers[1], proof);
  assert.equal(route.handlers.length, 3);
});

test('both password-register write aliases require fresh auth and body proof before CAS', () => {
  const routes = [];
  const fresh = () => {};
  const proof = () => {};
  const app = {
    get() {},
    post(path, ...handlers) { routes.push({ path, handlers }); },
  };
  registerRuntimeOpsRoutes(app, {
    coordinator: { sendUiStateSetResponse: () => {} },
    requireRuntimeDebugAccess: () => {},
    requireFreshPasswordRegisterApiAccess: fresh,
    requirePasswordRegisterAccessProof: () => {},
    requirePasswordRegisterWriteProof: proof,
  });

  for (const path of ['/api/ui-state/:scope', '/api/ui-state-set']) {
    const route = routes.find((entry) => entry.path === path);
    assert.ok(route);
    assert.equal(route.handlers[0], fresh);
    assert.equal(route.handlers[1], proof);
    assert.equal(route.handlers.length, 3);
  }
});

test('password-register routes fail closed when a security middleware is not wired', () => {
  const routes = [];
  const app = {
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); },
  };
  registerRuntimeOpsRoutes(app, {
    coordinator: {},
    requireRuntimeDebugAccess: () => {},
  });
  const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/api/ui-state-read');
  const res = createResponseRecorder();
  let nextCalls = 0;
  route.handlers[0](
    { query: { scope: 'premium_password_register' }, body: {} },
    res,
    () => { nextCalls += 1; }
  );
  assert.equal(nextCalls, 0);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'PASSWORD_REGISTER_SECURITY_NOT_WIRED');
});

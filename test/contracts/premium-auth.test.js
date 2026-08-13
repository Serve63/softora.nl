const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPremiumApiAccessGuard,
  createPremiumAuthStateManager,
} = require('../../server/security/premium-auth');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createPremiumUsersStoreStub(users = [], source = 'supabase') {
  return {
    async ensureUsersHydrated() {
      return { users, source };
    },
    getCachedUsers() {
      return users;
    },
    findUserById(list, userId) {
      return list.find((item) => item.id === userId) || null;
    },
    findUserByEmail(list, email) {
      return list.find((item) => item.email === email) || null;
    },
    normalizeUserStatus(status) {
      return String(status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
    },
    isAdminRole(role) {
      return String(role || '').toLowerCase() === 'admin';
    },
    buildUserDisplayName(user) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || '';
    },
    sanitizeAvatarDataUrl(value) {
      return normalizeString(value);
    },
  };
}

test('premium auth manager builds anonymous auth state when no session secret exists', () => {
  const manager = createPremiumAuthStateManager({
    sessionSecret: '',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    premiumUsersStore: createPremiumUsersStoreStub(),
    getRequestPathname: () => '/',
  });

  const authState = manager.getPremiumAuthState({});
  assert.equal(authState.configured, false);
  assert.equal(authState.authenticated, false);
});

test('premium auth manager resolves anonymous requests from cached users without hydration wait', async () => {
  let hydrateCalls = 0;
  const cachedUsers = [
    {
      id: 'usr_1',
      email: 'info@softora.nl',
      role: 'admin',
      status: 'active',
      firstName: 'Serve',
      lastName: 'Creusen',
    },
  ];
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => '',
    verifySessionToken: () => ({ ok: false, expired: false, payload: null }),
    premiumUsersStore: {
      ...createPremiumUsersStoreStub(cachedUsers),
      async ensureUsersHydrated() {
        hydrateCalls += 1;
        return { users: cachedUsers, source: 'supabase' };
      },
    },
    getRequestPathname: () => '/',
  });

  const resolved = await manager.getResolvedPremiumAuthState({});

  assert.equal(hydrateCalls, 0);
  assert.equal(resolved.configured, true);
  assert.equal(resolved.authenticated, false);
});

test('premium auth manager can resolve anonymous login page requests without hydration wait', async () => {
  let hydrateCalls = 0;
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => '',
    verifySessionToken: () => ({ ok: false, expired: false, payload: null }),
    premiumUsersStore: {
      ...createPremiumUsersStoreStub([]),
      async ensureUsersHydrated() {
        hydrateCalls += 1;
        return { users: [], source: 'supabase' };
      },
    },
    getRequestPathname: () => '/premium-personeel-login',
  });

  const resolved = await manager.getResolvedPremiumAuthState(
    {},
    { allowAnonymousWithoutHydration: true }
  );

  assert.equal(hydrateCalls, 0);
  assert.equal(resolved.configured, true);
  assert.equal(resolved.authenticated, false);
});

test('premium auth manager resolves authenticated user and session payload', async () => {
  const users = [
    {
      id: 'usr_1',
      email: 'info@softora.nl',
      role: 'admin',
      status: 'active',
      firstName: 'Serve',
      lastName: 'Creusen',
      avatarDataUrl: 'data:image/png;base64,abc',
      authVersion: 1,
      mfa: { enabled: true, encryptedSecret: 'ciphertext' },
    },
  ];

  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => 'token',
    verifySessionToken: () => ({
      ok: true,
      expired: false,
      payload: {
        email: 'INFO@SOFTORA.NL',
        uid: 'usr_1',
        role: 'ADMIN',
        av: 1,
        mfa: true,
        exp: Date.now() + 60_000,
        av: 1,
        mfa: true,
      },
    }),
    premiumUsersStore: createPremiumUsersStoreStub(users),
    isPremiumMfaConfigured: () => true,
    getRequestPathname: () => '/',
  });

  const resolved = await manager.getResolvedPremiumAuthState({});
  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.email, 'info@softora.nl');
  assert.equal(resolved.isAdmin, true);

  const sessionPayload = manager.buildPremiumAuthSessionPayload(resolved);
  assert.equal(sessionPayload.ok, true);
  assert.equal(sessionPayload.authenticated, true);
  assert.equal(sessionPayload.mfaEnabled, true);
  assert.equal(sessionPayload.canManageUsers, true);
});

test('premium auth manager can resolve authenticated token requests without hydration wait', async () => {
  let hydrateCalls = 0;
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => 'token',
    verifySessionToken: () => ({
      ok: true,
      expired: false,
      payload: {
        email: 'INFO@SOFTORA.NL',
        uid: 'usr_1',
        role: 'ADMIN',
        exp: Date.now() + 60_000,
        av: 1,
        mfa: true,
      },
    }),
    premiumUsersStore: {
      ...createPremiumUsersStoreStub([]),
      async ensureUsersHydrated() {
        hydrateCalls += 1;
        return { users: [], source: 'supabase' };
      },
    },
    getRequestPathname: () => '/api/auth/session',
  });

  const resolved = await manager.getResolvedPremiumAuthState(
    {},
    { allowTokenFallbackWithoutHydration: true }
  );

  assert.equal(hydrateCalls, 0);
  assert.equal(resolved.authenticated, false);
  assert.equal(resolved.revoked, true);
  assert.equal(resolved.user, null);
});

test('premium auth manager can require a fresh Supabase user for password-register access', async () => {
  const users = [{
    id: 'usr_owner_test',
    email: 'owner@example.test',
    role: 'admin',
    status: 'active',
    firstName: 'Owner',
    authVersion: 1,
    mfa: { enabled: true, encryptedSecret: 'ciphertext' },
  }];
  const hydrationOptions = [];
  const store = {
    ...createPremiumUsersStoreStub(users),
    async ensureUsersHydrated(options) {
      hydrationOptions.push(options);
      return { users, source: 'supabase' };
    },
  };
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => 'token',
    verifySessionToken: () => ({
      ok: true,
      expired: false,
      payload: { email: 'owner@example.test', uid: 'usr_owner_test', role: 'admin', av: 1, mfa: true },
    }),
    premiumUsersStore: store,
    getRequestPathname: () => '/premium-wachtwoordenregister',
  });

  const resolved = await manager.getResolvedPremiumAuthState({}, {
    allowTokenFallbackWithoutHydration: false,
    requireFreshUserHydration: true,
  });

  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.freshUserValidated, true);
  assert.deepEqual(hydrationOptions, [{ force: true, requireFresh: true }]);
});

test('premium auth manager rejects cached token claims when fresh hydration is unavailable', async () => {
  const cachedUsers = [{
    id: 'usr_owner_test',
    email: 'owner@example.test',
    role: 'admin',
    status: 'active',
    authVersion: 1,
    mfa: { enabled: true, encryptedSecret: 'ciphertext' },
  }];
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => 'token',
    verifySessionToken: () => ({
      ok: true,
      expired: false,
      payload: { email: 'owner@example.test', uid: 'usr_owner_test', role: 'admin', av: 1, mfa: true },
    }),
    premiumUsersStore: {
      ...createPremiumUsersStoreStub(cachedUsers),
      async ensureUsersHydrated() {
        return { users: cachedUsers, source: 'unavailable' };
      },
    },
    getRequestPathname: () => '/premium-wachtwoordenregister',
  });

  const resolved = await manager.getResolvedPremiumAuthState({}, {
    allowTokenFallbackWithoutHydration: false,
    requireFreshUserHydration: true,
  });

  assert.equal(resolved.authenticated, false);
  assert.equal(resolved.hydrationUnavailable, true);
  assert.equal(resolved.user, null);
});

test('password-register API guard rejects token fallback and requests fresh hydration', async () => {
  let resolveOptions = null;
  let nextCalls = 0;
  const guard = createPremiumApiAccessGuard({
    normalizeString,
    getResolvedPremiumAuthState: async (_req, options) => {
      resolveOptions = options;
      return {
        configured: true,
        authenticated: true,
        isAdmin: true,
        tokenFallback: true,
        user: null,
      };
    },
  });
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await guard.requireFreshPasswordRegisterApiAccess(
    { query: { scope: 'premium_password_register' } },
    res,
    () => {
      nextCalls += 1;
    }
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'PASSWORD_REGISTER_FRESH_AUTH_UNAVAILABLE');
  assert.equal(nextCalls, 0);
  assert.deepEqual(resolveOptions, {
    allowAnonymousWithoutHydration: false,
    allowTokenFallbackWithoutHydration: false,
    requireFreshUserHydration: true,
  });
});

test('password-register API guard clears an expired session before returning 401', async () => {
  let cleared = 0;
  let nextCalls = 0;
  const guard = createPremiumApiAccessGuard({
    normalizeString,
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: false,
      expired: true,
      revoked: false,
    }),
    clearPremiumSessionCookie: () => {
      cleared += 1;
    },
  });
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await guard.requireFreshPasswordRegisterApiAccess(
    { params: { scope: 'premium_password_register' } },
    res,
    () => {
      nextCalls += 1;
    }
  );

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Niet ingelogd.' });
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(cleared, 1);
  assert.equal(nextCalls, 0);
});

test('password-register API guard passes only a freshly validated active user', async () => {
  const freshState = {
    configured: true,
    authenticated: true,
    isAdmin: true,
    userId: 'usr_owner_test',
    user: { id: 'usr_owner_test', status: 'active' },
    freshUserValidated: true,
  };
  let nextCalls = 0;
  const guard = createPremiumApiAccessGuard({
    normalizeString,
    getResolvedPremiumAuthState: async () => freshState,
  });
  const req = { body: { actionConfirmScope: 'password-register' } };
  const res = {
    setHeader() {},
    status() {
      return this;
    },
    json() {
      return this;
    },
  };

  await guard.requireFreshPasswordRegisterApiAccess(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(req.premiumAuth, freshState);
});

test('premium auth manager rejects unsafe redirects and recognizes public api paths', () => {
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    premiumUsersStore: createPremiumUsersStoreStub(),
    getRequestPathname: (req) => req.originalUrl || req.path || '/',
  });

  assert.equal(manager.getSafePremiumRedirectPath('https://evil.example'), '/premium-personeel-dashboard');
  assert.equal(manager.getSafePremiumRedirectPath('/premium-personeel-dashboard'), '/premium-personeel-dashboard');

  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/auth/session' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/agenda-app/login' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/sportschool-logboek' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/sportschool-logboek' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({
      method: 'POST',
      originalUrl: '/api/retell/functions/agenda/availability',
    }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({
      method: 'POST',
      originalUrl: '/retell/functions/agenda/availability/',
    }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/coldmailing/open.gif' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/coldmailing/unsubscribe' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/instantly/webhook' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({
      method: 'POST',
      originalUrl: '/api/retell/functions/agenda/availability/run',
    }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/mailbox/sync' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/mailbox/instantly/sync' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/coldmailing/autopilot/run' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'GET', originalUrl: '/api/premium-database/webdesign-photo-batches/run' }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/premium-database/webdesign-photo-batches/run' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/premium-database/webdesign-photo-batches/webdesign_batch_123/cancel' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/coldmailing/autopilot/run' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/mailbox/sync' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/mailbox/instantly/sync' }),
    false
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/private/action' }),
    false
  );
});

test('premium auth manager falls back to cached or token auth state when user hydration times out', async () => {
  const cachedUsers = [
    {
      id: 'usr_1',
      email: 'info@softora.nl',
      role: 'admin',
      status: 'active',
      firstName: 'Serve',
      lastName: 'Creusen',
      avatarDataUrl: 'data:image/png;base64,abc',
      authVersion: 1,
      mfa: { enabled: true, encryptedSecret: 'ciphertext' },
    },
  ];
  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    resolveTimeoutMs: 5,
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => 'token',
    verifySessionToken: () => ({
      ok: true,
      expired: false,
      payload: {
        email: 'info@softora.nl',
        uid: 'usr_1',
        role: 'admin',
        exp: Date.now() + 60_000,
        av: 1,
        mfa: true,
        av: 1,
        mfa: true,
        av: 1,
        mfa: true,
      },
    }),
    premiumUsersStore: {
      async ensureUsersHydrated() {
        return new Promise(() => {});
      },
      getCachedUsers() {
        return cachedUsers;
      },
      findUserById(list, userId) {
        return list.find((item) => item.id === userId) || null;
      },
      findUserByEmail(list, email) {
        return list.find((item) => item.email === email) || null;
      },
      normalizeUserStatus(status) {
        return String(status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
      },
      isAdminRole(role) {
        return String(role || '').toLowerCase() === 'admin';
      },
      buildUserDisplayName(user) {
        return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || '';
      },
      sanitizeAvatarDataUrl(value) {
        return normalizeString(value);
      },
    },
    getRequestPathname: () => '/',
  });

  const resolved = await manager.getResolvedPremiumAuthState({});

  assert.equal(resolved.configured, true);
  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.email, 'info@softora.nl');
  assert.equal(resolved.isAdmin, true);
});

test('premium auth manager treats bootstrap-backed users as configured auth state', async () => {
  const users = [
    {
      id: 'usr_bootstrap',
      email: 'info@softora.nl',
      role: 'admin',
      status: 'active',
      firstName: 'Serve',
      lastName: 'Creusen',
      avatarDataUrl: 'data:image/png;base64,abc',
      authVersion: 1,
      mfa: { enabled: true, encryptedSecret: 'ciphertext' },
    },
  ];

  const manager = createPremiumAuthStateManager({
    sessionSecret: 'secret',
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    readSessionTokenFromRequest: () => 'token',
    verifySessionToken: () => ({
      ok: true,
      expired: false,
      payload: {
        email: 'info@softora.nl',
        uid: 'usr_bootstrap',
        role: 'admin',
        exp: Date.now() + 60_000,
        av: 1,
        mfa: true,
      },
    }),
    premiumUsersStore: createPremiumUsersStoreStub(users, 'bootstrap_env'),
    getRequestPathname: () => '/',
  });

  const resolved = await manager.getResolvedPremiumAuthState({});

  assert.equal(resolved.configured, true);
  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.email, 'info@softora.nl');
  assert.equal(resolved.isAdmin, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumAuthRouteCoordinator } = require('../../server/services/premium-auth');

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
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
}

function normalizeString(value) {
  return String(value || '').trim();
}

function createPremiumUsersStoreStub(initialUsers = [], source = 'supabase') {
  const users = initialUsers.map((user) => ({
    status: 'active',
    role: 'medewerker',
    ...user,
  }));

  return {
    async ensureUsersHydrated() {
      return { source, users };
    },
    getCachedUsers() {
      return users;
    },
    findUserByEmail(list, email) {
      return list.find((user) => String(user.email || '').toLowerCase() === String(email || '').toLowerCase()) || null;
    },
    normalizeUserStatus(status) {
      return String(status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
    },
    verifyPasswordHash(password, passwordHash) {
      return passwordHash === `hash:${password}`;
    },
  };
}

function createFixture(options = {}) {
  const auditEvents = [];
  const cookieSets = [];
  const cookieClears = [];
  const tokenCalls = [];
  const premiumUsersStore =
    options.premiumUsersStore ||
    createPremiumUsersStoreStub(
      options.users || [
        {
          id: 'usr_admin',
          email: 'admin@softora.nl',
          role: 'admin',
          status: 'active',
          passwordHash: 'hash:secret123',
        },
      ],
      options.hydrationSource || 'supabase'
    );

  const coordinator = createPremiumAuthRouteCoordinator({
    sessionSecret: options.sessionSecret === undefined ? 'secret' : options.sessionSecret,
    premiumSessionTtlHours: 12,
    premiumSessionRememberTtlDays: 30,
    premiumUsersStore,
    normalizePremiumSessionEmail: (value) => normalizeString(value).toLowerCase(),
    normalizeString,
    isPremiumMfaConfigured: () => Boolean(options.mfaConfigured),
    isPremiumMfaCodeValid: (code) => code === (options.validOtp || '123456'),
    getSafePremiumRedirectPath: (value) => {
      const target = normalizeString(value);
      return target.startsWith('/') && !target.startsWith('//') && !target.includes('://')
        ? target
        : '/premium-personeel-dashboard';
    },
    getResolvedPremiumAuthState: async () =>
      options.authState || {
        configured: true,
        authenticated: false,
        revoked: false,
        email: '',
      },
    buildPremiumAuthSessionPayload: (authState) => ({
      ok: true,
      configured: Boolean(authState.configured),
      authenticated: Boolean(authState.authenticated),
      displayName: authState.displayName || '',
    }),
    isPremiumAdminIpAllowed: () => (options.ipAllowed === undefined ? true : Boolean(options.ipAllowed)),
    createPremiumSessionToken: (payload) => {
      tokenCalls.push(payload);
      return `token:${payload.email}:${payload.maxAgeMs}`;
    },
    setPremiumSessionCookie: (_req, _res, token, maxAgeMs) => {
      cookieSets.push({ token, maxAgeMs });
    },
    clearPremiumSessionCookie: () => {
      cookieClears.push(true);
    },
    appendSecurityAuditEvent: (payload, reason) => {
      auditEvents.push({ payload, reason });
    },
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestPathname: (req) => req.originalUrl || '/api/auth/login',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  return {
    auditEvents,
    cookieClears,
    cookieSets,
    coordinator,
    tokenCalls,
  };
}

function createRequest(overrides = {}) {
  return {
    body: {},
    query: {},
    originalUrl: '/api/auth/login',
    get: () => 'agent',
    ...overrides,
  };
}

test('premium auth session response clears revoked cookies and returns stable payload', async () => {
  const { coordinator, cookieClears } = createFixture({
    authState: {
      configured: true,
      authenticated: false,
      revoked: true,
      displayName: '',
    },
  });
  const req = createRequest({ originalUrl: '/api/auth/session' });
  const res = createResponseRecorder();

  await coordinator.sendSessionResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.body.ok, true);
  assert.equal(cookieClears.length, 1);
});

test('premium auth login returns 503 when auth is not fully configured', async () => {
  const { auditEvents, coordinator } = createFixture({
    sessionSecret: '',
    users: [],
  });
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /PREMIUM_SESSION_SECRET/i);
  assert.equal(auditEvents[0].reason, 'security_login_rejected');
});

test('premium auth login accepts bootstrap-backed users when supabase hydration falls back', async () => {
  const { coordinator } = createFixture({
    hydrationSource: 'bootstrap_env',
  });
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.authenticated, true);
});

test('premium auth login reports temporary user store failures separately from config errors', async () => {
  const { auditEvents, coordinator } = createFixture({
    premiumUsersStore: {
      async ensureUsersHydrated() {
        return { source: 'unavailable', users: [] };
      },
      getCachedUsers() {
        return [];
      },
      findUserByEmail() {
        return null;
      },
      normalizeUserStatus(status) {
        return String(status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
      },
      verifyPasswordHash() {
        return false;
      },
    },
  });
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /tijdelijk niet beschikbaar/i);
  assert.match(auditEvents[0].payload.detail, /tijdelijk niet beschikbaar/i);
});

test('premium auth login blocks disallowed admin ips before password checks', async () => {
  const { auditEvents, coordinator } = createFixture({
    ipAllowed: false,
  });
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Inloggen is vanaf dit IP-adres niet toegestaan.');
  assert.equal(auditEvents[0].reason, 'security_login_ip_blocked');
});

test('premium auth login requires credentials and rejects invalid passwords', async () => {
  const missingFixture = createFixture();
  const missingReq = createRequest({ body: {} });
  const missingRes = createResponseRecorder();

  await missingFixture.coordinator.loginResponse(missingReq, missingRes);

  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'Vul je e-mailadres en wachtwoord in.');

  const invalidFixture = createFixture();
  const invalidReq = createRequest({
    body: { email: 'admin@softora.nl', password: 'wrong' },
  });
  const invalidRes = createResponseRecorder();

  await invalidFixture.coordinator.loginResponse(invalidReq, invalidRes);

  assert.equal(invalidRes.statusCode, 401);
  assert.equal(invalidRes.body.error, 'Ongeldige inloggegevens.');
});

test('premium auth login rejects inactive users and invalid mfa codes', async () => {
  const inactiveFixture = createFixture({
    users: [
      {
        id: 'usr_staff',
        email: 'staff@softora.nl',
        role: 'medewerker',
        status: 'inactive',
        passwordHash: 'hash:secret123',
      },
    ],
  });
  const inactiveReq = createRequest({
    body: { email: 'staff@softora.nl', password: 'secret123' },
  });
  const inactiveRes = createResponseRecorder();

  await inactiveFixture.coordinator.loginResponse(inactiveReq, inactiveRes);

  assert.equal(inactiveRes.statusCode, 403);
  assert.equal(inactiveRes.body.error, 'Dit account is gedeactiveerd.');

  const mfaFixture = createFixture({
    mfaConfigured: true,
    validOtp: '654321',
  });
  const mfaReq = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123', otp: '000000' },
  });
  const mfaRes = createResponseRecorder();

  await mfaFixture.coordinator.loginResponse(mfaReq, mfaRes);

  assert.equal(mfaRes.statusCode, 401);
  assert.equal(mfaRes.body.error, 'Ongeldige of ontbrekende 2FA-code.');
  assert.equal(mfaRes.body.mfaRequired, true);
});

test('premium auth login sets a remembered session cookie and returns next path', async () => {
  const { auditEvents, coordinator, cookieSets, tokenCalls } = createFixture();
  const req = createRequest({
    body: {
      email: 'admin@softora.nl',
      password: 'secret123',
      remember: 'true',
      next: '/premium-users',
    },
  });
  const res = createResponseRecorder();

  await coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.authenticated, true);
  assert.equal(res.body.role, 'admin');
  assert.equal(res.body.next, '/premium-users');
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].maxAgeMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(cookieSets.length, 1);
  assert.equal(cookieSets[0].maxAgeMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(auditEvents.at(-1).reason, 'security_login_success');
});

test('premium auth logout clears session cookie and returns anonymous state', async () => {
  const { auditEvents, cookieClears, coordinator } = createFixture({
    authState: {
      configured: true,
      authenticated: true,
      revoked: false,
      email: 'admin@softora.nl',
    },
  });
  const req = createRequest({ originalUrl: '/api/auth/logout' });
  const res = createResponseRecorder();

  await coordinator.logoutResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.deepEqual(res.body, { ok: true, authenticated: false });
  assert.equal(cookieClears.length, 1);
  assert.equal(auditEvents.at(-1).reason, 'security_logout');
});

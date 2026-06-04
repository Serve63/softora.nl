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

function createPremiumUsersStoreStub(initialUsers = [], source = 'supabase', options = {}) {
  const users = initialUsers.map((user) => ({
    status: 'active',
    role: 'medewerker',
    ...user,
  }));
  const bootstrapUsers = Array.isArray(options.bootstrapUsers) ? options.bootstrapUsers : [];
  const persistCalls = [];
  const hydrationCalls = [];

  return {
    hydrationCalls,
    persistCalls,
    async ensureUsersHydrated(hydrationOptions = {}) {
      hydrationCalls.push(hydrationOptions);
      return { source, users };
    },
    async persistUsersCollection(nextUsers) {
      persistCalls.push(nextUsers);
      users.splice(0, users.length, ...nextUsers);
      return { source: 'supabase', users };
    },
    getCachedUsers() {
      return users;
    },
    findBootstrapUserByEmail(email) {
      return bootstrapUsers.find((user) => String(user.email || '').toLowerCase() === String(email || '').toLowerCase()) || null;
    },
    findUserByEmail(list, email) {
      return list.find((user) => String(user.email || '').toLowerCase() === String(email || '').toLowerCase()) || null;
    },
    buildUserDisplayName(user) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || '';
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
      options.hydrationSource || 'supabase',
      options.storeOptions || {}
    );

  const coordinator = createPremiumAuthRouteCoordinator({
    sessionSecret: options.sessionSecret === undefined ? 'secret' : options.sessionSecret,
    premiumSessionTtlHours: 12,
    premiumSessionRememberTtlDays: 30,
    agendaAppPin: options.agendaAppPin || '',
    agendaAppPinHash: options.agendaAppPinHash || '',
    agendaAppServeEmail: options.agendaAppServeEmail || 'serve@softora.nl',
    agendaAppMartijnEmail: options.agendaAppMartijnEmail || 'martijn@softora.nl',
    agendaAppSessionTtlDays: options.agendaAppSessionTtlDays || 3650,
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
    premiumUsersStore,
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

test('premium agenda app login requires a configured pincode', async () => {
  const { auditEvents, coordinator } = createFixture({
    users: [
      {
        id: 'usr_serve',
        email: 'serve@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:irrelevant',
      },
    ],
  });
  const req = createRequest({
    originalUrl: '/api/agenda-app/login',
    body: { who: 'serve', pin: '1234' },
  });
  const res = createResponseRecorder();

  await coordinator.agendaAppLoginResponse(req, res);

  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /Agenda-app toegang/i);
  assert.equal(auditEvents[0].reason, 'security_agenda_app_login_rejected');
});

test('premium agenda app login maps identity to user and sets long session cookie', async () => {
  const { auditEvents, coordinator, cookieSets, tokenCalls } = createFixture({
    agendaAppPin: '2468',
    agendaAppSessionTtlDays: 3650,
    users: [
      {
        id: 'usr_serve',
        firstName: 'Servé',
        email: 'serve@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:irrelevant',
      },
      {
        id: 'usr_martijn',
        firstName: 'Martijn',
        email: 'martijn@softora.nl',
        role: 'medewerker',
        status: 'active',
        passwordHash: 'hash:irrelevant',
      },
    ],
  });
  const req = createRequest({
    originalUrl: '/api/agenda-app/login',
    body: { who: 'martijn', pin: '2468' },
  });
  const res = createResponseRecorder();

  await coordinator.agendaAppLoginResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.authenticated, true);
  assert.equal(res.body.who, 'martijn');
  assert.equal(res.body.email, 'martijn@softora.nl');
  assert.equal(res.body.displayName, 'Martijn');
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].email, 'martijn@softora.nl');
  assert.equal(tokenCalls[0].maxAgeMs, 3650 * 24 * 60 * 60 * 1000);
  assert.equal(cookieSets[0].maxAgeMs, 3650 * 24 * 60 * 60 * 1000);
  assert.equal(auditEvents.at(-1).reason, 'security_agenda_app_login_success');
});

test('premium agenda app login can resolve users by first name when mapped emails differ', async () => {
  const { coordinator, tokenCalls } = createFixture({
    agendaAppPin: '2468',
    users: [
      {
        id: 'usr_custom_serve',
        firstName: 'Servé',
        lastName: 'Creusen',
        email: 'planning@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:irrelevant',
      },
    ],
  });
  const req = createRequest({
    originalUrl: '/api/agenda-app/login',
    body: { who: 'serve', pin: '2468' },
  });
  const res = createResponseRecorder();

  await coordinator.agendaAppLoginResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.email, 'planning@softora.nl');
  assert.equal(res.body.displayName, 'Servé Creusen');
  assert.equal(tokenCalls[0].email, 'planning@softora.nl');
});

test('premium agenda app login rejects wrong pins and inactive mapped users', async () => {
  const invalidFixture = createFixture({
    agendaAppPinHash: 'hash:2468',
    users: [
      {
        id: 'usr_serve',
        email: 'serve@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:irrelevant',
      },
    ],
  });
  const invalidReq = createRequest({
    originalUrl: '/api/agenda-app/login',
    body: { who: 'Servé', pin: '9999' },
  });
  const invalidRes = createResponseRecorder();

  await invalidFixture.coordinator.agendaAppLoginResponse(invalidReq, invalidRes);

  assert.equal(invalidRes.statusCode, 401);
  assert.equal(invalidRes.body.error, 'Pincode klopt niet.');

  const inactiveFixture = createFixture({
    agendaAppPin: '2468',
    users: [
      {
        id: 'usr_serve',
        email: 'serve@softora.nl',
        role: 'admin',
        status: 'inactive',
        passwordHash: 'hash:irrelevant',
      },
    ],
  });
  const inactiveReq = createRequest({
    originalUrl: '/api/agenda-app/login',
    body: { who: 'serve', pin: '2468' },
  });
  const inactiveRes = createResponseRecorder();

  await inactiveFixture.coordinator.agendaAppLoginResponse(inactiveReq, inactiveRes);

  assert.equal(inactiveRes.statusCode, 403);
  assert.equal(inactiveRes.body.error, 'Dit account is gedeactiveerd.');
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

test('premium auth login forces a fresh user hydrate before password checks', async () => {
  const fixture = createFixture();
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await fixture.coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fixture.premiumUsersStore.hydrationCalls.length, 1);
  assert.deepEqual(fixture.premiumUsersStore.hydrationCalls[0], {
    force: true,
    readTimeoutMs: 1200,
  });
});

test('premium auth login recovers stale stored hashes from bootstrap credentials', async () => {
  const fixture = createFixture({
    users: [
      {
        id: 'usr_admin',
        email: 'admin@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:old-password',
        source: 'bootstrap_env',
      },
    ],
    storeOptions: {
      bootstrapUsers: [
        {
          id: 'usr_bootstrap',
          email: 'admin@softora.nl',
          role: 'admin',
          status: 'active',
          passwordHash: 'hash:secret123',
        },
      ],
    },
  });
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await fixture.coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(fixture.auditEvents.some((event) => event.reason === 'security_login_bootstrap_password_recovered'), true);
  assert.equal(fixture.auditEvents.at(-1).reason, 'security_login_success');
});

test('premium auth login never creates a missing bootstrap user during password recovery', async () => {
  const fixture = createFixture({
    users: [
      {
        id: 'usr_staff',
        email: 'staff@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:secret123',
      },
    ],
    storeOptions: {
      bootstrapUsers: [
        {
          id: 'usr_bootstrap',
          email: 'extra@softora.nl',
          role: 'admin',
          status: 'active',
          passwordHash: 'hash:secret123',
        },
      ],
    },
  });
  const req = createRequest({
    body: { email: 'extra@softora.nl', password: 'secret123' },
  });
  const res = createResponseRecorder();

  await fixture.coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Ongeldige inloggegevens.');
  assert.equal(fixture.premiumUsersStore.persistCalls.length, 0);
  assert.equal(fixture.premiumUsersStore.getCachedUsers().length, 1);
});

test('premium auth login does not overwrite managed users with bootstrap credentials', async () => {
  const fixture = createFixture({
    users: [
      {
        id: 'usr_admin',
        email: 'admin@softora.nl',
        role: 'admin',
        status: 'active',
        passwordHash: 'hash:managed-password',
        source: 'managed_ui',
      },
    ],
    storeOptions: {
      bootstrapUsers: [
        {
          id: 'usr_bootstrap',
          email: 'admin@softora.nl',
          role: 'admin',
          status: 'active',
          passwordHash: 'hash:bootstrap-password',
        },
      ],
    },
  });
  const req = createRequest({
    body: { email: 'admin@softora.nl', password: 'bootstrap-password' },
  });
  const res = createResponseRecorder();

  await fixture.coordinator.loginResponse(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Ongeldige inloggegevens.');
  assert.equal(fixture.premiumUsersStore.persistCalls.length, 0);
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

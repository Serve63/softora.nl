const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumUserManagementCoordinator } = require('../../server/services/premium-users');

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createResponseRecorder() {
  return {
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
}

function createPremiumUsersStoreStub(initialUsers = []) {
  let nextId = 10;
  const state = {
    users: [],
    updatedAt: '2026-04-07T00:00:00.000Z',
    persistCalls: [],
  };

  function validateUserEmail(value) {
    const email = normalizeString(value).toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
  }

  function normalizeUserRole(value) {
    return normalizeString(value).toLowerCase() === 'admin' ? 'admin' : 'medewerker';
  }

  function normalizeUserStatus(value) {
    return normalizeString(value).toLowerCase() === 'inactive' ? 'inactive' : 'active';
  }

  function sanitizeAvatarDataUrl(value) {
    const input = normalizeString(value);
    return /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(input) ? input : '';
  }

  function sanitizeUserRecord(user) {
    const firstName = truncateText(user.firstName || '', 80);
    const lastName = truncateText(user.lastName || '', 80);
    return {
      id: normalizeString(user.id || `usr_${nextId++}`),
      email: validateUserEmail(user.email || ''),
      firstName,
      lastName,
      role: normalizeUserRole(user.role || 'medewerker'),
      status: normalizeUserStatus(user.status || 'active'),
      passwordHash: normalizeString(user.passwordHash || ''),
      avatarDataUrl: sanitizeAvatarDataUrl(user.avatarDataUrl || ''),
      source: normalizeString(user.source || 'test'),
      createdAt: normalizeString(user.createdAt || '2026-04-07T00:00:00.000Z'),
      updatedAt: normalizeString(user.updatedAt || '2026-04-07T00:00:00.000Z'),
    };
  }

  state.users = initialUsers.map((user) => sanitizeUserRecord(user));

  return {
    get state() {
      return state;
    },
    async ensureUsersHydrated() {
      return {
        source: 'supabase',
        users: state.users,
        updatedAt: state.updatedAt,
      };
    },
    getCachedUsers() {
      return state.users;
    },
    getUsersUpdatedAt() {
      return state.updatedAt;
    },
    findUserById(users, userId) {
      return users.find((user) => user.id === userId) || null;
    },
    findUserByEmail(users, email) {
      const normalizedEmail = validateUserEmail(email);
      return users.find((user) => user.email === normalizedEmail) || null;
    },
    sanitizeUserForClient(user) {
      if (!user) return null;
      const { passwordHash, ...safeUser } = user;
      return safeUser;
    },
    sanitizeUserRecord,
    validateUserEmail,
    normalizeUserInputNames(input = {}) {
      return {
        firstName: truncateText(
          input.firstName !== undefined ? input.firstName : input.voornaam || '',
          80
        ),
        lastName: truncateText(
          input.lastName !== undefined ? input.lastName : input.achternaam || '',
          80
        ),
      };
    },
    normalizeUserRole,
    normalizeUserStatus,
    createPasswordHash(password) {
      return `hash:${password}`;
    },
    countActiveAdmins(users) {
      return users.filter((user) => normalizeUserRole(user.role) === 'admin' && normalizeUserStatus(user.status) === 'active').length;
    },
    isAdminRole(role) {
      return normalizeUserRole(role) === 'admin';
    },
    buildUserDisplayName(user) {
      return `${normalizeString(user?.firstName || '')} ${normalizeString(user?.lastName || '')}`.trim() || user?.email || '';
    },
    sanitizeAvatarDataUrl,
    async persistUsersCollection(nextUsers, options) {
      state.persistCalls.push(options);
      state.updatedAt = '2026-04-07T12:34:56.000Z';
      state.users = nextUsers.map((user) => sanitizeUserRecord(user));
      return {
        source: 'supabase',
        users: state.users,
        updatedAt: state.updatedAt,
      };
    },
  };
}

function createCoordinatorFixture(initialUsers = []) {
  const premiumUsersStore = createPremiumUsersStoreStub(initialUsers);
  const auditEvents = [];
  const coordinator = createPremiumUserManagementCoordinator({
    premiumUsersStore,
    buildPremiumAuthSessionPayload: (authState) => ({
      ok: true,
      authenticated: Boolean(authState.authenticated),
      email: authState.authenticated ? authState.email : '',
      displayName: authState.displayName || '',
      avatarDataUrl: authState.avatarDataUrl || '',
    }),
    normalizeString,
    truncateText,
    appendSecurityAuditEvent: (payload, reason) => auditEvents.push({ payload, reason }),
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestPathname: (req) => req.originalUrl || '/',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
  });

  return {
    auditEvents,
    coordinator,
    premiumUsersStore,
  };
}

function createRequest(overrides = {}) {
  return {
    body: {},
    params: {},
    originalUrl: '/api/test',
    get: () => 'agent',
    ...overrides,
  };
}

test('premium user coordinator returns profile payload for authenticated users', async () => {
  const { coordinator } = createCoordinatorFixture([
    {
      id: 'usr_admin',
      email: 'admin@softora.nl',
      firstName: 'Serve',
      lastName: 'Creusen',
      role: 'admin',
      status: 'active',
      avatarDataUrl: 'data:image/png;base64,abcd',
    },
  ]);

  const req = createRequest({
    originalUrl: '/api/auth/profile',
    premiumAuth: {
      authenticated: true,
      email: 'admin@softora.nl',
      user: {
        id: 'usr_admin',
        email: 'admin@softora.nl',
        firstName: 'Serve',
        lastName: 'Creusen',
        role: 'admin',
        status: 'active',
        avatarDataUrl: 'data:image/png;base64,abcd',
      },
      displayName: 'Serve Creusen',
      avatarDataUrl: 'data:image/png;base64,abcd',
    },
  });
  const res = createResponseRecorder();

  await coordinator.getProfileResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.email, 'admin@softora.nl');
  assert.equal(res.body.session.authenticated, true);
});

test('premium user coordinator rejects invalid avatar updates on profile edits', async () => {
  const { coordinator } = createCoordinatorFixture([
    {
      id: 'usr_admin',
      email: 'admin@softora.nl',
      firstName: 'Serve',
      lastName: 'Creusen',
      role: 'admin',
      status: 'active',
    },
  ]);

  const req = createRequest({
    originalUrl: '/api/auth/profile',
    body: {
      avatarDataUrl: 'https://example.com/avatar.png',
    },
    premiumAuth: {
      authenticated: true,
      email: 'admin@softora.nl',
      userId: 'usr_admin',
      user: { id: 'usr_admin', email: 'admin@softora.nl' },
    },
  });
  const res = createResponseRecorder();

  await coordinator.updateProfileResponse(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Profielfoto moet een geldige PNG, JPG, WEBP of GIF data-url zijn.');
});

test('premium user coordinator persists profile updates and refreshes session payload', async () => {
  const { auditEvents, coordinator, premiumUsersStore } = createCoordinatorFixture([
    {
      id: 'usr_admin',
      email: 'admin@softora.nl',
      firstName: 'Serve',
      lastName: 'Creusen',
      role: 'admin',
      status: 'active',
    },
  ]);

  const req = createRequest({
    originalUrl: '/api/auth/profile',
    body: {
      displayName: 'Serve Digital',
      avatarDataUrl: 'data:image/png;base64,abcd',
    },
    premiumAuth: {
      authenticated: true,
      email: 'admin@softora.nl',
      userId: 'usr_admin',
      user: { id: 'usr_admin', email: 'admin@softora.nl' },
      displayName: 'Serve Creusen',
    },
  });
  const res = createResponseRecorder();

  await coordinator.updateProfileResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.firstName, 'Serve');
  assert.equal(res.body.user.lastName, 'Digital');
  assert.equal(res.body.session.displayName, 'Serve Digital');
  assert.equal(premiumUsersStore.state.persistCalls.length, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].reason, 'security_premium_profile_updated');
});

test('premium user coordinator detects duplicate emails on create', async () => {
  const { coordinator } = createCoordinatorFixture([
    {
      id: 'usr_admin',
      email: 'admin@softora.nl',
      firstName: 'Admin',
      lastName: 'One',
      role: 'admin',
      status: 'active',
    },
  ]);

  const req = createRequest({
    originalUrl: '/api/premium-users',
    body: {
      email: 'admin@softora.nl',
      password: 'password123',
      firstName: 'New',
      lastName: 'User',
    },
    premiumAuth: {
      authenticated: true,
      isAdmin: true,
      email: 'admin@softora.nl',
    },
  });
  const res = createResponseRecorder();

  await coordinator.createPremiumUserResponse(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Dit e-mailadres bestaat al.');
});

test('premium user coordinator admin update accepts profielfoto (data-url) en removeAvatar', async () => {
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { coordinator, premiumUsersStore } = createCoordinatorFixture([
    {
      id: 'usr_staff',
      email: 'staff@softora.nl',
      firstName: 'Staff',
      lastName: 'User',
      role: 'medewerker',
      status: 'active',
      avatarDataUrl: '',
    },
  ]);

  const reqAvatar = createRequest({
    originalUrl: '/api/premium-users/usr_staff',
    body: {
      voornaam: 'Staff',
      achternaam: 'User',
      email: 'staff@softora.nl',
      rol: 'medewerker',
      status: 'active',
      avatarDataUrl: tinyPng,
    },
    premiumAuth: {
      authenticated: true,
      isAdmin: true,
      email: 'admin@softora.nl',
    },
  });
  const resAvatar = createResponseRecorder();
  await coordinator.updatePremiumUserResponse(reqAvatar, resAvatar, 'usr_staff');
  assert.equal(resAvatar.statusCode, 200);
  const withAvatar = resAvatar.body.users.find((u) => u.id === 'usr_staff');
  assert.equal(withAvatar.avatarDataUrl, tinyPng);

  const reqRemove = createRequest({
    originalUrl: '/api/premium-users/usr_staff',
    body: {
      voornaam: 'Staff',
      achternaam: 'User',
      email: 'staff@softora.nl',
      rol: 'medewerker',
      status: 'active',
      removeAvatar: true,
    },
    premiumAuth: {
      authenticated: true,
      isAdmin: true,
      email: 'admin@softora.nl',
    },
  });
  const resRemove = createResponseRecorder();
  await coordinator.updatePremiumUserResponse(reqRemove, resRemove, 'usr_staff');
  assert.equal(resRemove.statusCode, 200);
  const cleared = resRemove.body.users.find((u) => u.id === 'usr_staff');
  assert.equal(cleared.avatarDataUrl, '');
});

test('premium user coordinator prevents removing the last active administrator', async () => {
  const { coordinator } = createCoordinatorFixture([
    {
      id: 'usr_admin',
      email: 'admin@softora.nl',
      firstName: 'Admin',
      lastName: 'One',
      role: 'admin',
      status: 'active',
    },
  ]);

  const req = createRequest({
    originalUrl: '/api/premium-users/usr_admin',
    body: {
      role: 'medewerker',
      status: 'inactive',
    },
    premiumAuth: {
      authenticated: true,
      isAdmin: true,
      email: 'admin@softora.nl',
    },
  });
  const res = createResponseRecorder();

  await coordinator.updatePremiumUserResponse(req, res, 'usr_admin');

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Er moet altijd minimaal één actief Full Acces-account overblijven.');
});

test('premium user coordinator deletes users and returns sanitized collection', async () => {
  const { auditEvents, coordinator } = createCoordinatorFixture([
    {
      id: 'usr_admin',
      email: 'admin@softora.nl',
      firstName: 'Admin',
      lastName: 'One',
      role: 'admin',
      status: 'active',
    },
    {
      id: 'usr_staff',
      email: 'staff@softora.nl',
      firstName: 'Staff',
      lastName: 'User',
      role: 'medewerker',
      status: 'active',
    },
  ]);

  const req = createRequest({
    originalUrl: '/api/premium-users/usr_staff',
    premiumAuth: {
      authenticated: true,
      isAdmin: true,
      email: 'admin@softora.nl',
    },
  });
  const res = createResponseRecorder();

  await coordinator.deletePremiumUserResponse(req, res, 'usr_staff');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.users.length, 1);
  assert.equal(res.body.users[0].email, 'admin@softora.nl');
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].reason, 'security_premium_user_deleted');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumAuthStateManager } = require('../../server/security/premium-auth');

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
        exp: Date.now() + 60_000,
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
    manager.isPremiumPublicApiRequest({
      method: 'POST',
      originalUrl: '/api/retell/functions/agenda/availability/run',
    }),
    true
  );
  assert.equal(
    manager.isPremiumPublicApiRequest({ method: 'POST', originalUrl: '/api/private/action' }),
    false
  );
});

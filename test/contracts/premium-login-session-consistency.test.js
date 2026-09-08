const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPremiumUsersStore } = require('../../lib/premium-users-store');
const { createPremiumSessionManager } = require('../../server/security/premium-session');
const { createPremiumAuthStateManager } = require('../../server/security/premium-auth');
const { createPremiumAuthRouteCoordinator } = require('../../server/services/premium-auth');

const normalizeString = (value) => String(value || '').trim();
const passwordHash = `sha256:${crypto.createHash('sha256').update('test-password').digest('hex')}`;
const storedUser = {
  id: 'usr_persisted',
  email: 'admin@example.test',
  passwordHash,
  role: 'admin',
  status: 'active',
  authVersion: 2,
  source: 'managed_ui',
};

function createStore(readDelayMs = 0) {
  return createPremiumUsersStore({
    config: {
      premiumLoginEmails: [storedUser.email],
      premiumLoginPasswordHash: passwordHash,
      premiumSessionSecret: 'test-secret',
      supabaseStateTable: 'test_state',
    },
    deps: {
      normalizeString,
      truncateText: (value, length = 500) => normalizeString(value).slice(0, length),
      normalizePremiumSessionEmail: (value) => normalizeString(value).toLowerCase(),
      timingSafeEqualStrings: (left, right) => left === right,
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (readDelayMs) await new Promise((resolve) => setTimeout(resolve, readDelayMs));
                return { data: { payload: { users: [storedUser] }, revision: 2 }, error: null };
              },
            }),
          }),
        }),
      }),
      fetchSupabaseRowByKeyViaRest: async () => ({ ok: false, error: 'upstream timeout' }),
    },
  });
}

test('a login slower than 450ms issues a session accepted by another server with current account data', async () => {
  const loginStore = createStore(600);
  const apiStore = createStore();
  await apiStore.ensureUsersHydrated();
  const sessions = createPremiumSessionManager({ sessionSecret: 'test-secret' });
  let issuedToken = '';
  const coordinator = createPremiumAuthRouteCoordinator({
    sessionSecret: 'test-secret',
    premiumUsersStore: loginStore,
    createPremiumSessionToken: sessions.createSessionToken,
    setPremiumSessionCookie: (_req, _res, token) => { issuedToken = token; },
  });
  const res = {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await coordinator.loginResponse({ body: { email: storedUser.email, password: 'test-password' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authenticated, true);

  const auth = createPremiumAuthStateManager({
    sessionSecret: 'test-secret',
    premiumUsersStore: apiStore,
    readSessionTokenFromRequest: () => issuedToken,
    verifySessionToken: sessions.verifySessionToken,
  });
  const state = await auth.getResolvedPremiumAuthState({}, { allowTokenFallbackWithoutHydration: true });
  assert.equal(state.revoked, false, 'the first API request must not revoke a newly issued login');
  assert.equal(state.authenticated, true);
  assert.equal(state.userId, storedUser.id);
  assert.equal(state.authVersion, storedUser.authVersion);
});

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createPremiumUsersStore } = require('../../lib/premium-users-store');
const { timingSafeEqualStrings } = require('../../server/security/crypto-utils');
const { createPremiumAuthRuntime } = require('../../server/services/premium-auth-runtime');
const { createPremiumAuthStateManager, createPremiumApiAccessGuard } = require('../../server/security/premium-auth');
const { createPremiumHtmlPageAccessController } = require('../../server/security/premium-pages');
const { createPremiumAuthRouteCoordinator } = require('../../server/services/premium-auth');
const { registerPremiumAuthRoutes } = require('../../server/routes/premium-auth');
const { createHtmlPageCoordinator } = require('../../server/services/html-pages');
const { createPremiumPublicHtmlFilesSet } = require('../../server/config/premium-public-html-files');

const repoRoot = path.resolve(__dirname, '../..');
const probePath = '/premium-auth-probe';
const normalizeString = (value) => String(value || '').trim();

// Real login UI, cookies, user-store logic, auth routes, page/API guards and
// HTML delivery. Only the persistence adapter and the protected destination
// page are fixtures. No application bootstrap, .env loading or provider calls.
async function startPremiumAuthBrowserServer({ loginReadDelayMs = 0 } = {}) {
  const pagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'softora-auth-browser-'));
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const password = crypto.randomBytes(18).toString('base64url');
  const user = {
    id: 'usr_browser_fixture', email: 'browser@example.test', firstName: 'Browser', lastName: 'Test',
    role: 'admin', status: 'active', authVersion: 2, source: 'managed_ui',
    passwordHash: `sha256:${crypto.createHash('sha256').update(password).digest('hex')}`,
  };
  const state = { loginReadDelayMs, loginUnavailable: false, sessionUnavailable: false };
  const requests = [];
  const errors = [];
  const readCounts = { login: 0, api: 0 };
  function createStore(kind) {
    return createPremiumUsersStore({
      config: {
        premiumLoginEmails: [user.email], premiumLoginPasswordHash: user.passwordHash,
        premiumSessionSecret: sessionSecret, supabaseStateTable: 'browser_fixture_state',
      },
      deps: {
        normalizeString, timingSafeEqualStrings,
        truncateText: (value, length = 500) => normalizeString(value).slice(0, length),
        normalizePremiumSessionEmail: (value) => normalizeString(value).toLowerCase(),
        isSupabaseConfigured: () => true,
        getSupabaseClient: () => ({
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
            readCounts[kind] += 1;
            if (kind === 'login' && state.loginReadDelayMs) {
              await new Promise((resolve) => setTimeout(resolve, state.loginReadDelayMs));
            }
            if (kind === 'login' && state.loginUnavailable) return { data: null, error: { message: 'fixture unavailable' } };
            return { data: { payload: { users: [{ ...user }] }, revision: user.authVersion }, error: null };
          } }) }) }),
        }),
        fetchSupabaseRowByKeyViaRest: async () => ({ ok: false, error: 'fixture unavailable' }),
      },
    });
  }
  const loginStore = createStore('login');
  const apiStore = createStore('api');
  let server;
  try {
    await Promise.all([
      fs.copyFile(path.join(repoRoot, 'premium-personeel-login.html'), path.join(pagesDir, 'premium-personeel-login.html')),
      fs.copyFile(path.join(repoRoot, 'test/fixtures/premium-auth-probe.html'), path.join(pagesDir, 'premium-auth-probe.html')),
      apiStore.ensureUsersHydrated(),
    ]);
    const runtime = createPremiumAuthRuntime({ sessionSecret, isPremiumAuthConfigured: () => true });
    const auth = createPremiumAuthStateManager({
      sessionSecret, premiumUsersStore: apiStore,
      readSessionTokenFromRequest: runtime.readPremiumSessionTokenFromRequest,
      verifySessionToken: runtime.verifyPremiumSessionToken,
      getRequestPathname: (req) => req.originalUrl,
    });
    const coordinator = createPremiumAuthRouteCoordinator({
      ...runtime, sessionSecret, premiumUsersStore: loginStore,
      getResolvedPremiumAuthState: auth.getResolvedPremiumAuthState,
      buildPremiumAuthSessionPayload: auth.buildPremiumAuthSessionPayload,
      getSafePremiumRedirectPath: (target) => auth.getSafePremiumRedirectPath(target, probePath),
    });
    const pages = createPremiumHtmlPageAccessController({
      premiumPublicHtmlFiles: createPremiumPublicHtmlFilesSet(),
      getResolvedPremiumAuthState: auth.getResolvedPremiumAuthState,
      getSafePremiumRedirectPath: (target) => auth.getSafePremiumRedirectPath(target, probePath),
      clearPremiumSessionCookie: runtime.clearPremiumSessionCookie,
    });
    const html = createHtmlPageCoordinator({
      pagesDir, isProduction: false,
      resolvePremiumHtmlPageAccess: pages.resolvePremiumHtmlPageAccess,
      logger: { error: (...args) => errors.push(args.join(' ')) },
    });
    const api = createPremiumApiAccessGuard({
      isPremiumPublicApiRequest: auth.isPremiumPublicApiRequest,
      getResolvedPremiumAuthState: auth.getResolvedPremiumAuthState,
      clearPremiumSessionCookie: runtime.clearPremiumSessionCookie,
    });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      res.on('finish', () => requests.push({ method: req.method, path: req.path, status: res.statusCode }));
      next();
    });
    app.get('/api/auth/session', (_req, res, next) => state.sessionUnavailable
      ? res.status(503).json({ ok: false }) : next());
    registerPremiumAuthRoutes(app, { coordinator, premiumLoginRateLimiter: (_req, _res, next) => next() });
    app.get('/api/quality-profile', api.requirePremiumApiAccess, (req, res) => {
      res.json(auth.buildPremiumAuthSessionPayload(req.premiumAuth));
    });
    app.use('/assets', express.static(path.join(repoRoot, 'assets')));
    for (const [route, file] of [
      ['/premium-personeel-login', 'premium-personeel-login.html'],
      [probePath, 'premium-auth-probe.html'],
    ]) {
      app.get(route, (req, res, next) => {
        html.sendSeoManagedHtmlPageResponse(req, res, next, file).catch(next);
      });
    }
    app.use((error, _req, res, _next) => {
      errors.push(error.message);
      res.status(500).json({ ok: false, error: 'Fixture error' });
    });
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    return {
      baseUrl: `http://127.0.0.1:${server.address().port}`, probePath,
      credentials: { email: user.email, password }, state, requests, errors, readCounts,
      async revokeSession() {
        user.authVersion += 1;
        await apiStore.ensureUsersHydrated({ force: true, requireFresh: true });
      },
      async stop() {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(pagesDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (server) { server.closeAllConnections(); server.close(); }
    await fs.rm(pagesDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { startPremiumAuthBrowserServer };

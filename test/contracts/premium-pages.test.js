const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createPremiumPublicHtmlFilesSet } = require('../../server/config/premium-public-html-files');
const { createPremiumHtmlPageAccessController } = require('../../server/security/premium-pages');

const repoRoot = path.resolve(__dirname, '../..');

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    redirectCode: null,
    redirectLocation: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    redirect(statusCode, location) {
      this.redirectCode = statusCode;
      this.redirectLocation = location;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.headers['Content-Type'] = 'application/json; charset=utf-8';
      this.body = body;
      return this;
    },
  };
}

function createRequest(overrides = {}) {
  return {
    query: {},
    originalUrl: '/',
    url: '/',
    path: '/',
    get: () => 'agent',
    ...overrides,
  };
}

test('premium html page access controller recognizes protected premium html files', () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
  });

  assert.equal(controller.isPremiumProtectedHtmlFile('premium-personeel-agenda.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-personeel-login.html'), false);
  assert.equal(controller.isPremiumProtectedHtmlFile('index.html'), false);
});

test('marketing premium landing pages are not auth-gated', () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: createPremiumPublicHtmlFilesSet(),
  });
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-bedrijfssoftware.html'), false);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-voicesoftware.html'), false);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-chatbot.html'), false);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-websites.html'), false);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-blog.html'), false);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-pakketten.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-seo.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-websitegenerator.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-bevestigingsmails.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-coldmailing-lead.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-personeel-dashboard.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-flynow.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('live-momentum.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('premium-wachtwoordenregister.html'), true);
  assert.equal(controller.isPremiumProtectedHtmlFile('sportschool.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('premium-instellingen.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('premium-wachtwoordenregister.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('premium-flynow.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('premium-omzetwerk.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('live-momentum.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('live-momentum-access.html'), true);
  assert.equal(controller.isPremiumAdminOnlyHtmlFile('sportschool.html'), true);
});

test('premium login page redirects authenticated users to a safe next path', async () => {
  const resolverCalls = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async (_req, options) => {
      resolverCalls.push(options);
      return { configured: true, authenticated: true };
    },
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') => {
      const target = String(value || '').trim();
      return target.startsWith('/') && !target.startsWith('//') && !target.includes('://') ? target : fallback;
    },
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-login?next=%2Fpremium-users',
    query: { next: '/premium-users' },
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-login.html');

  assert.equal(result.handled, true);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex');
  assert.equal(res.redirectCode, 302);
  assert.equal(res.redirectLocation, '/premium-users');
  assert.deepEqual(resolverCalls, [
    {
      allowAnonymousWithoutHydration: true,
      allowTokenFallbackWithoutHydration: true,
    },
  ]);
});

test('premium login page logout mode clears the session cookie and stays on the page', async () => {
  const cleared = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({ configured: true, authenticated: true }),
    clearPremiumSessionCookie: () => cleared.push(true),
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-login?logout=1',
    query: { logout: '1' },
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-login.html');

  assert.equal(result.handled, false);
  assert.equal(cleared.length, 1);
  assert.equal(res.redirectCode, null);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
});

test('protected premium pages redirect to setup when auth is not configured', async () => {
  const resolverCalls = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async (_req, options) => {
      resolverCalls.push(options);
      return { configured: false, authenticated: false };
    },
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-agenda',
    path: '/premium-personeel-agenda',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-agenda.html');

  assert.equal(result.handled, true);
  assert.equal(res.redirectCode, 302);
  assert.equal(
    res.redirectLocation,
    '/premium-personeel-login?setup=1&next=%2Fpremium-personeel-agenda'
  );
  assert.deepEqual(resolverCalls, [
    {
      allowAnonymousWithoutHydration: true,
      allowTokenFallbackWithoutHydration: true,
    },
  ]);
});

test('internal premium tool pages require login for anonymous visitors', async () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: createPremiumPublicHtmlFilesSet(),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({ configured: true, authenticated: false }),
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const protectedToolPages = [
    ['premium-bevestigingsmails.html', '/premium-bevestigingsmails'],
    ['premium-coldmailing-lead.html', '/premium-coldmailing-lead'],
    ['premium-pakketten.html', '/premium-pakketten'],
    ['premium-seo.html', '/premium-seo'],
    ['premium-websitegenerator.html', '/premium-websitegenerator'],
  ];

  for (const [fileName, requestPath] of protectedToolPages) {
    const req = createRequest({
      originalUrl: requestPath,
      path: requestPath,
    });
    const res = createResponseRecorder();

    const result = await controller.resolvePremiumHtmlPageAccess(req, res, fileName);

    assert.equal(result.handled, true, fileName);
    assert.equal(result.isProtectedPremiumPage, true, fileName);
    assert.equal(res.redirectCode, 302, fileName);
    assert.equal(
      res.redirectLocation,
      `/premium-personeel-login?next=${encodeURIComponent(requestPath)}`,
      fileName
    );
    assert.equal(res.headers['Cache-Control'], 'no-store, private', fileName);
    assert.equal(res.headers['X-Robots-Tag'], 'noindex', fileName);
  }
});

test('vercel redirects direct premium html files so static serving cannot bypass auth', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
  const premiumHtmlRedirect = (vercelConfig.redirects || []).find(
    (redirect) => redirect && redirect.source === '/premium-:slug.html'
  );

  assert.ok(premiumHtmlRedirect, 'Vercel must redirect direct premium .html URLs before filesystem routes.');
  assert.equal(premiumHtmlRedirect.destination, '/premium-:slug');
  assert.equal(premiumHtmlRedirect.permanent, false);
});

test('protected premium pages clear expired sessions and redirect to login', async () => {
  const cleared = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: false,
      expired: true,
      revoked: false,
    }),
    clearPremiumSessionCookie: () => cleared.push(true),
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-agenda',
    path: '/premium-personeel-agenda',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-agenda.html');

  assert.equal(result.handled, true);
  assert.equal(cleared.length, 1);
  assert.equal(res.redirectCode, 302);
  assert.equal(res.redirectLocation, '/premium-personeel-login?next=%2Fpremium-personeel-agenda&expired=1&logout=1');
});

test('protected premium pages clear invalid session cookies and explain the logout', async () => {
  const cleared = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: false,
      expired: false,
      revoked: false,
      token: 'invalid-session-token',
    }),
    clearPremiumSessionCookie: () => cleared.push(true),
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-agenda',
    path: '/premium-personeel-agenda',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-agenda.html');

  assert.equal(result.handled, true);
  assert.equal(cleared.length, 1);
  assert.equal(res.redirectCode, 302);
  assert.equal(res.redirectLocation, '/premium-personeel-login?next=%2Fpremium-personeel-agenda&expired=1&logout=1');
});

test('protected premium pages block disallowed admin ips and emit an audit event', async () => {
  const events = [];
  const cleared = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      email: 'admin@softora.nl',
    }),
    isPremiumAdminIpAllowed: () => false,
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    clearPremiumSessionCookie: () => cleared.push(true),
    getClientIpFromRequest: () => '203.0.113.10',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-agenda',
    path: '/premium-personeel-agenda',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-agenda.html');

  assert.equal(result.handled, true);
  assert.equal(cleared.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'security_admin_ip_blocked');
  assert.equal(res.redirectLocation, '/premium-personeel-login?blocked=1');
});

test('protected premium pages allow authenticated users from approved admin ips', async () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      email: 'admin@softora.nl',
    }),
    isPremiumAdminIpAllowed: () => true,
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-personeel-agenda',
    path: '/premium-personeel-agenda',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-personeel-agenda.html');

  assert.equal(result.handled, false);
  assert.equal(req.premiumAuth?.authenticated, true);
  assert.equal(req.premiumAuth?.email, 'admin@softora.nl');
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex');
  assert.equal(res.redirectCode, null);
});

test('admin-only premium pages redirect non-admin users back to the dashboard and emit an audit event', async () => {
  const events = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    premiumAdminOnlyHtmlFiles: new Set(['premium-wachtwoordenregister.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      email: 'medewerker@softora.nl',
      isAdmin: false,
      user: { id: 'usr_staff_test', status: 'active' },
      freshUserValidated: true,
    }),
    isPremiumAdminIpAllowed: () => true,
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    getClientIpFromRequest: () => '203.0.113.11',
    getRequestOriginFromHeaders: () => 'https://app.softora.nl',
    getSafePremiumRedirectPath: (value, fallback = '/premium-personeel-dashboard') =>
      String(value || '').trim() || fallback,
  });

  const req = createRequest({
    originalUrl: '/premium-wachtwoordenregister',
    path: '/premium-wachtwoordenregister',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-wachtwoordenregister.html');

  assert.equal(result.handled, true);
  assert.equal(result.isAdminOnlyPremiumPage, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'security_premium_admin_page_required');
  assert.equal(events[0].payload.type, 'premium_admin_page_required');
  assert.equal(res.redirectCode, 302);
  assert.equal(res.redirectLocation, '/premium-personeel-dashboard?forbidden=1');
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex');
});

test('password register page requires explicit owner configuration and blocks other admins', async () => {
  const events = [];
  const baseOptions = {
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    premiumAdminOnlyHtmlFiles: new Set(['premium-wachtwoordenregister.html']),
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      isAdmin: true,
      userId: 'usr_admin_test',
      user: { id: 'usr_admin_test', status: 'active' },
      freshUserValidated: true,
    }),
    isPremiumAdminIpAllowed: () => true,
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    getSafePremiumRedirectPath: (value) => String(value || '').trim(),
  };
  const req = createRequest({
    originalUrl: '/premium-wachtwoordenregister',
    path: '/premium-wachtwoordenregister',
  });

  const missingConfigController = createPremiumHtmlPageAccessController({
    ...baseOptions,
    passwordRegisterOwnerPolicy: {
      getAccessDecision: () => ({
        ok: false,
        statusCode: 503,
        code: 'PASSWORD_REGISTER_OWNER_NOT_CONFIGURED',
        error: 'Ownerconfiguratie ontbreekt.',
      }),
    },
  });
  const missingConfigRes = createResponseRecorder();
  const missingConfigResult = await missingConfigController.resolvePremiumHtmlPageAccess(
    req,
    missingConfigRes,
    'premium-wachtwoordenregister.html'
  );
  assert.equal(missingConfigResult.handled, false);
  assert.equal(missingConfigResult.responseStatusCode, 503);
  assert.equal(missingConfigResult.passwordRegisterAuthRecovery.code, 'PASSWORD_REGISTER_OWNER_NOT_CONFIGURED');
  assert.equal(missingConfigRes.statusCode, null);

  const otherAdminController = createPremiumHtmlPageAccessController({
    ...baseOptions,
    passwordRegisterOwnerPolicy: {
      getAccessDecision: () => ({
        ok: false,
        statusCode: 403,
        code: 'PASSWORD_REGISTER_OWNER_REQUIRED',
        error: 'Alleen de eigenaar heeft toegang.',
      }),
    },
  });
  const otherAdminRes = createResponseRecorder();
  const otherAdminResult = await otherAdminController.resolvePremiumHtmlPageAccess(
    req,
    otherAdminRes,
    'premium-wachtwoordenregister.html'
  );
  assert.equal(otherAdminResult.handled, false);
  assert.equal(otherAdminResult.responseStatusCode, 403);
  assert.equal(otherAdminResult.passwordRegisterAuthRecovery.code, 'PASSWORD_REGISTER_OWNER_REQUIRED');
  assert.equal(otherAdminRes.statusCode, null);
  assert.equal(events.at(-1).reason, 'security_password_register_owner_denied');
});

test('password register page allows only the configured owner', async () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    premiumAdminOnlyHtmlFiles: new Set(['premium-wachtwoordenregister.html']),
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      isAdmin: true,
      userId: 'usr_owner_test',
      user: { id: 'usr_owner_test', status: 'active' },
      freshUserValidated: true,
    }),
    isPremiumAdminIpAllowed: () => true,
    getSafePremiumRedirectPath: (value) => String(value || '').trim(),
    passwordRegisterOwnerPolicy: {
      getAccessDecision: (authState) => authState.userId === 'usr_owner_test'
        ? { ok: true }
        : { ok: false, statusCode: 403 },
    },
  });
  const req = createRequest({ originalUrl: '/premium-wachtwoordenregister' });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(
    req,
    res,
    'premium-wachtwoordenregister.html'
  );

  assert.equal(result.handled, false);
  assert.equal(res.statusCode, null);
});

test('password register page renders a fail-closed HTML recovery shell when fresh hydration fails', async () => {
  let resolverOptions = null;
  const events = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-personeel-login.html']),
    premiumAdminOnlyHtmlFiles: new Set(['premium-wachtwoordenregister.html']),
    getResolvedPremiumAuthState: async (_req, options) => {
      resolverOptions = options;
      return {
        configured: true,
        authenticated: true,
        isAdmin: true,
        userId: 'usr_owner_test',
        tokenFallback: true,
        user: null,
      };
    },
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
    isPremiumAdminIpAllowed: () => true,
    getSafePremiumRedirectPath: (value) => String(value || '').trim(),
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(
    createRequest({ originalUrl: '/premium-wachtwoordenregister' }),
    res,
    'premium-wachtwoordenregister.html'
  );

  assert.equal(result.handled, false);
  assert.equal(result.responseStatusCode, 503);
  assert.deepEqual(result.passwordRegisterAuthRecovery, {
    code: 'PASSWORD_REGISTER_FRESH_AUTH_UNAVAILABLE',
    retryable: true,
  });
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.headers.Vary, 'Accept, Cookie');
  assert.equal(resolverOptions.allowTokenFallbackWithoutHydration, false);
  assert.equal(resolverOptions.requireFreshUserHydration, true);
  assert.equal(events.at(-1).reason, 'security_password_register_fresh_auth_required');
});

test('password register page returns a machine-readable 503 for the same fresh hydration failure', async () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumAdminOnlyHtmlFiles: new Set(['premium-wachtwoordenregister.html']),
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: false,
      hydrationUnavailable: true,
    }),
    getSafePremiumRedirectPath: (value) => String(value || '').trim(),
  });
  const req = createRequest({
    originalUrl: '/premium-wachtwoordenregister',
    get: (name) => String(name || '').toLowerCase() === 'accept' ? 'application/json' : 'agent',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-wachtwoordenregister.html');

  assert.equal(result.handled, true);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    code: 'PASSWORD_REGISTER_FRESH_AUTH_UNAVAILABLE',
    retryable: true,
    error: 'De beveiligde sessiecontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.',
  });
  assert.equal(res.headers.Vary, 'Accept, Cookie');
  assert.match(res.headers['Content-Type'], /application\/json/);
});

test('password register JSON preflight distinguishes fresh, missing and expired sessions', async () => {
  const states = [
    {
      state: {
        configured: true,
        authenticated: true,
        isAdmin: true,
        userId: 'usr_owner',
        user: { id: 'usr_owner', status: 'active' },
        freshUserValidated: true,
      },
      status: 200,
      code: 'PASSWORD_REGISTER_FRESH_AUTH_CONFIRMED',
      cleared: 0,
    },
    {
      state: { configured: true, authenticated: false },
      status: 401,
      code: 'PREMIUM_AUTH_REQUIRED',
      cleared: 0,
    },
    {
      state: { configured: true, authenticated: false, token: 'forged-test-token', revoked: true },
      status: 401,
      code: 'PREMIUM_SESSION_EXPIRED',
      cleared: 1,
    },
  ];

  for (const fixture of states) {
    let cleared = 0;
    const controller = createPremiumHtmlPageAccessController({
      premiumAdminOnlyHtmlFiles: new Set(['premium-wachtwoordenregister.html']),
      getResolvedPremiumAuthState: async () => fixture.state,
      clearPremiumSessionCookie: () => { cleared += 1; },
      isPremiumAdminIpAllowed: () => true,
      getSafePremiumRedirectPath: (value) => String(value || '').trim(),
      passwordRegisterOwnerPolicy: {
        getAccessDecision: () => ({ ok: true }),
      },
    });
    const req = createRequest({
      originalUrl: '/premium-wachtwoordenregister',
      get: (name) => String(name || '').toLowerCase() === 'accept' ? 'application/json' : 'agent',
    });
    const res = createResponseRecorder();

    await controller.resolvePremiumHtmlPageAccess(req, res, 'premium-wachtwoordenregister.html');

    assert.equal(res.statusCode, fixture.status);
    assert.equal(res.body.code, fixture.code);
    assert.equal(cleared, fixture.cleared);
    assert.equal(res.redirectCode, null);
  }
});

test('live momentum renders its separate code gate on the requested page for an authenticated admin', async () => {
  const events = [];
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: createPremiumPublicHtmlFilesSet(),
    premiumAdminOnlyHtmlFiles: new Set(['live-momentum.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      email: 'serve@softora.test',
      isAdmin: true,
    }),
    isPremiumAdminIpAllowed: () => true,
    hasLiveMomentumAccess: () => false,
    appendSecurityAuditEvent: (payload, reason) => events.push({ payload, reason }),
  });
  const req = createRequest({
    originalUrl: '/live-momentum',
    path: '/live-momentum',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'live-momentum.html');

  assert.equal(result.handled, false);
  assert.equal(result.renderFileName, 'live-momentum-access.html');
  assert.equal(result.liveMomentumAccessRequired, true);
  assert.equal(res.redirectCode, null);
  assert.equal(events[0].reason, 'security_live_momentum_code_required');
});

test('live momentum opens after the separate code gate grants access', async () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: createPremiumPublicHtmlFilesSet(),
    premiumAdminOnlyHtmlFiles: new Set(['live-momentum.html']),
    getResolvedPremiumAuthState: async () => ({
      configured: true,
      authenticated: true,
      email: 'serve@softora.test',
      isAdmin: true,
    }),
    isPremiumAdminIpAllowed: () => true,
    hasLiveMomentumAccess: () => true,
  });
  const req = createRequest({
    originalUrl: '/live-momentum',
    path: '/live-momentum',
  });
  const res = createResponseRecorder();

  const result = await controller.resolvePremiumHtmlPageAccess(req, res, 'live-momentum.html');

  assert.equal(result.handled, false);
  assert.equal(res.redirectCode, null);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumHtmlPageAccessController } = require('../../server/security/premium-pages');

function createResponseRecorder() {
  return {
    headers: {},
    redirectCode: null,
    redirectLocation: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    redirect(statusCode, location) {
      this.redirectCode = statusCode;
      this.redirectLocation = location;
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

test('premium login page redirects authenticated users to a safe next path', async () => {
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({ configured: true, authenticated: true }),
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
  const controller = createPremiumHtmlPageAccessController({
    premiumPublicHtmlFiles: new Set(['premium-website.html', 'premium-personeel-login.html']),
    noindexHeaderValue: 'noindex',
    getResolvedPremiumAuthState: async () => ({ configured: false, authenticated: false }),
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
  assert.equal(res.redirectLocation, '/premium-personeel-login?next=%2Fpremium-personeel-agenda');
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
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex');
  assert.equal(res.redirectCode, null);
});

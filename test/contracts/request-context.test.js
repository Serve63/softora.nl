const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRequestSecurityContext,
  getClientIpFromRequest,
  getRequestContentType,
  getRequestFetchSite,
  getRequestOriginFromHeaders,
  getRequestPathname,
  isJsonLikeContentType,
  isSecureHttpRequest,
  normalizeIpAddress,
  normalizeOrigin,
} = require('../../server/security/request-context');

function createRequest({
  headers = {},
  method = 'GET',
  originalUrl = '/',
  path = '/',
  ip = '',
  secure = false,
  socketRemoteAddress = '',
} = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  return {
    method,
    originalUrl,
    path,
    ip,
    secure,
    socket: { remoteAddress: socketRemoteAddress },
    get(name) {
      return normalizedHeaders[String(name || '').toLowerCase()] || '';
    },
  };
}

test('normalizeIpAddress normalizes ipv4-mapped ipv6 and loopback', () => {
  assert.equal(normalizeIpAddress('::ffff:192.168.1.4'), '192.168.1.4');
  assert.equal(normalizeIpAddress('::1'), '127.0.0.1');
  assert.equal(normalizeIpAddress('fe80::1%lo0'), 'fe80::1');
});

test('getRequestPathname strips the query string', () => {
  const req = createRequest({ originalUrl: '/api/test?foo=bar&x=1' });
  assert.equal(getRequestPathname(req), '/api/test');
});

test('getRequestPathname falls back to mounted route urls without losing the api prefix match', () => {
  const req = createRequest({ originalUrl: '', path: '/retell/functions/agenda/availability/' });
  assert.equal(getRequestPathname(req), '/retell/functions/agenda/availability/');
});

test('getClientIpFromRequest prefers forwarded-for and normalizes values', () => {
  const req = createRequest({
    headers: { 'x-forwarded-for': '::ffff:203.0.113.10, 10.0.0.1' },
    ip: '127.0.0.1',
  });
  assert.equal(getClientIpFromRequest(req), '203.0.113.10');
});

test('isSecureHttpRequest respects secure flag and forwarded proto', () => {
  assert.equal(isSecureHttpRequest(createRequest({ secure: true })), true);
  assert.equal(
    isSecureHttpRequest(createRequest({ headers: { 'x-forwarded-proto': 'https' } })),
    true
  );
  assert.equal(isSecureHttpRequest(createRequest({ headers: { 'x-forwarded-proto': 'http' } })), false);
});

test('normalizeOrigin and request origin extraction normalize origin/referer headers', () => {
  assert.equal(normalizeOrigin('https://example.com/demo?q=1'), 'https://example.com');
  const refererReq = createRequest({
    headers: { referer: 'https://app.softora.nl/dashboard?tab=1' },
  });
  assert.equal(getRequestOriginFromHeaders(refererReq), 'https://app.softora.nl');
});

test('request content-type and fetch-site helpers normalize security headers', () => {
  const req = createRequest({
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'sec-fetch-site': 'same-origin',
    },
  });

  assert.equal(getRequestContentType(req), 'application/json');
  assert.equal(getRequestFetchSite(req), 'same-origin');
  assert.equal(isJsonLikeContentType('application/merge-patch+json'), true);
  assert.equal(isJsonLikeContentType('multipart/form-data'), false);
});

test('request security context allows same-origin mutations and blocks foreign origins', () => {
  const context = createRequestSecurityContext({
    enforceSameOriginRequests: true,
    getEffectivePublicBaseUrl: () => 'https://app.softora.nl',
  });

  const allowedReq = createRequest({
    method: 'POST',
    headers: {
      origin: 'https://app.softora.nl',
      host: 'app.softora.nl',
      'x-forwarded-proto': 'https',
    },
    originalUrl: '/api/custom-action',
  });

  const blockedReq = createRequest({
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      host: 'app.softora.nl',
      'x-forwarded-proto': 'https',
    },
    originalUrl: '/api/custom-action',
  });

  assert.equal(context.isSameOriginApiRequest(allowedReq), true);
  assert.equal(context.isSameOriginApiRequest(blockedReq), false);
  assert.equal(context.getStateChangingApiProtectionDecision(blockedReq).reason, 'csrf_origin_blocked');
});

test('request security context exempts safe methods and webhook paths', () => {
  const context = createRequestSecurityContext({
    enforceSameOriginRequests: true,
    getEffectivePublicBaseUrl: () => 'https://app.softora.nl',
  });

  const getReq = createRequest({ method: 'GET', originalUrl: '/api/custom-action' });
  const webhookReq = createRequest({ method: 'POST', originalUrl: '/api/retell/webhook' });
  const retellFunctionReq = createRequest({
    method: 'POST',
    originalUrl: '/api/retell/functions/agenda/availability',
  });
  const mountedRetellAvailabilityReq = createRequest({
    method: 'POST',
    originalUrl: '/retell/functions/agenda/availability/',
  });
  const namespacedRetellAvailabilityReq = createRequest({
    method: 'POST',
    originalUrl: '/api/retell/functions/agenda/availability/run',
  });

  assert.equal(context.isSameOriginApiRequest(getReq), true);
  assert.equal(context.isSameOriginApiRequest(webhookReq), true);
  assert.equal(context.isSameOriginApiRequest(retellFunctionReq), true);
  assert.equal(context.isSameOriginApiRequest(mountedRetellAvailabilityReq), true);
  assert.equal(context.isSameOriginApiRequest(namespacedRetellAvailabilityReq), true);
});

test('request security context blocks cross-site fetch metadata before same-origin checks', () => {
  const context = createRequestSecurityContext({
    enforceSameOriginRequests: true,
    getEffectivePublicBaseUrl: () => 'https://app.softora.nl',
  });

  const req = createRequest({
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      host: 'app.softora.nl',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
      'content-length': '2',
    },
    originalUrl: '/api/custom-action',
  });

  const decision = context.getStateChangingApiProtectionDecision(req);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'fetch_metadata_cross_site_blocked');
});

test('request security context blocks form-style content types for state-changing api requests', () => {
  const context = createRequestSecurityContext({
    enforceSameOriginRequests: true,
    getEffectivePublicBaseUrl: () => 'https://app.softora.nl',
  });

  const req = createRequest({
    method: 'POST',
    headers: {
      origin: 'https://app.softora.nl',
      host: 'app.softora.nl',
      'x-forwarded-proto': 'https',
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '12',
    },
    originalUrl: '/api/custom-action',
  });

  const decision = context.getStateChangingApiProtectionDecision(req);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'state_changing_content_type_blocked');
});

test('request security context allows same-origin fetch metadata when origin header is absent', () => {
  const context = createRequestSecurityContext({
    enforceSameOriginRequests: true,
    getEffectivePublicBaseUrl: () => 'https://app.softora.nl',
  });

  const req = createRequest({
    method: 'POST',
    headers: {
      host: 'app.softora.nl',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'content-length': '2',
    },
    originalUrl: '/api/custom-action',
  });

  const decision = context.getStateChangingApiProtectionDecision(req);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'fetch_metadata_same_origin_allowed');
});

test('request security context enforces premium admin ip allowlist', () => {
  const context = createRequestSecurityContext({
    premiumAdminAllowedIpSet: new Set(['203.0.113.10']),
  });

  const allowedReq = createRequest({ headers: { 'x-forwarded-for': '203.0.113.10' } });
  const blockedReq = createRequest({ headers: { 'x-forwarded-for': '203.0.113.11' } });

  assert.equal(context.isPremiumAdminIpAllowed(allowedReq), true);
  assert.equal(context.isPremiumAdminIpAllowed(blockedReq), false);
});

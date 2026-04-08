const { normalizeAbsoluteHttpUrl } = require('./public-url');

const SAME_ORIGIN_PROTECTION_EXEMPT_PATHS = new Set([
  '/api/healthz',
  '/api/health/baseline',
  '/api/health/dependencies',
  '/api/twilio/voice',
  '/api/twilio/status',
  '/api/retell/webhook',
]);

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function getRequestPathname(req) {
  const rawUrl = normalizeString(req?.originalUrl || req?.url || req?.path || '/');
  const questionMarkIndex = rawUrl.indexOf('?');
  return questionMarkIndex >= 0 ? rawUrl.slice(0, questionMarkIndex) : rawUrl;
}

function normalizeIpAddress(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const noZone = raw.replace(/%.+$/, '');
  const ipv4Mapped = noZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) return ipv4Mapped[1];
  if (noZone === '::1') return '127.0.0.1';
  return noZone;
}

function getClientIpFromRequest(req) {
  const forwardedFor = normalizeString(req?.get?.('x-forwarded-for') || '');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0];
    const normalized = normalizeIpAddress(first);
    if (normalized) return normalized;
  }

  return normalizeIpAddress(req?.ip || req?.socket?.remoteAddress || '');
}

function isSecureHttpRequest(req) {
  if (req?.secure) return true;
  const forwardedProto = normalizeString(req?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function normalizeOrigin(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return '';
  }
}

function getRequestOriginFromHeaders(req) {
  const originHeader = normalizeOrigin(req?.get?.('origin') || '');
  if (originHeader) return originHeader;
  const refererHeader = normalizeOrigin(req?.get?.('referer') || '');
  if (refererHeader) return refererHeader;
  return '';
}

function isSafeHttpMethod(methodRaw) {
  const method = normalizeString(methodRaw || '').toUpperCase();
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function createRequestSecurityContext(options = {}) {
  const {
    enforceSameOriginRequests = true,
    getEffectivePublicBaseUrl = () => '',
    premiumAdminAllowedIpSet = new Set(),
  } = options;

  function getAllowedSameOriginSet(req) {
    const allowed = new Set();
    const publicBaseUrl = normalizeAbsoluteHttpUrl(getEffectivePublicBaseUrl(req));
    if (publicBaseUrl) {
      try {
        allowed.add(new URL(publicBaseUrl).origin.toLowerCase());
      } catch {}
    }

    const host = normalizeString(req?.get?.('host') || '');
    const protocol = isSecureHttpRequest(req) ? 'https' : 'http';
    if (host) {
      allowed.add(`${protocol}://${host}`.toLowerCase());
    }

    return allowed;
  }

  function isSameOriginProtectionExemptRequest(req) {
    const requestPath = normalizeString(getRequestPathname(req) || '');
    return SAME_ORIGIN_PROTECTION_EXEMPT_PATHS.has(requestPath);
  }

  function isSameOriginApiRequest(req) {
    if (!enforceSameOriginRequests) return true;
    if (isSafeHttpMethod(req?.method)) return true;
    if (isSameOriginProtectionExemptRequest(req)) return true;

    const requestOrigin = getRequestOriginFromHeaders(req);
    if (!requestOrigin) return false;

    const allowedOrigins = getAllowedSameOriginSet(req);
    return allowedOrigins.has(requestOrigin);
  }

  function isPremiumAdminIpAllowed(req) {
    if (premiumAdminAllowedIpSet.size === 0) return true;
    const clientIp = getClientIpFromRequest(req);
    return clientIp ? premiumAdminAllowedIpSet.has(clientIp) : false;
  }

  return {
    getAllowedSameOriginSet,
    isPremiumAdminIpAllowed,
    isSameOriginApiRequest,
    isSameOriginProtectionExemptRequest,
  };
}

module.exports = {
  createRequestSecurityContext,
  getClientIpFromRequest,
  getRequestOriginFromHeaders,
  getRequestPathname,
  isSafeHttpMethod,
  isSecureHttpRequest,
  normalizeIpAddress,
  normalizeOrigin,
};

const { normalizeAbsoluteHttpUrl } = require('./public-url');

const SAME_ORIGIN_PROTECTION_EXEMPT_PATHS = new Set([
  '/api/healthz',
  '/api/health/baseline',
  '/api/health/dependencies',
  '/api/twilio/voice',
  '/api/twilio/status',
  '/api/retell/webhook',
]);

const JSON_LIKE_CONTENT_TYPE_PATTERN = /^application\/([a-z0-9.+-]+\+)?json$/i;
const BLOCKED_STATE_CHANGING_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
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

function getRequestFetchSite(req) {
  return normalizeString(req?.get?.('sec-fetch-site') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function getRequestContentType(req) {
  return normalizeString(req?.get?.('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function isJsonLikeContentType(value) {
  return JSON_LIKE_CONTENT_TYPE_PATTERN.test(normalizeString(value).toLowerCase());
}

function requestMayCarryBody(req) {
  if (isSafeHttpMethod(req?.method)) return false;

  const contentLength = normalizeString(req?.get?.('content-length') || '');
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > 0) return true;
  }

  if (normalizeString(req?.get?.('transfer-encoding') || '')) return true;
  if (getRequestContentType(req)) return true;
  return false;
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

  function getStateChangingApiProtectionDecision(req) {
    if (!enforceSameOriginRequests) {
      return { allowed: true, reason: 'disabled', detail: '' };
    }
    if (isSafeHttpMethod(req?.method)) {
      return { allowed: true, reason: 'safe_method', detail: '' };
    }
    if (isSameOriginProtectionExemptRequest(req)) {
      return { allowed: true, reason: 'exempt_path', detail: '' };
    }

    const fetchSite = getRequestFetchSite(req);
    if (fetchSite === 'cross-site') {
      return {
        allowed: false,
        reason: 'fetch_metadata_cross_site_blocked',
        detail: 'State-changing API request geweigerd door Fetch Metadata (cross-site).',
        publicMessage: 'Verzoek geweigerd door API-beveiliging.',
      };
    }

    const contentType = getRequestContentType(req);
    if (
      requestMayCarryBody(req) &&
      contentType &&
      BLOCKED_STATE_CHANGING_CONTENT_TYPES.has(contentType) &&
      !isJsonLikeContentType(contentType)
    ) {
      return {
        allowed: false,
        reason: 'state_changing_content_type_blocked',
        detail: `State-changing API request geweigerd door content-type guard (${contentType}).`,
        publicMessage: 'Verzoek geweigerd door API-beveiliging.',
      };
    }

    const requestOrigin = getRequestOriginFromHeaders(req);
    if (requestOrigin) {
      const allowedOrigins = getAllowedSameOriginSet(req);
      const allowed = allowedOrigins.has(requestOrigin);
      return {
        allowed,
        reason: allowed ? 'same_origin_allowed' : 'csrf_origin_blocked',
        detail: allowed ? '' : 'State-changing API request geweigerd door same-origin bescherming.',
        publicMessage: allowed ? '' : 'Verzoek geweigerd door same-origin beveiliging.',
      };
    }

    if (fetchSite === 'same-origin') {
      return {
        allowed: true,
        reason: 'fetch_metadata_same_origin_allowed',
        detail: '',
      };
    }

    return {
      allowed: false,
      reason: 'csrf_origin_missing',
      detail: 'State-changing API request geweigerd omdat Origin/Referer ontbreekt.',
      publicMessage: 'Verzoek geweigerd door same-origin beveiliging.',
    };
  }

  function isSameOriginApiRequest(req) {
    return getStateChangingApiProtectionDecision(req).allowed;
  }

  function isPremiumAdminIpAllowed(req) {
    if (premiumAdminAllowedIpSet.size === 0) return true;
    const clientIp = getClientIpFromRequest(req);
    return clientIp ? premiumAdminAllowedIpSet.has(clientIp) : false;
  }

  return {
    getAllowedSameOriginSet,
    getStateChangingApiProtectionDecision,
    isPremiumAdminIpAllowed,
    isSameOriginApiRequest,
    isSameOriginProtectionExemptRequest,
  };
}

module.exports = {
  createRequestSecurityContext,
  getClientIpFromRequest,
  getRequestContentType,
  getRequestFetchSite,
  getRequestOriginFromHeaders,
  getRequestPathname,
  isJsonLikeContentType,
  isSafeHttpMethod,
  isSecureHttpRequest,
  normalizeIpAddress,
  normalizeOrigin,
};

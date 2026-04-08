const { buildCookieMap, buildSetCookieHeader } = require('./cookies');
const {
  createHmacSha256Base64Url,
  fromBase64Url,
  timingSafeEqualStrings,
  toBase64Url,
} = require('./crypto-utils');

function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function defaultTruncateText(value, maxLength = 500, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createPremiumSessionManager(options = {}) {
  const {
    sessionSecret = '',
    sessionCookieName = 'session',
    defaultSessionTtlMs = 12 * 60 * 60 * 1000,
    isProduction = false,
    isAuthConfigured = () => true,
    isSecureHttpRequest = () => false,
    normalizeString = defaultNormalizeString,
    truncateText = (value, maxLength) => defaultTruncateText(value, maxLength, normalizeString),
    normalizeSessionEmail = (value) => normalizeString(value).toLowerCase(),
    now = Date.now,
  } = options;

  function createSessionToken({ email, maxAgeMs, userId = '', role = '' }) {
    if (!isAuthConfigured()) return '';
    const currentNow = Number(now()) || Date.now();
    const ttlMs = Math.max(60_000, Number(maxAgeMs) || defaultSessionTtlMs);
    const payload = {
      email: normalizeSessionEmail(email),
      uid: truncateText(normalizeString(userId || ''), 120),
      role: truncateText(normalizeString(role || ''), 40).toLowerCase(),
      iat: currentNow,
      exp: currentNow + ttlMs,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = createHmacSha256Base64Url(encodedPayload, sessionSecret);
    return `${encodedPayload}.${signature}`;
  }

  function readSessionTokenFromRequest(req) {
    const cookies = buildCookieMap(req);
    return normalizeString(cookies.get(sessionCookieName) || '');
  }

  function verifySessionToken(token) {
    const rawToken = normalizeString(token);
    if (!rawToken || !sessionSecret) {
      return {
        ok: false,
        expired: false,
        payload: null,
      };
    }

    const separatorIndex = rawToken.lastIndexOf('.');
    if (separatorIndex <= 0) {
      return { ok: false, expired: false, payload: null };
    }

    const encodedPayload = rawToken.slice(0, separatorIndex);
    const signature = rawToken.slice(separatorIndex + 1);
    const expectedSignature = createHmacSha256Base64Url(encodedPayload, sessionSecret);
    if (!timingSafeEqualStrings(signature, expectedSignature)) {
      return { ok: false, expired: false, payload: null };
    }

    try {
      const payload = JSON.parse(fromBase64Url(encodedPayload));
      const email = normalizeSessionEmail(payload?.email);
      const userId = truncateText(normalizeString(payload?.uid || ''), 120);
      const role = truncateText(normalizeString(payload?.role || ''), 40).toLowerCase();
      const expiresAtMs = Number(payload?.exp || 0);
      if (!email || !Number.isFinite(expiresAtMs)) {
        return { ok: false, expired: false, payload: null };
      }
      if (expiresAtMs <= (Number(now()) || Date.now())) {
        return { ok: false, expired: true, payload: payload || null };
      }
      return {
        ok: true,
        expired: false,
        payload: {
          ...payload,
          email,
          uid: userId,
          role,
        },
      };
    } catch {
      return { ok: false, expired: false, payload: null };
    }
  }

  function buildSessionCookieHeader(req, token, maxAgeMs) {
    return buildSetCookieHeader(sessionCookieName, token, {
      path: '/',
      sameSite: 'Lax',
      secure: isSecureHttpRequest(req) || isProduction,
      maxAgeSeconds: Math.max(1, Math.floor(Number(maxAgeMs || 0) / 1000)),
    });
  }

  function buildClearedSessionCookieHeader(req) {
    return buildSetCookieHeader(sessionCookieName, '', {
      path: '/',
      sameSite: 'Lax',
      secure: isSecureHttpRequest(req) || isProduction,
      maxAgeSeconds: 0,
    });
  }

  return {
    buildClearedSessionCookieHeader,
    buildSessionCookieHeader,
    createSessionToken,
    readSessionTokenFromRequest,
    verifySessionToken,
  };
}

module.exports = {
  createPremiumSessionManager,
};

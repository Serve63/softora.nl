const { createPremiumSessionManager } = require('../security/premium-session');
const { createTotpManager } = require('../security/totp');

function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function createPremiumAuthRuntime(options = {}) {
  const {
    mfaTotpSecret = '',
    sessionSecret = '',
    sessionCookieName = 'session',
    premiumSessionTtlHours = 12,
    isProduction = false,
    isPremiumAuthConfigured = () => false,
    isSecureHttpRequest = () => false,
    normalizeString = defaultNormalizeString,
    truncateText = (value) => normalizeString(value),
    normalizePremiumSessionEmail = (value) => normalizeString(value).toLowerCase(),
  } = options;

  let premiumMfaManager = null;
  let premiumSessionManager = null;

  function getPremiumMfaManager() {
    if (premiumMfaManager) return premiumMfaManager;
    premiumMfaManager = createTotpManager({
      secret: mfaTotpSecret,
      normalizeString,
    });
    return premiumMfaManager;
  }

  function isPremiumMfaConfigured() {
    return getPremiumMfaManager().isConfigured();
  }

  function isPremiumMfaCodeValid(codeRaw) {
    return getPremiumMfaManager().isCodeValid(codeRaw);
  }

  function getPremiumSessionManager() {
    if (premiumSessionManager) return premiumSessionManager;
    premiumSessionManager = createPremiumSessionManager({
      sessionSecret,
      sessionCookieName,
      defaultSessionTtlMs: premiumSessionTtlHours * 60 * 60 * 1000,
      isProduction,
      isAuthConfigured: isPremiumAuthConfigured,
      isSecureHttpRequest,
      normalizeString,
      truncateText,
      normalizeSessionEmail: normalizePremiumSessionEmail,
    });
    return premiumSessionManager;
  }

  function createPremiumSessionToken({ email, maxAgeMs, userId = '', role = '' }) {
    return getPremiumSessionManager().createSessionToken({ email, maxAgeMs, userId, role });
  }

  function readPremiumSessionTokenFromRequest(req) {
    return getPremiumSessionManager().readSessionTokenFromRequest(req);
  }

  function verifyPremiumSessionToken(token) {
    return getPremiumSessionManager().verifySessionToken(token);
  }

  function buildPremiumSessionCookieHeader(req, token, maxAgeMs) {
    return getPremiumSessionManager().buildSessionCookieHeader(req, token, maxAgeMs);
  }

  function setPremiumSessionCookie(req, res, token, maxAgeMs) {
    res.append('Set-Cookie', buildPremiumSessionCookieHeader(req, token, maxAgeMs));
  }

  function clearPremiumSessionCookie(req, res) {
    res.append('Set-Cookie', getPremiumSessionManager().buildClearedSessionCookieHeader(req));
  }

  return {
    buildPremiumSessionCookieHeader,
    clearPremiumSessionCookie,
    createPremiumSessionToken,
    getPremiumMfaManager,
    getPremiumSessionManager,
    isPremiumMfaCodeValid,
    isPremiumMfaConfigured,
    readPremiumSessionTokenFromRequest,
    setPremiumSessionCookie,
    verifyPremiumSessionToken,
  };
}

module.exports = {
  createPremiumAuthRuntime,
};

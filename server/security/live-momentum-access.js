const { timingSafeEqualStrings } = require('./crypto-utils');
const { createPremiumSessionManager } = require('./premium-session');

const LIVE_MOMENTUM_ACCESS_CODE = '808080';
const LIVE_MOMENTUM_ACCESS_COOKIE_NAME = 'softora_live_momentum_access';
const LIVE_MOMENTUM_ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const LIVE_MOMENTUM_ACCESS_USER_ID = 'live-momentum';
const LIVE_MOMENTUM_ACCESS_ROLE = 'gate';

function createLiveMomentumAccessGate(options = {}) {
  const {
    sessionSecret = '',
    accessCode = LIVE_MOMENTUM_ACCESS_CODE,
    accessTtlMs = LIVE_MOMENTUM_ACCESS_TTL_MS,
    isProduction = false,
    isSecureHttpRequest = () => false,
    normalizeSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    now = Date.now,
  } = options;

  const sessionManager = createPremiumSessionManager({
    sessionSecret,
    sessionCookieName: LIVE_MOMENTUM_ACCESS_COOKIE_NAME,
    defaultSessionTtlMs: accessTtlMs,
    isProduction,
    isAuthConfigured: () => Boolean(sessionSecret),
    isSecureHttpRequest,
    normalizeSessionEmail,
    now,
  });

  function isEligibleAdmin(authState) {
    return Boolean(authState?.authenticated && authState?.isAdmin && normalizeSessionEmail(authState.email));
  }

  function hasLiveMomentumAccess(req, authState) {
    if (!isEligibleAdmin(authState)) return false;
    const token = sessionManager.readSessionTokenFromRequest(req);
    const verification = sessionManager.verifySessionToken(token);
    if (!verification.ok) return false;
    return Boolean(
      normalizeSessionEmail(verification.payload?.email) === normalizeSessionEmail(authState.email) &&
        verification.payload?.uid === LIVE_MOMENTUM_ACCESS_USER_ID &&
        verification.payload?.role === LIVE_MOMENTUM_ACCESS_ROLE
    );
  }

  function grantLiveMomentumAccess(req, res, authState, suppliedCode) {
    if (!isEligibleAdmin(authState)) {
      return { ok: false, status: 403, error: 'Alleen een beheerder kan Winnen openen.' };
    }
    if (!timingSafeEqualStrings(String(suppliedCode || '').trim(), String(accessCode || '').trim())) {
      return { ok: false, status: 403, error: 'Toegangscode is onjuist.' };
    }

    const token = sessionManager.createSessionToken({
      email: authState.email,
      userId: LIVE_MOMENTUM_ACCESS_USER_ID,
      role: LIVE_MOMENTUM_ACCESS_ROLE,
      maxAgeMs: accessTtlMs,
    });
    if (!token) {
      return { ok: false, status: 503, error: 'Beveiligde toegang is niet beschikbaar.' };
    }

    res.append('Set-Cookie', sessionManager.buildSessionCookieHeader(req, token, accessTtlMs));
    return { ok: true, status: 200, expiresInMs: accessTtlMs };
  }

  return {
    grantLiveMomentumAccess,
    hasLiveMomentumAccess,
  };
}

module.exports = {
  LIVE_MOMENTUM_ACCESS_COOKIE_NAME,
  LIVE_MOMENTUM_ACCESS_TTL_MS,
  createLiveMomentumAccessGate,
};

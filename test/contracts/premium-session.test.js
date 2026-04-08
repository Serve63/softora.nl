const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumSessionManager } = require('../../server/security/premium-session');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

test('premium session manager creates and verifies a valid token', () => {
  let nowMs = 1_700_000_000_000;
  const manager = createPremiumSessionManager({
    sessionSecret: 'secret',
    sessionCookieName: 'softora_session',
    defaultSessionTtlMs: 60 * 60 * 1000,
    isAuthConfigured: () => true,
    isSecureHttpRequest: () => true,
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
    now: () => nowMs,
  });

  const token = manager.createSessionToken({
    email: 'INFO@SOFTORA.NL',
    userId: 'usr_123',
    role: 'ADMIN',
  });
  const verification = manager.verifySessionToken(token);

  assert.equal(typeof token, 'string');
  assert.equal(verification.ok, true);
  assert.equal(verification.payload.email, 'info@softora.nl');
  assert.equal(verification.payload.uid, 'usr_123');
  assert.equal(verification.payload.role, 'admin');

  nowMs += 60 * 60 * 1000 + 1;
  const expired = manager.verifySessionToken(token);
  assert.equal(expired.ok, false);
  assert.equal(expired.expired, true);
});

test('premium session manager rejects invalid signatures and can read cookies', () => {
  const manager = createPremiumSessionManager({
    sessionSecret: 'secret',
    sessionCookieName: 'softora_session',
    defaultSessionTtlMs: 60 * 60 * 1000,
    isAuthConfigured: () => true,
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
  });

  const token = manager.createSessionToken({
    email: 'info@softora.nl',
    userId: 'usr_123',
    role: 'admin',
  });
  const tampered = `${token}x`;

  assert.equal(manager.verifySessionToken(tampered).ok, false);

  const req = {
    headers: {
      cookie: `softora_session=${encodeURIComponent(token)}`,
    },
  };
  assert.equal(manager.readSessionTokenFromRequest(req), token);
});

test('premium session manager builds session and clear cookie headers', () => {
  const manager = createPremiumSessionManager({
    sessionSecret: 'secret',
    sessionCookieName: 'softora_session',
    defaultSessionTtlMs: 60 * 60 * 1000,
    isAuthConfigured: () => true,
    isProduction: true,
    isSecureHttpRequest: () => false,
    normalizeString,
    truncateText,
    normalizeSessionEmail: (value) => normalizeString(value).toLowerCase(),
  });

  const setCookie = manager.buildSessionCookieHeader({}, 'token', 30_000);
  const clearCookie = manager.buildClearedSessionCookieHeader({});

  assert.match(setCookie, /^softora_session=token;/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=30/);
  assert.match(clearCookie, /Max-Age=0/);
});

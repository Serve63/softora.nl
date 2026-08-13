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
    authVersion: 3,
  });
  const verification = manager.verifySessionToken(token);

  assert.equal(typeof token, 'string');
  assert.equal(verification.ok, true);
  assert.equal(verification.payload.email, 'info@softora.nl');
  assert.equal(verification.payload.uid, 'usr_123');
  assert.equal(verification.payload.role, 'admin');
  assert.equal(verification.payload.av, 3);
  assert.deepEqual(verification.payload.amr, ['pwd']);

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
    authVersion: 1,
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

test('premium session manager accepts password sessions and refuses legacy or MFA-session tokens', () => {
  const manager = createPremiumSessionManager({
    sessionSecret: 'secret',
    isAuthConfigured: () => true,
  });

  const valid = manager.createSessionToken({
    email: 'info@softora.nl',
    userId: 'usr_1',
    role: 'admin',
    authVersion: 1,
  });
  assert.ok(valid);
  const [encoded] = valid.split('.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  payload.sv = 2;
  delete payload.amr;
  payload.mfa = true;
  const legacyEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const crypto = require('node:crypto');
  const legacySignature = crypto.createHmac('sha256', 'secret').update(legacyEncoded).digest('base64url');

  assert.equal(manager.verifySessionToken(`${legacyEncoded}.${legacySignature}`).ok, false);
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

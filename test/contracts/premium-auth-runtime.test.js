const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumAuthRuntime } = require('../../server/services/premium-auth-runtime');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

test('premium auth runtime wraps session cookies and token verification', () => {
  const runtime = createPremiumAuthRuntime({
    mfaTotpSecret: '',
    sessionSecret: 'secret',
    sessionCookieName: 'softora_session',
    premiumSessionTtlHours: 12,
    isProduction: true,
    isPremiumAuthConfigured: () => true,
    isSecureHttpRequest: () => false,
    normalizeString,
    truncateText,
    normalizePremiumSessionEmail: (value) => normalizeString(value).toLowerCase(),
  });

  const token = runtime.createPremiumSessionToken({
    email: 'INFO@SOFTORA.NL',
    maxAgeMs: 30_000,
    userId: 'usr_123',
    role: 'ADMIN',
  });
  const verification = runtime.verifyPremiumSessionToken(token);

  const appended = [];
  const res = {
    append(name, value) {
      appended.push([name, value]);
    },
  };
  runtime.setPremiumSessionCookie({}, res, token, 30_000);
  runtime.clearPremiumSessionCookie({}, res);

  assert.equal(verification.ok, true);
  assert.equal(verification.payload.email, 'info@softora.nl');
  assert.equal(runtime.isPremiumMfaConfigured(), false);
  assert.equal(runtime.isPremiumMfaCodeValid('123456'), true);
  assert.equal(appended.length, 2);
  assert.equal(appended[0][0], 'Set-Cookie');
  assert.match(appended[0][1], /^softora_session=/);
  assert.match(appended[0][1], /Secure/);
  assert.match(appended[0][1], /Max-Age=30/);
  assert.match(appended[1][1], /Max-Age=0/);
});

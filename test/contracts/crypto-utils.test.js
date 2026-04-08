const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createHmacSha256Base64Url,
  fromBase64Url,
  timingSafeEqualStrings,
  toBase64Url,
} = require('../../server/security/crypto-utils');

test('base64url helpers round-trip utf8 content', () => {
  const input = JSON.stringify({ message: 'Softora werkt', ok: true });
  const encoded = toBase64Url(input);
  assert.equal(/[+/=]/.test(encoded), false);
  assert.equal(fromBase64Url(encoded), input);
});

test('hmac helper is deterministic and url-safe', () => {
  const signatureA = createHmacSha256Base64Url('payload', 'secret');
  const signatureB = createHmacSha256Base64Url('payload', 'secret');
  assert.equal(signatureA, signatureB);
  assert.equal(/[+/=]/.test(signatureA), false);
});

test('timingSafeEqualStrings compares equal values and rejects mismatches', () => {
  assert.equal(timingSafeEqualStrings('abc', 'abc'), true);
  assert.equal(timingSafeEqualStrings('abc', 'abd'), false);
  assert.equal(timingSafeEqualStrings('abc', 'ab'), false);
});

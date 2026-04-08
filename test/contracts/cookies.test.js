const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCookieMap, buildSetCookieHeader } = require('../../server/security/cookies');

test('buildCookieMap parses and decodes cookie headers', () => {
  const req = {
    headers: {
      cookie: 'plain=value; encoded=hello%20world; invalid=%E0%A4%A',
    },
  };

  const cookies = buildCookieMap(req);
  assert.equal(cookies.get('plain'), 'value');
  assert.equal(cookies.get('encoded'), 'hello world');
  assert.equal(cookies.get('invalid'), '%E0%A4%A');
});

test('buildSetCookieHeader emits stable cookie attributes', () => {
  const header = buildSetCookieHeader('softora_session', 'token-value', {
    path: '/',
    sameSite: 'Lax',
    secure: true,
    maxAgeSeconds: 3600,
  });

  assert.match(header, /^softora_session=token-value;/);
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=3600/);
  assert.match(header, /Expires=/);
});

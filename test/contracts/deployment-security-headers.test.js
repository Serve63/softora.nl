const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('vercel config applies baseline security headers to all public routes', () => {
  const configPath = path.join(__dirname, '../../vercel.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const globalHeaderRule = (config.headers || []).find((rule) => rule.source === '/(.*)');
  const headers = Object.fromEntries(
    (globalHeaderRule?.headers || []).map((header) => [header.key, header.value])
  );

  assert.ok(globalHeaderRule, 'globale headerregel hoort aanwezig te zijn');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(headers['Strict-Transport-Security'], /includeSubDomains/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

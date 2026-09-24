'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('browsers keep personnel assets instead of revalidating ~50 files on every page open', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  const [assetRule, ...rest] = config.headers;
  assert.equal(assetRule.source, '/assets/((?!personnel-theme\\.).*)');
  assert.deepEqual(assetRule.headers, [{ key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=604800' }]);
  // The same pattern as a fixed regular expression (Vercel's custom group).
  const matcher = /^\/assets\/((?!personnel-theme\.).*)$/;
  assert.equal(matcher.test('/assets/premium-mailbox.js'), true);
  assert.equal(matcher.test('/assets/fonts/inter.woff2'), true);
  assert.equal(matcher.test('/assets/personnel-theme.js'), false, 'the theme keeps its own must-revalidate rule');
  assert.equal(matcher.test('/assets/personnel-theme.css'), false);
  assert.ok(rest.some((rule) => rule.source === '/assets/personnel-theme.js'));
  assert.ok(rest.some((rule) => rule.source === '/assets/personnel-theme.css'));
});

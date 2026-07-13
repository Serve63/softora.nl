'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const hotfixPath = path.join(__dirname, '../../server/services/coldmail-email-hotfix.js');
const apiIndexPath = path.join(__dirname, '../../api/index.js');
const apiCatchAllPath = path.join(__dirname, '../../api/[...path].js');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('coldmail hotfix bewaakt de afgesproken mailweergave', () => {
  const source = read(hotfixPath);

  assert.match(source, /website \{\{website\}\} tegen/);
  assert.doesNotMatch(source, /website \{\{website\}\}, tegen/);
  assert.match(source, /font-weight:400/);
  assert.match(source, /white-space:nowrap!important;display:inline-block/);
  assert.match(source, /escapeHtml\(cleanLine\)/);
  assert.match(source, /softora-desktop-nowrap/);
  assert.match(source, /min-width:601px/);
  assert.match(source, /includeMockup: true/);
  assert.match(source, /attachments\.length !== 2/);
  assert.match(source, /'Mockup'/);
  assert.match(source, /'Webdesign'/);
});

test('beide Vercel-entrypoints laden de coldmailfix vóór de app-handler', () => {
  for (const filePath of [apiIndexPath, apiCatchAllPath]) {
    const source = read(filePath);
    assert.match(source, /require\('\.\.\/server\/services\/coldmail-email-hotfix'\)/);
    assert.match(source, /module\.exports = require\('\.\/_app-handler'\)/);
    assert.ok(
      source.indexOf("require('../server/services/coldmail-email-hotfix')") <
        source.indexOf("module.exports = require('./_app-handler')")
    );
  }
});

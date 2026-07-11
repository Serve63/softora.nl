'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const hotfixPath = path.join(__dirname, '../../server/services/coldmail-email-hotfix.js');
const packagePath = path.join(__dirname, '../../package.json');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('coldmail hotfix bewaakt de afgesproken mailweergave', () => {
  const source = read(hotfixPath);

  assert.match(source, /website \{\{website\}\}, tegen/);
  assert.match(source, /font-weight:400/);
  assert.match(source, /return escapeHtml\(cleanLine\)/);
  assert.match(source, /softora-desktop-nowrap/);
  assert.match(source, /min-width:601px/);
  assert.match(source, /includeMockup: true/);
  assert.match(source, /attachments\.length !== 2/);
});

test('productiestart laadt de coldmailfix vóór de server', () => {
  const packageJson = JSON.parse(read(packagePath));
  assert.equal(
    packageJson.scripts.start,
    'node -r ./server/services/coldmail-email-hotfix.js server.js'
  );
});

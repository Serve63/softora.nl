const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readPage(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

const lightPremiumSurfacePages = [
  'premium-mailbox.html',
  'premium-boekhouding.html',
];

test('selected premium pages keep their lichte premium palette', () => {
  for (const relativePath of lightPremiumSurfacePages) {
    const pageSource = readPage(relativePath);

    assert.match(pageSource, /--bg:\s*#f6f2ec|--bg:\s*#f0ede8/);
    assert.match(pageSource, /--text-dark:\s*#1a1a2e/);
    assert.match(pageSource, /--crimson:\s*#(?:8b2252|9b2355)/i);
  }
});

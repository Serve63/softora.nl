const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readPage(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

const darkDashboardSurfacePages = [
  'premium-bevestigingsmails.html',
  'premium-mailbox.html',
  'premium-boekhouding.html',
];

test('selected premium pages reuse the dashboard dark surface palette', () => {
  for (const relativePath of darkDashboardSurfacePages) {
    const pageSource = readPage(relativePath);

    assert.match(pageSource, /--bg-primary:\s*#080808/);
    assert.match(pageSource, /--bg-secondary:\s*#0d0d0d/);
    assert.match(pageSource, /--text-primary:\s*#f5f5f5/);
    assert.match(pageSource, /--border:\s*rgba\(255,\s*255,\s*255,\s*0\.06\)/);
  }
});

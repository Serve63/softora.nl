const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '../../premium-opdracht-preview.html');

test('premium opdracht preview vervangt de body via DOM in plaats van innerHTML reset', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /document\.body\.replaceChildren\(shell\);/);
  assert.match(pageSource, /document\.body\.setAttribute\('data-preview-mode', 'frame'\);/);
  assert.doesNotMatch(pageSource, /document\.body\.innerHTML = '';/);
});

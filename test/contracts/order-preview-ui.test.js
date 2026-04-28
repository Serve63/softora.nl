const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '../../opdracht-preview.html');

test('opdracht preview gebruikt geen dode document.write fallback meer', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /Preview niet gevonden/);
  assert.match(pageSource, /\/actieve-opdrachten/);
  assert.doesNotMatch(pageSource, /document\.write/);
  assert.doesNotMatch(pageSource, /document\.open/);
  assert.doesNotMatch(pageSource, /softora_preview_html_software_v2_/);
});

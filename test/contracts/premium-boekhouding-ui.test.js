const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium boekhouding no longer shows ICP opgave rows', () => {
  const pagePath = path.join(__dirname, '../../premium-boekhouding.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /function aangiftes\(y\) \{/);
  assert.match(pageSource, /naam:'BTW Aangifte'/);
  assert.match(pageSource, /naam:'Inkomstenbelasting'/);
  assert.match(pageSource, /document\.getElementById\('map-title'\)\.textContent = a\.naam;/);
  assert.match(pageSource, /document\.getElementById\('map-period'\)\.textContent = a\.period \|\| '';/);
  assert.doesNotMatch(pageSource, /document\.getElementById\('map-period'\)\.textContent = ' - ' \+ a\.period;/);
  assert.doesNotMatch(pageSource, /naam:'ICP Opgave'/);
  assert.doesNotMatch(pageSource, /cat:'Overige Opgaven'/);
});

test('premium boekhouding anchors deadlines to official upcoming ranges', () => {
  const pagePath = path.join(__dirname, '../../premium-boekhouding.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /const BTW_DEADLINE_COUNT = 35;/);
  assert.match(pageSource, /const INCOME_TAX_DEADLINE_COUNT = 35;/);
  assert.match(pageSource, /const BTW_START_YEAR = 2026;/);
  assert.match(pageSource, /const INCOME_TAX_START_YEAR = 2025;/);
  assert.match(pageSource, /function buildBtwAangiftes\(\)/);
  assert.match(pageSource, /function buildIncomeTaxAangiftes\(\)/);
  assert.match(pageSource, /year = clampYear\(year\);/);
  assert.match(pageSource, /function changeYear\(d\) \{ year = clampYear\(year \+ d\); renderList\(\); \}/);
  assert.match(pageSource, /return ALL_AANGIFTES\.filter\(a => Number\(String\(a\.deadline\)\.slice\(0,4\)\) === y\);/);
});

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
  assert.doesNotMatch(pageSource, /naam:'ICP Opgave'/);
  assert.doesNotMatch(pageSource, /cat:'Overige Opgaven'/);
});

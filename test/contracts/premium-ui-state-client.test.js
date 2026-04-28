const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium ui-state client centraliseert gedeelde read/write fallback routes', () => {
  const scriptPath = path.join(__dirname, '../../assets/premium-ui-state-client.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /global\.SoftoraUiStateClient = \{/);
  assert.match(source, /get: getUiState/);
  assert.match(source, /set: setUiState/);
  assert.match(source, /"\/api\/ui-state-get\?scope=" \+ encodedScope/);
  assert.match(source, /"\/api\/ui-state\/" \+ encodedScope/);
  assert.match(source, /"\/api\/ui-state-set\?scope=" \+ encodedScope/);
  assert.match(source, /method: "GET", cache: "no-store"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /headers: \{ "Content-Type": "application\/json" \}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

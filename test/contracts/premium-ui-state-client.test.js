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
  assert.match(source, /var GET_CACHE_TTL_MS = 15000;/);
  assert.match(source, /var readCache = Object\.create\(null\);/);
  assert.match(source, /cached && now - cached\.time < GET_CACHE_TTL_MS/);
  assert.match(source, /readCache\[cacheKey\] = \{ promise: promise, time: now \};/);
  assert.match(source, /delete readCache\[cacheKey\];/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /headers: \{ "Content-Type": "application\/json" \}/);
  assert.match(source, /async function setUiState\(scope, body, options\)/);
  assert.match(source, /if \(options && options\.keepalive === true\) requestOptions\.keepalive = true;/);
  assert.match(source, /options && options\.timeoutMs/);
  assert.match(source, /var DEFAULT_TIMEOUT_MS = 5000;/);
  assert.match(source, /function fetchWithTimeout\(url, options, label, timeoutMs\) \{/);
  assert.match(source, /function shouldStopFallback\(error\) \{/);
  assert.match(source, /status === 401 \|\| status === 403 \|\| status === 429 \|\| status >= 500/);
  assert.match(source, /if \(shouldStopFallback\(error\)\) break;/);
  assert.match(source, /controller\.abort\(\);/);
  assert.match(source, /label \+ " reageert niet op tijd\."/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

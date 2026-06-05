const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('legacy personeel login form uses delegated submit binding', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../personeel-login.html'), 'utf8');

  assert.match(source, /<form class="login-form" id="loginForm" data-login-form>/);
  assert.match(source, /function handleLogin\(e\) \{/);
  assert.match(source, /const loginForm = document\.querySelector\('\[data-login-form\]'\);/);
  assert.match(source, /loginForm\.addEventListener\('submit', handleLogin\);/);
  assert.doesNotMatch(source, /\sonsubmit=/);
  assert.doesNotMatch(source, /return handleLogin\(event\)/);
});

test('premium personeel login explains expired sessions clearly', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-personeel-login.html'), 'utf8');

  assert.match(source, /params\.get\('expired'\) === '1'/);
  assert.match(source, /Je sessie is verlopen\. Log opnieuw in om verder te gaan\./);
});

test('premium personeel login timeboxes auth requests and recovers the submit button', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-personeel-login.html'), 'utf8');

  assert.match(source, /const LOGIN_STATE_TIMEOUT_MS = 3500;/);
  assert.match(source, /const LOGIN_SUBMIT_TIMEOUT_MS = 8000;/);
  assert.match(source, /function fetchWithTimeout\(url, options = \{\}, timeoutMs = LOGIN_SUBMIT_TIMEOUT_MS\)/);
  assert.match(source, /const controller = typeof AbortController === 'function' \? new AbortController\(\) : null;/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), safeTimeoutMs\)/);
  assert.match(source, /fetchWithTimeout\('\/api\/auth\/session'[\s\S]*LOGIN_STATE_TIMEOUT_MS\)/);
  assert.match(source, /fetchWithTimeout\('\/api\/auth\/login'[\s\S]*LOGIN_SUBMIT_TIMEOUT_MS\)/);
  assert.match(source, /De server reageert te traag\. Probeer het opnieuw\./);
  assert.match(source, /finally \{[\s\S]*btn\.textContent = originalBtnText;[\s\S]*btn\.disabled = false;[\s\S]*\}/);
});

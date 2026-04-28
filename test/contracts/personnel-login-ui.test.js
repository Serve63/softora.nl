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

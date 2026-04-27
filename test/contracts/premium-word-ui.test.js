const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium word: rich editor, eigen ui-state scope, canonical shell', () => {
  const pagePath = path.join(__dirname, '../../premium-word.html');
  const scriptPath = path.join(__dirname, '../../assets/premium-word.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  assert.match(pageSource, /data-sidebar-shell="canonical"/);
  assert.match(pageSource, /data-sidebar-key="word"/);
  assert.match(pageSource, /\/premium-word/);
  assert.match(pageSource, /id="wordEditor"/);
  assert.match(pageSource, /contenteditable="true"/);
  assert.match(pageSource, /id="wordRibbon"/);
  assert.match(pageSource, /assets\/premium-ui-state-client\.js\?v=20260427a/);
  assert.match(pageSource, /assets\/premium-word\.js\?v=20260427b/);
  assert.doesNotMatch(pageSource, /REMOTE_SCOPE|softora_premium_word_html_v1|fetchUiStateGet|editor\.innerHTML/);
  assert.match(scriptSource, /REMOTE_SCOPE = "premium_word"/);
  assert.match(scriptSource, /softora_premium_word_html_v1/);
  assert.match(scriptSource, /source: "premium-word"/);
  assert.match(scriptSource, /getUiStateClient\(\)\.get\(REMOTE_SCOPE\)/);
  assert.match(scriptSource, /getUiStateClient\(\)\.set\(REMOTE_SCOPE,/);
  assert.doesNotMatch(scriptSource, /function fetchUiStateGet|function fetchUiStateSet/);
  assert.match(scriptSource, /function sanitizeWordHtml\(html\)/);
  assert.match(scriptSource, /function closestElement\(target, selector\)/);
  assert.match(scriptSource, /blockedTags = \{ IFRAME: true, LINK: true, META: true, OBJECT: true, SCRIPT: true, STYLE: true \}/);
  assert.match(scriptSource, /name\.indexOf\("on"\) === 0/);
  assert.match(scriptSource, /patch\[REMOTE_KEY\] = sanitizeWordHtml\(editor\.innerHTML\)/);
  assert.match(scriptSource, /editor\.innerHTML = sanitizeWordHtml\(html\)/);
  assert.match(pageSource, /\.word-page\s*\{/);
  assert.match(pageSource, /\.word-ribbon\s*\{/);
});

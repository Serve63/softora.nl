const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium word: rich editor, eigen ui-state scope, canonical shell', () => {
  const pagePath = path.join(__dirname, '../../premium-word.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /data-sidebar-shell="canonical"/);
  assert.match(pageSource, /data-sidebar-key="word"/);
  assert.match(pageSource, /\/premium-word/);
  assert.match(pageSource, /id="wordEditor"/);
  assert.match(pageSource, /contenteditable="true"/);
  assert.match(pageSource, /id="wordRibbon"/);
  assert.match(pageSource, /REMOTE_SCOPE = 'premium_word'/);
  assert.match(pageSource, /softora_premium_word_html_v1/);
  assert.match(pageSource, /source: 'premium-word'/);
  assert.match(pageSource, /\.word-page\s*\{/);
  assert.match(pageSource, /\.word-ribbon\s*\{/);
});

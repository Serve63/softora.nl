const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readPage(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('premium advertenties toont een aparte AI beheer workspace boven de personeelspagina', () => {
  const pageSource = readPage('premium-advertenties.html');
  const assetSource = readPage('assets/premium-marketing-management.js');
  const cssSource = readPage('assets/premium-marketing-management.css');

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<script src="assets\/ai-management-mode\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /<link rel="stylesheet" href="assets\/premium-marketing-management\.css\?v=20260423a">/);
  assert.match(pageSource, /<script src="assets\/premium-marketing-management\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /<div class="ai-marketing-shell" id="aiMarketingShell" data-ai-tone="idle">/);
  assert.match(pageSource, /<div class="page-personnel-shell">/);
  assert.match(pageSource, /AI Beheer/);
  assert.match(assetSource, /ads_google: '\/premium-advertenties#google'/);
  assert.match(assetSource, /AI gebruikt Google Ads nu actief/);
  assert.match(assetSource, /AI gebruikt Pinterest nu niet/);
  assert.match(cssSource, /html\[data-ai-management-mode="software"\] \.page-personnel-shell \{/);
  assert.match(cssSource, /html\[data-ai-management-mode="software"\] \.content-lock-overlay \{/);
});

test('premium socialmedia toont een aparte AI beheer workspace boven de personeelspagina', () => {
  const pageSource = readPage('premium-socialmedia.html');
  const assetSource = readPage('assets/premium-marketing-management.js');

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<script src="assets\/ai-management-mode\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /<link rel="stylesheet" href="assets\/premium-marketing-management\.css\?v=20260423a">/);
  assert.match(pageSource, /<script src="assets\/premium-marketing-management\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /<div class="ai-marketing-shell" id="aiMarketingShell" data-ai-tone="idle">/);
  assert.match(pageSource, /<div class="page-personnel-shell">/);
  assert.match(pageSource, /AI bepaalt hier zelf wanneer organische socialmedia, inbox-opvolging en doorstroom naar leads zin hebben\./);
  assert.match(assetSource, /social_instagram: '\/premium-socialmedia#instagram'/);
  assert.match(assetSource, /AI gebruikt Instagram nu actief/);
  assert.match(assetSource, /AI gebruikt X \/ Twitter nu niet/);
});

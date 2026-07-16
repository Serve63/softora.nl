const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readPage(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('premium advertenties is een dedicated Google Ads dry-run commandocentrale', () => {
  const pageSource = readPage('premium-advertenties.html');
  const assetSource = readPage('assets/premium-google-ads.js');
  const lockAssetSource = readPage('assets/premium-marketing-content-lock.js');
  const cssSource = readPage('assets/premium-google-ads.css');

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<title>Google Ads – Softora\.nl<\/title>/);
  assert.match(pageSource, /<link rel="stylesheet" href="assets\/premium-google-ads\.css\?v=20260716b">/);
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260605a"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-marketing-content-lock\.js\?v=20260427a" defer><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-google-ads\.js\?v=20260716b" defer><\/script>/);
  assert.match(pageSource, /data-content-lock-scope="premium_advertenties_content_lock"/);
  assert.match(pageSource, /data-content-lock-input/);
  assert.match(pageSource, /data-content-lock-submit/);
  assert.match(pageSource, /data-google-ads-open/);
  assert.match(pageSource, /<h1>Google Ads<\/h1>/);
  assert.match(pageSource, /Dezelfde discipline als de SEO-machine/);
  assert.match(pageSource, /Kostenslot actief/);
  assert.match(pageSource, /Draai dry-run/);
  assert.match(pageSource, /Search-blueprint/);
  assert.match(pageSource, /Advertenties, keywords en URL-tracking/);
  assert.match(pageSource, /id="googleAdsDownloadPack"/);
  assert.match(pageSource, /href="\/api\/google-ads\/editor-assets\.csv" download/);
  assert.doesNotMatch(pageSource, /Trustoo-campagnes|Pinterest promoted pins|Meta \/ Facebook advertenties|LinkedIn Campaign Manager/);
  assert.doesNotMatch(pageSource, /onclick=/);
  assert.doesNotMatch(pageSource, /onkeydown=/);
  assert.doesNotMatch(pageSource, /function unlockAdvertentiesArea/);
  assert.doesNotMatch(lockAssetSource, /localStorage|sessionStorage/);
  assert.match(lockAssetSource, /window\.SoftoraUiStateClient/);
  assert.match(lockAssetSource, /isOpenGoogleAdsView/);
  assert.match(lockAssetSource, /document\.documentElement\.removeAttribute\('data-google-ads-open'\)/);
  assert.match(lockAssetSource, /remoteUnlocked \|\| googleAdsOpen/);
  assert.match(lockAssetSource, /client\.get\(remoteScope\)/);
  assert.match(lockAssetSource, /client\.set\(remoteScope,/);
  assert.match(lockAssetSource, /submitButton\.addEventListener\('click', unlockContent\)/);
  assert.match(lockAssetSource, /event\.key === 'Enter'/);
  assert.match(assetSource, /fetchJson\('\/api\/google-ads\/status'\)/);
  assert.match(assetSource, /fetchJson\('\/api\/google-ads\/blueprint'\)/);
  assert.match(assetSource, /fetchJson\('\/api\/google-ads\/dry-run'/);
  assert.match(assetSource, /fetchJson\('\/api\/google-ads\/launch-pack'\)/);
  assert.match(assetSource, /softora-google-ads-launch-pack\.json/);
  assert.match(assetSource, /campaign\.headlines\.slice\(0, 3\)/);
  assert.match(assetSource, /replaceChildren/);
  assert.doesNotMatch(assetSource, /innerHTML/);
  assert.match(cssSource, /\.google-ads-safety/);
  assert.match(cssSource, /\.google-ads-campaigns/);
});

test('premium socialmedia toont een aparte AI beheer workspace boven de personeelspagina', () => {
  const pageSource = readPage('premium-socialmedia.html');
  const assetSource = readPage('assets/premium-marketing-management.js');
  const lockAssetSource = readPage('assets/premium-marketing-content-lock.js');

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<script src="assets\/ai-management-mode\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /<link rel="stylesheet" href="assets\/premium-marketing-management\.css\?v=20260423a">/);
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260605a"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-marketing-content-lock\.js\?v=20260427a" defer><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-marketing-management\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /data-content-lock-scope="premium_socialmedia_content_lock"/);
  assert.match(pageSource, /data-content-lock-input/);
  assert.match(pageSource, /data-content-lock-submit/);
  assert.match(pageSource, /<div class="ai-marketing-shell" id="aiMarketingShell" data-ai-tone="idle">/);
  assert.match(pageSource, /<div class="page-personnel-shell">/);
  assert.match(pageSource, /AI bepaalt hier zelf wanneer organische socialmedia, inbox-opvolging en doorstroom naar leads zin hebben\./);
  assert.doesNotMatch(pageSource, /onclick=/);
  assert.doesNotMatch(pageSource, /onkeydown=/);
  assert.doesNotMatch(pageSource, /function unlockSocialmediaArea/);
  assert.doesNotMatch(lockAssetSource, /localStorage|sessionStorage/);
  assert.match(lockAssetSource, /patch: \{/);
  assert.match(lockAssetSource, /source: 'premium-marketing-content-lock'/);
  assert.match(lockAssetSource, /window\.addEventListener\('hashchange', function \(\) \{[\s\S]*syncOverlayVisibility\(\);[\s\S]*scrollToCurrentHash\(\);/);
  assert.match(assetSource, /social_instagram: '\/premium-socialmedia#instagram'/);
  assert.match(assetSource, /AI gebruikt Instagram nu actief/);
  assert.match(assetSource, /AI gebruikt X \/ Twitter nu niet/);
});

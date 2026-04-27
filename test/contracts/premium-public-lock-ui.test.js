const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const publicLockPages = [
  'premium-bedrijfssoftware.html',
  'premium-chatbot.html',
  'premium-websites.html',
  'premium-voicesoftware.html',
  'premium-over-softora.html',
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('publieke premium lock-paginas gebruiken gedeelde lock asset zonder inline handlers', () => {
  const assetSource = readRepoFile('assets/premium-public-lock.js');

  assert.match(assetSource, /var LOCK_CODE = 'Andre2Fritz2!';/);
  assert.match(assetSource, /var UNLOCK_COOKIE = 'softora_public_premium_unlocked';/);
  assert.match(assetSource, /document\.cookie = encodeURIComponent\(UNLOCK_COOKIE\)/);
  assert.match(assetSource, /submit\.addEventListener\('click', unlock\)/);
  assert.match(assetSource, /event\.key === 'Enter'/);
  assert.match(assetSource, /new IntersectionObserver/);
  assert.doesNotMatch(assetSource, /localStorage|sessionStorage/);

  publicLockPages.forEach((file) => {
    const source = readRepoFile(file);

    assert.match(
      source,
      /<script src="assets\/premium-public-lock\.js\?v=20260427a" defer><\/script>/,
      file
    );
    assert.match(source, /data-public-lock-input/, file);
    assert.match(source, /data-public-lock-submit/, file);
    assert.doesNotMatch(source, /onclick=/, file);
    assert.doesNotMatch(source, /onkeydown=/, file);
    assert.doesNotMatch(source, /function login\(/, file);
    assert.doesNotMatch(source, /sessionStorage/, file);
  });
});

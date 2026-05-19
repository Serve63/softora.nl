const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const publicSeoUnlockedPages = [
  'ai-automatisering.html',
  'ai-telefonist.html',
  'crm-systeem-op-maat.html',
  'diensten.html',
  'premium-bedrijfssoftware.html',
  'premium-chatbot.html',
  'premium-over-softora.html',
  'premium-websites.html',
  'premium-voicesoftware.html',
  'premium-blog.html',
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('legacy publieke lock asset gebruikt veilige gedelegeerde handlers', () => {
  const assetSource = readRepoFile('assets/premium-public-lock.js');

  assert.match(assetSource, /var LOCK_CODE = 'Andre2Fritz2!';/);
  assert.match(assetSource, /var UNLOCK_COOKIE = 'softora_public_premium_unlocked';/);
  assert.match(assetSource, /document\.cookie = encodeURIComponent\(UNLOCK_COOKIE\)/);
  assert.match(assetSource, /submit\.addEventListener\('click', unlock\)/);
  assert.match(assetSource, /event\.key === 'Enter'/);
  assert.match(assetSource, /new IntersectionObserver/);
  assert.doesNotMatch(assetSource, /localStorage|sessionStorage/);
});

test('publieke SEO-landingspagina’s hebben geen toegangscode-slot meer', () => {
  publicSeoUnlockedPages.forEach((file) => {
    const source = readRepoFile(file);

    assert.doesNotMatch(source, /Binnenkort beschikbaar/, file);
    assert.doesNotMatch(source, /data-public-lock-input/, file);
    assert.doesNotMatch(source, /data-public-lock-submit/, file);
    assert.doesNotMatch(source, /premium-public-lock\.js/, file);
  });
});

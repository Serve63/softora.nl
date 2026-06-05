const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getStaticAssetCacheControl } = require('../../server/routes/public-pages');

const REPO_ROOT = path.join(__dirname, '../..');
const ROUND_FAVICON_HREF = '/assets/softora-favicon-round.png?v=20260605c';

test('public asset cache keeps unhashed app js/css fresh even with version query strings', () => {
  assert.equal(
    getStaticAssetCacheControl('/app/assets/coldcalling-dashboard.js', '/assets/coldcalling-dashboard.js?v=20260427e'),
    'public, max-age=60, stale-while-revalidate=300'
  );
  assert.equal(
    getStaticAssetCacheControl('/app/assets/personnel-theme.css', '/assets/personnel-theme.css?v=20260519b'),
    'public, max-age=60, stale-while-revalidate=300'
  );
});

test('public asset cache still allows immutable caching for hashed assets and media', () => {
  assert.equal(
    getStaticAssetCacheControl('/app/assets/app.0123456789abcdef.js', '/assets/app.0123456789abcdef.js'),
    'public, max-age=31536000, immutable'
  );
  assert.equal(
    getStaticAssetCacheControl('/app/assets/logo.png', '/assets/logo.png?v=20260414f'),
    'public, max-age=31536000, immutable'
  );
});

test('html pages use the round Softora favicon asset sitewide', () => {
  const faviconPath = path.join(REPO_ROOT, 'assets/softora-favicon-round.png');
  const pngSignature = fs.readFileSync(faviconPath).subarray(0, 8).toString('hex');
  const htmlFiles = fs.readdirSync(REPO_ROOT).filter((name) => name.endsWith('.html'));
  const pagesWithFavicons = [];
  const oldFaviconPattern = /D80D8A58-B985-491E-A39B-27879E4C593A\.PNG\?v=20260414f/;

  assert.equal(pngSignature, '89504e470d0a1a0a');

  htmlFiles.forEach((fileName) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, fileName), 'utf8');
    assert.doesNotMatch(source, oldFaviconPattern, `${fileName} should not use the old square favicon`);
    if (!source.includes('rel="icon"')) return;
    pagesWithFavicons.push(fileName);
    assert.match(
      source,
      new RegExp(`<link rel="icon" type="image/png" href="${ROUND_FAVICON_HREF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" sizes="any">`),
      `${fileName} should load the round favicon`
    );
    assert.match(
      source,
      new RegExp(`<link rel="apple-touch-icon" href="${ROUND_FAVICON_HREF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`),
      `${fileName} should load the round touch icon`
    );
  });

  assert.ok(pagesWithFavicons.includes('premium-website.html'));
  assert.ok(pagesWithFavicons.length >= 40, 'expected sitewide favicon coverage');
});

test('root homepage is server-managed instead of a static premium redirect file', () => {
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'index.html')),
    false,
    'index.html would shadow the server-managed / homepage on Vercel'
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { getStaticAssetCacheControl } = require('../../server/routes/public-pages');

test('public asset cache keeps unhashed app js/css fresh even with version query strings', () => {
  assert.equal(
    getStaticAssetCacheControl('/app/assets/coldcalling-dashboard.js', '/assets/coldcalling-dashboard.js?v=20260427e'),
    'public, max-age=60, stale-while-revalidate=300'
  );
  assert.equal(
    getStaticAssetCacheControl('/app/assets/personnel-theme.css', '/assets/personnel-theme.css?v=20260502a'),
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

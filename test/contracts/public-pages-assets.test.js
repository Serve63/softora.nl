const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getStaticAssetCacheControl } = require('../../server/routes/public-pages');

const REPO_ROOT = path.join(__dirname, '../..');
const SEARCH_FAVICON_HREF = '/assets/softora-search-favicon.png';
const ROUND_FAVICON_HREF = '/assets/softora-favicon-round.png?v=20260616a';
const HOME_SCREEN_ICON_HREF = '/assets/softora-touch-icon.png?v=20260615a';
const STRUCTURED_DATA_LOGO_URL = 'https://www.softora.nl/assets/softora-touch-icon.png';
const BROKEN_STRUCTURED_DATA_LOGO_PATTERN = /https:\/\/www\.softora\.nl\/assets\/61C2BCF5-70E9-4789-AFDE-FA18C862D58A\.PNG/;

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

test('html pages use the search favicon, round favicon, and filled home-screen icon sitewide', () => {
  const searchFaviconPath = path.join(REPO_ROOT, 'assets/softora-search-favicon.png');
  const faviconPath = path.join(REPO_ROOT, 'assets/softora-favicon-round.png');
  const homeScreenIconPath = path.join(REPO_ROOT, 'assets/softora-touch-icon.png');
  const searchFavicon = fs.readFileSync(searchFaviconPath);
  const searchFaviconSignature = searchFavicon.subarray(0, 8).toString('hex');
  const searchFaviconWidth = searchFavicon.readUInt32BE(16);
  const searchFaviconHeight = searchFavicon.readUInt32BE(20);
  const searchFaviconColorType = searchFavicon.readUInt8(25);
  const pngSignature = fs.readFileSync(faviconPath).subarray(0, 8).toString('hex');
  const homeScreenIcon = fs.readFileSync(homeScreenIconPath);
  const homeScreenIconSignature = homeScreenIcon.subarray(0, 8).toString('hex');
  const homeScreenIconWidth = homeScreenIcon.readUInt32BE(16);
  const homeScreenIconHeight = homeScreenIcon.readUInt32BE(20);
  const homeScreenIconColorType = homeScreenIcon.readUInt8(25);
  const htmlFiles = fs.readdirSync(REPO_ROOT).filter((name) => name.endsWith('.html'));
  const pagesWithFavicons = [];
  const oldFaviconPattern = /D80D8A58-B985-491E-A39B-27879E4C593A\.PNG\?v=20260414f/;

  assert.equal(searchFaviconSignature, '89504e470d0a1a0a');
  assert.equal(searchFaviconWidth, 512);
  assert.equal(searchFaviconHeight, 512);
  assert.equal(searchFaviconColorType, 6, 'search favicon should be RGBA with transparent corners');
  assert.equal(pngSignature, '89504e470d0a1a0a');
  assert.equal(homeScreenIconSignature, '89504e470d0a1a0a');
  assert.equal(homeScreenIconWidth, 512);
  assert.equal(homeScreenIconHeight, 512);
  assert.equal(homeScreenIconColorType, 2, 'home-screen icon should be RGB without transparent corners');

  htmlFiles.forEach((fileName) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, fileName), 'utf8');
    assert.doesNotMatch(source, oldFaviconPattern, `${fileName} should not use the old square favicon`);
    assert.doesNotMatch(source, BROKEN_STRUCTURED_DATA_LOGO_PATTERN, `${fileName} should not reference the missing structured-data logo`);
    if (!source.includes('rel="icon"')) return;
    pagesWithFavicons.push(fileName);
    const searchFaviconTag = `<link rel="icon" type="image/png" href="${SEARCH_FAVICON_HREF}" sizes="512x512">`;
    const roundFaviconTag = `<link rel="icon" type="image/png" href="${ROUND_FAVICON_HREF}" sizes="any">`;
    assert.match(
      source,
      new RegExp(searchFaviconTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${fileName} should expose the stable Google Search favicon`
    );
    assert.match(
      source,
      new RegExp(roundFaviconTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${fileName} should load the round favicon`
    );
    assert.ok(
      source.indexOf(searchFaviconTag) < source.indexOf(roundFaviconTag),
      `${fileName} should expose the search favicon before the filled browser favicon`
    );
    assert.match(
      source,
      new RegExp(`<link rel="apple-touch-icon" href="${HOME_SCREEN_ICON_HREF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`),
      `${fileName} should load the filled home-screen icon`
    );
  });

  assert.ok(pagesWithFavicons.includes('premium-website.html'));
  assert.ok(pagesWithFavicons.length >= 40, 'expected sitewide favicon coverage');
});

test('public SEO structured data logo points to an existing Softora asset', () => {
  const publicSeoSource = fs.readFileSync(path.join(REPO_ROOT, 'server/services/public-seo.js'), 'utf8');
  const seoContentSource = fs.readFileSync(path.join(REPO_ROOT, 'server/services/seo-content.js'), 'utf8');

  assert.doesNotMatch(publicSeoSource, BROKEN_STRUCTURED_DATA_LOGO_PATTERN);
  assert.doesNotMatch(seoContentSource, BROKEN_STRUCTURED_DATA_LOGO_PATTERN);
  assert.match(publicSeoSource, /const DEFAULT_LOGO_PATH = '\/assets\/softora-touch-icon\.png';/);
  assert.match(seoContentSource, /const DEFAULT_LOGO_PATH = '\/assets\/softora-touch-icon\.png';/);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, STRUCTURED_DATA_LOGO_URL.replace('https://www.softora.nl/', ''))));
});

test('root homepage is server-managed instead of a static premium redirect file', () => {
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'index.html')),
    false,
    'index.html would shadow the server-managed / homepage on Vercel'
  );
});

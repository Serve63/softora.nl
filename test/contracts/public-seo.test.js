const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyPublicSeoHeadDefaults,
  buildPublicSeoRobotsTxt,
  buildPublicSeoSitemapXml,
  getIndexablePublicPathFromHtmlFile,
} = require('../../server/services/public-seo');

const KNOWN_FILES = new Set([
  'premium-website.html',
  'premium-bedrijfssoftware.html',
  'premium-personeel-dashboard.html',
  'premium-seo.html',
  'premium-websitegenerator.html',
  'ai-telefonist.html',
]);

test('public seo sitemap exposes the indexable acquisition pages only', () => {
  const sitemap = buildPublicSeoSitemapXml({
    knownHtmlPageFiles: KNOWN_FILES,
    siteOrigin: 'https://www.softora.nl/',
  });

  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/premium-bedrijfssoftware<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/ai-telefonist<\/loc>/);
  assert.doesNotMatch(sitemap, /premium-personeel-dashboard/);
  assert.doesNotMatch(sitemap, /premium-seo/);
  assert.doesNotMatch(sitemap, /premium-websitegenerator/);
});

test('public seo robots keeps marketing pages crawlable and blocks private surfaces', () => {
  const robots = buildPublicSeoRobotsTxt({
    knownHtmlPageFiles: KNOWN_FILES,
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/www\.softora\.nl\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/premium-personeel-dashboard$/m);
  assert.match(robots, /^Disallow: \/premium-seo$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-website$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-websites$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-bedrijfssoftware$/m);
});

test('public seo head defaults add canonical metadata and structured data once', () => {
  const source = '<!DOCTYPE html><html lang="nl"><head><title>Oud</title></head><body><h1>Softora</h1></body></html>';
  const first = applyPublicSeoHeadDefaults(source, 'premium-website.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const second = applyPublicSeoHeadDefaults(first, 'premium-website.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(first, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/">/);
  assert.match(first, /<meta name="description" content="Softora bouwt snelle websites/);
  assert.match(first, /<meta name="robots" content="index, follow">/);
  assert.match(first, /<meta property="og:url" content="https:\/\/www\.softora\.nl\/">/);
  assert.match(first, /type="application\/ld\+json" data-softora-public-seo="structured-data"/);
  assert.equal((second.match(/data-softora-public-seo="structured-data"/g) || []).length, 1);
  assert.equal(getIndexablePublicPathFromHtmlFile('premium-website.html'), '/');
});

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
  'diensten.html',
  'website-laten-maken.html',
  'ai-automatisering.html',
  'bedrijfssoftware-op-maat.html',
  'crm-systeem-op-maat.html',
  'chatbot-laten-maken.html',
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
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/diensten<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/website-laten-maken<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/ai-automatisering<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/bedrijfssoftware-op-maat<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/crm-systeem-op-maat<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/chatbot-laten-maken<\/loc>/);
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
  assert.doesNotMatch(robots, /^Disallow: \/website-laten-maken$/m);
  assert.doesNotMatch(robots, /^Disallow: \/ai-automatisering$/m);
  assert.doesNotMatch(robots, /^Disallow: \/crm-systeem-op-maat$/m);
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

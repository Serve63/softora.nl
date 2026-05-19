const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
  buildPublicSeoRobotsTxt,
  buildPublicSeoSitemapXml,
  getIndexablePublicHtmlFileFromPath,
  getIndexablePublicPathFromHtmlFile,
  getIndexablePublicSeoPages,
  getLegacyPublicSeoRedirectTargetPath,
  getPublicSeoInternalLinks,
} = require('../../server/services/public-seo');

const root = path.join(__dirname, '../..');
const KNOWN_FILES = new Set([
  ...INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => entry.fileName),
  'premium-personeel-dashboard.html',
  'premium-seo.html',
  'premium-websitegenerator.html',
]);

test('public seo sitemap exposes the indexable acquisition pages only', () => {
  const sitemap = buildPublicSeoSitemapXml({
    knownHtmlPageFiles: KNOWN_FILES,
    siteOrigin: 'https://www.softora.nl/',
  });

  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/diensten<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/pakketten<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/website-laten-maken-oisterwijk<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/bedrijfssoftware-op-maat<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/crm-systeem-op-maat<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/ai-automatisering<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/ai-telefonist<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog\/ai-automatisering-mkb-waar-beginnen<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog\/website-laten-maken-kosten-2026<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog\/chatbot-laten-maken-wanneer-zinvol<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/kennisbank<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/kennisbank\/wat-is-bedrijfssoftware-op-maat<\/loc>/);
  assert.doesNotMatch(sitemap, /premium-bedrijfssoftware/);
  assert.doesNotMatch(sitemap, /premium-blog/);
  assert.doesNotMatch(sitemap, /premium-pakketten/);
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
  assert.doesNotMatch(robots, /^Disallow: \/diensten$/m);
  assert.doesNotMatch(robots, /^Disallow: \/ai-automatisering$/m);
  assert.doesNotMatch(robots, /^Disallow: \/crm-systeem-op-maat$/m);
  assert.doesNotMatch(robots, /^Disallow: \/ai-telefonist$/m);
  assert.doesNotMatch(robots, /^Disallow: \/bedrijfssoftware-op-maat$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-bedrijfssoftware$/m);
  assert.doesNotMatch(robots, /^Disallow: \/blog$/m);
  assert.doesNotMatch(robots, /^Disallow: \/kennisbank$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-blog$/m);
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
  assert.match(first, /data-softora-public-seo="internal-links"/);
  assert.match(first, /href="\/diensten"/);
  assert.equal((second.match(/data-softora-public-seo="structured-data"/g) || []).length, 1);
  assert.equal((second.match(/data-softora-public-seo="internal-links"/g) || []).length, 1);
  assert.equal(getIndexablePublicPathFromHtmlFile('premium-website.html'), '/');
});

test('public seo internal links use the existing footer when one is present', () => {
  const source = fs.readFileSync(path.join(root, 'premium-website.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'premium-website.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const footerStart = html.indexOf('<footer');
  const footerEnd = html.indexOf('</footer>');
  const internalLinks = html.indexOf('data-softora-public-seo="internal-links"');

  assert.ok(footerStart > -1, 'Homepage mist bestaande footer.');
  assert.ok(internalLinks > footerStart && internalLinks < footerEnd, 'Interne SEO-links moeten binnen de footer vallen.');
  assert.doesNotMatch(html, /softora-seo-link-map/);
});

test('public seo fallback links stay in normal page flow on fixed-nav templates', () => {
  const source = fs.readFileSync(path.join(root, 'premium-chatbot.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'premium-chatbot.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const ctaStart = html.indexOf('<div class="cta-block');
  const internalLinks = html.indexOf('data-softora-public-seo="internal-links"');

  assert.ok(internalLinks > ctaStart, 'Fallback SEO-links horen onder de pagina-inhoud te staan.');
  assert.match(html, /\.softora-seo-footer-links\{position:static;inset:auto;z-index:auto;display:block;width:auto;/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('voicesoftware page owns its internal links inside the page content', () => {
  const source = fs.readFileSync(path.join(root, 'premium-voicesoftware.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'premium-voicesoftware.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/voicesoftware-op-maat">/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(html, /href="\/ai-telefonist"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('public seo url mapping exposes clean paths and keeps legacy redirects available', () => {
  assert.equal(getIndexablePublicPathFromHtmlFile('premium-bedrijfssoftware.html'), '/bedrijfssoftware-op-maat');
  assert.equal(getIndexablePublicHtmlFileFromPath('/bedrijfssoftware-op-maat'), 'premium-bedrijfssoftware.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('website-laten-maken-oisterwijk.html'), '/website-laten-maken-oisterwijk');
  assert.equal(getIndexablePublicHtmlFileFromPath('/website-laten-maken-oisterwijk'), 'website-laten-maken-oisterwijk.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('diensten.html'), '/diensten');
  assert.equal(getIndexablePublicHtmlFileFromPath('/ai-automatisering'), 'ai-automatisering.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/crm-systeem-op-maat'), 'crm-systeem-op-maat.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/ai-telefonist'), 'ai-telefonist.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/voicesoftware-op-maat'), 'premium-voicesoftware.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('pakketten.html'), '/pakketten');
  assert.equal(getIndexablePublicHtmlFileFromPath('/pakketten'), 'pakketten.html');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-bedrijfssoftware'), '/bedrijfssoftware-op-maat');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-chatbot'), '/chatbot-laten-maken');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-voicesoftware'), '/voicesoftware-op-maat');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-pakketten'), '/pakketten');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-website'), '/');
});

test('public packages page is a clean public sales page without premium sidebar links', () => {
  const source = fs.readFileSync(path.join(root, 'pakketten.html'), 'utf8');

  assert.match(source, /<h1\b[\s\S]*Pakketten voor bouwen, beheren en groeien[\s\S]*<\/h1>/i);
  assert.doesNotMatch(source, /sidebar-link|premium-sidebar|personnel-theme/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);
  assert.doesNotMatch(source, /premium-personeel|premium-dashboard|admin-menu|admin-nav/i);
});

test('public seo registry points to existing crawlable pages with h1 and link graph', () => {
  const pages = getIndexablePublicSeoPages(KNOWN_FILES);
  const seenPaths = new Set();

  pages.forEach((entry) => {
    const filePath = path.join(root, entry.fileName);
    assert.ok(fs.existsSync(filePath), `${entry.fileName} ontbreekt voor ${entry.path}`);
    assert.ok(!seenPaths.has(entry.path), `${entry.path} staat dubbel in de SEO registry`);
    seenPaths.add(entry.path);

    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /<h1\b[\s\S]*?<\/h1>/i, `${entry.fileName} mist een H1`);
    assert.doesNotMatch(source, /data-public-lock-input|premium-public-lock\.js|Binnenkort beschikbaar/, entry.fileName);

    if (entry.kind !== 'legal') {
      const links = getPublicSeoInternalLinks(entry);
      assert.ok(links.length >= 4, `${entry.path} mist interne SEO-links`);
      assert.ok(links.every((link) => /^\/[a-z0-9/_-]+$/i.test(link.href)), `${entry.path} heeft geen schone interne links`);
    }
  });
});

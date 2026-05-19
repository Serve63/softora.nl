const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentItem,
  getSeoContentPublicPaths,
  getSeoContentSitemapEntries,
} = require('../../server/services/seo-content');

test('seo content exposes blog and kennisbank paths for crawl and sitemap discovery', () => {
  const publicPaths = getSeoContentPublicPaths();
  const sitemapEntries = getSeoContentSitemapEntries();

  assert.ok(publicPaths.includes('/blog'));
  assert.ok(publicPaths.includes('/kennisbank'));
  assert.ok(publicPaths.includes('/blog/ai-automatisering-mkb-waar-beginnen'));
  assert.ok(publicPaths.includes('/blog/website-laten-maken-kosten-2026'));
  assert.ok(publicPaths.includes('/blog/chatbot-laten-maken-wanneer-zinvol'));
  assert.ok(publicPaths.includes('/kennisbank/wat-is-bedrijfssoftware-op-maat'));
  assert.ok(publicPaths.includes('/premium-blog'), 'Legacy blog route moet crawlbaar blijven voor de redirect.');
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/ai-automatisering-mkb-waar-beginnen'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/website-laten-maken-kosten-2026'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/chatbot-laten-maken-wanneer-zinvol'));
  assert.ok(sitemapEntries.every((entry) => !String(entry.path).includes('premium-blog')));
});

test('seo content renders the existing blog visual language with real links', () => {
  const html = buildSeoContentIndexHtml('blog', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, /data-softora-public-seo="structured-data"/);
  assert.match(html, /class="hero-banner"/);
  assert.match(html, /class="filter-bar"/);
  assert.match(html, /class="blog-card featured"/);
  assert.match(html, /href="\/diensten">Diensten<\/a>/);
  assert.match(html, /href="\/ai-automatisering">AI<\/a>/);
  assert.match(html, /href="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(html, /href="\/blog\/website-laten-maken-kosten-2026"/);
  assert.match(html, /href="\/blog\/chatbot-laten-maken-wanneer-zinvol"/);
  assert.doesNotMatch(html, /data-public-lock-input/);
  assert.doesNotMatch(html, /premium-public-lock/);
});

test('seo content article pages render Article schema and self canonicals', () => {
  const item = getSeoContentItem('blog', 'ai-automatisering-mkb-waar-beginnen');
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog\/ai-automatisering-mkb-waar-beginnen">/
  );
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /AI automatisering voor het MKB: waar begin je\?/);
  assert.match(html, /href="\/blog">Terug naar blog<\/a>/);
  assert.match(html, /href="\/ai-telefonist"/);
});

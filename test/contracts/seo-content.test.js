const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentItem,
  getSeoContentItems,
  getSeoContentCollectionPaths,
  getSeoContentPillars,
  getSeoContentPublicationPlan,
  getSeoContentPublicPaths,
  getSeoContentSitemapEntries,
} = require('../../server/services/seo-content');

test('seo content exposes blog and kennisbank paths for crawl and sitemap discovery', () => {
  const publicPaths = getSeoContentPublicPaths({ now: new Date('2026-05-19T12:00:00.000Z') });
  const sitemapEntries = getSeoContentSitemapEntries({ now: new Date('2026-05-19T12:00:00.000Z') });

  assert.ok(publicPaths.includes('/blog'));
  assert.ok(publicPaths.includes('/kennisbank'));
  assert.ok(publicPaths.includes('/branches'));
  assert.ok(publicPaths.includes('/regio'));
  assert.ok(publicPaths.includes('/blog/ai-automatisering-mkb-waar-beginnen'));
  assert.ok(publicPaths.includes('/blog/website-laten-maken-kosten-2026'));
  assert.ok(publicPaths.includes('/blog/chatbot-laten-maken-wanneer-zinvol'));
  assert.ok(publicPaths.includes('/kennisbank/wat-is-bedrijfssoftware-op-maat'));
  assert.ok(publicPaths.includes('/branches/installateurs'));
  assert.ok(publicPaths.includes('/branches/makelaars'));
  assert.ok(publicPaths.includes('/regio/oisterwijk'));
  assert.ok(publicPaths.includes('/regio/tilburg'));
  assert.ok(!publicPaths.includes('/blog/website-laten-maken-mkb-paginas'));
  assert.ok(publicPaths.includes('/premium-blog'), 'Legacy blog route moet crawlbaar blijven voor de redirect.');
  assert.ok(getSeoContentCollectionPaths().includes('/branches'));
  assert.ok(getSeoContentCollectionPaths().includes('/regio'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/ai-automatisering-mkb-waar-beginnen'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/website-laten-maken-kosten-2026'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/chatbot-laten-maken-wanneer-zinvol'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/branches/installateurs'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/regio/den-bosch'));
  assert.ok(!sitemapEntries.some((entry) => entry.path === '/blog/website-laten-maken-mkb-paginas'));
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
  assert.match(html, /SEO groeipijlers/);
  assert.match(html, /Software, CRM en dashboards/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(html, /href="\/diensten">Diensten<\/a>/);
  assert.match(html, /href="\/ai-automatisering">AI<\/a>/);
  assert.match(html, /href="\/branches">Branches<\/a>/);
  assert.match(html, /href="\/regio">Regio<\/a>/);
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

test('seo content renders branche en regio landingspagina’s met service schema', () => {
  const brancheIndexHtml = buildSeoContentIndexHtml('branches', {
    siteOrigin: 'https://www.softora.nl',
  });
  const regioItem = getSeoContentItem('regio', 'tilburg');
  const regioHtml = buildSeoContentArticleHtml(regioItem, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(brancheIndexHtml, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/branches">/);
  assert.match(brancheIndexHtml, /Digitale groei per branche/);
  assert.match(brancheIndexHtml, /href="\/branches\/installateurs"/);
  assert.match(brancheIndexHtml, /href="\/branches\/zakelijke-dienstverleners"/);

  assert.match(regioHtml, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/regio\/tilburg">/);
  assert.match(regioHtml, /"@type":"Service"/);
  assert.match(regioHtml, /"areaServed":\{"@type":"AdministrativeArea","name":"Tilburg"\}/);
  assert.match(regioHtml, /Terug naar regio/);
  assert.match(regioHtml, /href="\/crm-systeem-op-maat"/);
});

test('seo content heeft een dagelijkse publicatiebuffer die pas live komt op publicatiedatum', () => {
  const beforeLaunch = new Date('2026-05-19T12:00:00.000Z');
  const afterLaunch = new Date('2026-05-26T12:00:00.000Z');

  const plan = getSeoContentPublicationPlan({ now: beforeLaunch });
  const scheduled = plan.filter((item) => item.status === 'scheduled');

  assert.ok(scheduled.length >= 7, 'De contentmachine moet minimaal een week vooruit gepland zijn.');
  assert.ok(scheduled.some((item) => item.path === '/blog/website-laten-maken-mkb-paginas'));
  assert.ok(scheduled.some((item) => item.path === '/kennisbank/wat-is-ai-automatisering'));

  assert.ok(!getSeoContentPublicPaths({ now: beforeLaunch }).includes('/blog/chatbot-vs-livechat'));
  assert.ok(getSeoContentPublicPaths({ now: afterLaunch }).includes('/blog/chatbot-vs-livechat'));
  assert.ok(getSeoContentSitemapEntries({ now: afterLaunch }).some((entry) => entry.path === '/blog/chatbot-vs-livechat'));
});

test('seo content bewaakt unieke slugs, clusters en interne links', () => {
  const items = getSeoContentItems({ now: new Date('2026-06-01T12:00:00.000Z') });
  const paths = items.map((item) => `${item.collection}/${item.slug}`);
  const uniquePaths = new Set(paths);

  assert.equal(uniquePaths.size, paths.length);
  assert.ok(getSeoContentPillars().length >= 4);

  for (const item of items) {
    assert.ok(item.title.length >= 20, item.slug);
    assert.ok(item.description.length >= 80, item.slug);
    assert.ok(item.sections.length >= 3, item.slug);
    assert.ok(item.relatedLinks.length >= 3, item.slug);
    assert.ok(item.relatedLinks.every((link) => String(link.href || '').startsWith('/')), item.slug);
    if (item.collection === 'branches' || item.collection === 'regio') {
      assert.equal(item.schemaType, 'Service', item.slug);
    }
  }
});

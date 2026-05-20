const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  countSeoContentWords,
  getSeoContentClusterForItem,
  getSeoContentClusters,
  getSeoContentItem,
  getSeoContentItems,
  getSeoContentMinimumWordCount,
  getSeoContentImageForItem,
  getSeoContentPathForItem,
  getSeoContentCollectionPaths,
  getSeoContentPillars,
  getSeoContentPublicationPlan,
  getSeoContentPublicPaths,
  getSeoContentSitemapEntries,
} = require('../../server/services/seo-content');

const repoRoot = path.resolve(__dirname, '../..');

function extractCssRuleBlock(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`\\n${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

test('seo content exposes blog and kennisbank paths for crawl and sitemap discovery', () => {
  const publicPaths = getSeoContentPublicPaths({ now: new Date('2026-05-19T12:00:00.000Z') });
  const sitemapEntries = getSeoContentSitemapEntries({ now: new Date('2026-05-19T12:00:00.000Z') });

  assert.ok(publicPaths.includes('/blog'));
  assert.ok(publicPaths.includes('/kennisbank'));
  assert.ok(publicPaths.includes('/vergelijkingen'));
  assert.ok(publicPaths.includes('/branches'));
  assert.ok(publicPaths.includes('/regio'));
  assert.ok(publicPaths.includes('/blog/ai-automatisering-mkb-waar-beginnen'));
  assert.ok(publicPaths.includes('/blog/website-laten-maken-kosten-2026'));
  assert.ok(publicPaths.includes('/blog/chatbot-laten-maken-wanneer-zinvol'));
  assert.ok(publicPaths.includes('/kennisbank/wat-is-bedrijfssoftware-op-maat'));
  assert.ok(publicPaths.includes('/vergelijkingen/website-laten-maken-vs-zelf-maken'));
  assert.ok(publicPaths.includes('/vergelijkingen/ai-telefonist-vs-receptionist'));
  assert.ok(publicPaths.includes('/branches/installateurs'));
  assert.ok(publicPaths.includes('/branches/makelaars'));
  assert.ok(publicPaths.includes('/regio/oisterwijk'));
  assert.ok(publicPaths.includes('/regio/tilburg'));
  assert.ok(!publicPaths.includes('/blog/website-laten-maken-mkb-paginas'));
  assert.ok(publicPaths.includes('/premium-blog'), 'Legacy blog route moet crawlbaar blijven voor de redirect.');
  assert.ok(getSeoContentCollectionPaths().includes('/vergelijkingen'));
  assert.ok(getSeoContentCollectionPaths().includes('/branches'));
  assert.ok(getSeoContentCollectionPaths().includes('/regio'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/ai-automatisering-mkb-waar-beginnen'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/website-laten-maken-kosten-2026'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/blog/chatbot-laten-maken-wanneer-zinvol'));
  assert.ok(sitemapEntries.some((entry) => entry.path === '/vergelijkingen/website-laten-maken-vs-zelf-maken'));
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
  assert.match(html, /<img src="\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg"/);
  assert.match(html, /alt="Praktische kantoorwerkplek met planning, laptop en procesoverzicht/);
  assert.match(html, /SEO groeipijlers/);
  assert.match(html, /data-softora-public-seo="content-clusters"/);
  assert.match(html, /data-content-cluster="websites"/);
  assert.match(html, /href="\/website-laten-maken">/);
  assert.match(html, /Website groei/);
  assert.match(html, /AI automatisering/);
  assert.match(html, /Software en CRM/);
  assert.match(html, /Software, CRM en dashboards/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(html, /href="\/diensten">Diensten<\/a>/);
  assert.match(html, /href="\/pakketten">Pakketten<\/a>/);
  assert.match(html, /href="\/ai-automatisering">AI<\/a>/);
  assert.match(html, /href="\/branches">Branches<\/a>/);
  assert.match(html, /href="\/regio">Regio<\/a>/);
  assert.match(html, /href="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(html, /href="\/blog\/website-laten-maken-kosten-2026"/);
  assert.match(html, /href="\/blog\/chatbot-laten-maken-wanneer-zinvol"/);
  assert.match(html, /href="\/vergelijkingen">Vergelijkingen<\/a>/);
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
  assert.match(html, /"articleSection":"AI automatisering"/);
  assert.match(html, /"image":\["https:\/\/www\.softora\.nl\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg"\]/);
  assert.match(html, /"wordCount":\d{3,}/);
  assert.match(html, /"author":\{"@type":"Person","name":"Martijn van de Ven"/);
  assert.match(html, /"reviewedBy":\{"@type":"Person","name":"Martijn van de Ven"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /data-softora-public-seo="eeat"/);
  assert.match(html, /data-softora-public-seo="faq"/);
  assert.match(html, />Martijn van de Ven<\/span>/);
  assert.match(html, /<figure class="artikel-img">/);
  assert.match(html, /<img src="\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg"/);
  assert.match(html, /data-content-cluster="ai-automatisering"/);
  assert.match(html, /AI automatisering voor het MKB: waar begin je\?/);
  assert.match(html, /href="\/blog">Terug naar blog<\/a>/);
  assert.match(html, /href="\/ai-telefonist"/);
  assert.match(html, /data-softora-public-seo="conversion-cta"/);
  assert.match(html, /href="\/#contact"[^>]*>Neem contact op<\/a>/);
});

test('seo content article template keeps title, image, body and CTA on the same width', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'assets/seo-content.css'), 'utf8');
  const html = buildSeoContentArticleHtml(getSeoContentItem('blog', 'ai-automatisering-mkb-waar-beginnen'), {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(css, /--article-max:\s*920px;/);
  assert.match(css, /--article-gutter:\s*80px;/);
  assert.match(
    css,
    /\.artikel-hero,\s*\.artikel-img,\s*\.artikel-body,\s*\.content-cta\s*\{[\s\S]*?width:\s*min\(var\(--article-max\), calc\(100% - \(var\(--article-gutter\) \* 2\)\)\);/
  );
  assert.doesNotMatch(extractCssRuleBlock(css, '.artikel-hero'), /max-width:\s*760px/);
  assert.doesNotMatch(extractCssRuleBlock(css, '.artikel-body'), /max-width:\s*680px/);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/seo-content\.css\?v=20260520c">/);
  assert.match(html, /<section class="artikel-hero">/);
  assert.match(html, /<figure class="artikel-img">/);
  assert.match(html, /<article class="artikel-body">/);
  assert.match(html, /<section class="content-cta" data-softora-public-seo="conversion-cta">/);
});

test('seo content images zijn per cluster gekoppeld met beschrijvende bestandsnamen en alt-teksten', () => {
  const items = getSeoContentItems({ now: new Date('2026-06-10T12:00:00.000Z') });
  const seenImages = new Set();

  for (const item of items) {
    const image = getSeoContentImageForItem(item);

    assert.match(image.src, /^\/assets\/seo-content\/[a-z0-9-]+-softora\.jpg$/);
    assert.ok(image.alt.length >= 55, item.slug);
    assert.doesNotMatch(image.alt, /placeholder|binnenkort|foto moet|later/i);
    seenImages.add(image.src);
  }

  assert.ok(seenImages.size >= 6, 'Elke SEO-cluster moet een eigen herkenbare foto hebben.');
});

test('seo content renders vergelijkingshub met koopintentie en CTA', () => {
  const indexHtml = buildSeoContentIndexHtml('vergelijkingen', {
    siteOrigin: 'https://www.softora.nl',
  });
  const item = getSeoContentItem('vergelijkingen', 'website-laten-maken-vs-zelf-maken');
  const articleHtml = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(indexHtml, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/vergelijkingen">/);
  assert.match(indexHtml, /Kiezen tussen digitale oplossingen/);
  assert.match(indexHtml, /href="\/vergelijkingen\/website-laten-maken-vs-zelf-maken"/);
  assert.match(indexHtml, /href="\/vergelijkingen\/ai-telefonist-vs-receptionist"/);
  assert.match(indexHtml, /class="filter-tab active" href="\/vergelijkingen">Vergelijkingen/);

  assert.match(
    articleHtml,
    /<link rel="canonical" href="https:\/\/www\.softora\.nl\/vergelijkingen\/website-laten-maken-vs-zelf-maken">/
  );
  assert.match(articleHtml, /"@type":"Article"/);
  assert.match(articleHtml, /Terug naar vergelijkingen/);
  assert.match(articleHtml, /href="\/website-laten-maken"[^>]*>Website laten maken<\/a>/);
  assert.match(articleHtml, /href="\/blog\/website-laten-maken-mkb-paginas"/);
  assert.match(articleHtml, /href="\/website-laten-maken-oisterwijk"/);
  assert.match(articleHtml, /data-softora-public-seo="conversion-cta"/);
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
  assert.match(regioHtml, /href="\/branches\/zakelijke-dienstverleners"/);
});

test('live seo content keeps weak pages supported by contextual incoming links', () => {
  const now = new Date('2026-05-20T12:00:00.000Z');
  const collectionPaths = getSeoContentCollectionPaths();
  const pages = [
    ...collectionPaths.map((pathName) => {
      const collection = pathName.replace(/^\//, '');
      return {
        path: pathName,
        html: buildSeoContentIndexHtml(collection, { siteOrigin: 'https://www.softora.nl', now }),
      };
    }),
    ...getSeoContentItems({ now }).map((item) => ({
      path: getSeoContentPathForItem(item),
      html: buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' }),
    })),
  ];
  const publicPaths = new Set(pages.map((page) => page.path));
  const incoming = new Map(pages.map((page) => [page.path, new Set()]));

  for (const page of pages) {
    const hrefs = Array.from(page.html.matchAll(/href=["']([^"'?#]+)(?:[?#][^"']*)?["']/g))
      .map((match) => match[1])
      .filter((href) => href.startsWith('/'))
      .map((href) => href.replace(/\/$/, '') || '/');

    for (const href of hrefs) {
      if (href !== page.path && publicPaths.has(href)) {
        incoming.get(href).add(page.path);
      }
    }
  }

  for (const page of pages) {
    if (collectionPaths.includes(page.path)) continue;
    assert.ok(incoming.get(page.path).size >= 2, `${page.path} heeft te weinig contextuele interne ingangen.`);
  }
});

test('seo content heeft een dagelijkse publicatiebuffer die pas live komt op publicatiedatum', () => {
  const beforeLaunch = new Date('2026-05-19T12:00:00.000Z');
  const afterLaunch = new Date('2026-05-26T12:00:00.000Z');
  const afterWeekTwo = new Date('2026-06-02T12:00:00.000Z');

  const plan = getSeoContentPublicationPlan({ now: beforeLaunch });
  const scheduled = plan.filter((item) => item.status === 'scheduled');

  assert.ok(scheduled.length >= 7, 'De contentmachine moet minimaal een week vooruit gepland zijn.');
  assert.ok(plan.every((item) => item.cluster), 'Elke publicatie moet aan een cluster hangen.');
  assert.ok(scheduled.some((item) => item.path === '/blog/website-laten-maken-mkb-paginas'));
  assert.ok(scheduled.some((item) => item.path === '/kennisbank/wat-is-ai-automatisering'));
  assert.ok(scheduled.some((item) => item.path === '/vergelijkingen/maatwerk-software-vs-standaard-software'));
  assert.ok(scheduled.some((item) => item.path === '/kennisbank/wat-is-een-crm-systeem'));
  assert.ok(scheduled.some((item) => item.path === '/blog/ai-automatisering-leadopvolging'));
  assert.ok(scheduled.some((item) => item.path === '/blog/ai-telefonist-voor-afspraakintake'));
  assert.ok(scheduled.some((item) => item.path === '/kennisbank/wat-is-interne-linkstructuur'));

  assert.ok(!getSeoContentPublicPaths({ now: beforeLaunch }).includes('/vergelijkingen/chatbot-vs-livechat'));
  assert.ok(!getSeoContentPublicPaths({ now: beforeLaunch }).includes('/kennisbank/wat-is-een-crm-systeem'));
  assert.ok(getSeoContentPublicPaths({ now: afterLaunch }).includes('/vergelijkingen/chatbot-vs-livechat'));
  assert.ok(getSeoContentPublicPaths({ now: afterWeekTwo }).includes('/kennisbank/wat-is-een-crm-systeem'));
  assert.ok(getSeoContentPublicPaths({ now: afterWeekTwo }).includes('/blog/ai-automatisering-leadopvolging'));
  assert.ok(getSeoContentPublicPaths({ now: afterWeekTwo }).includes('/blog/ai-telefonist-voor-afspraakintake'));
  assert.ok(getSeoContentPublicPaths({ now: afterWeekTwo }).includes('/kennisbank/wat-is-interne-linkstructuur'));
  assert.ok(
    getSeoContentSitemapEntries({ now: afterLaunch }).some((entry) => entry.path === '/vergelijkingen/chatbot-vs-livechat')
  );
  assert.ok(
    getSeoContentSitemapEntries({ now: afterWeekTwo }).some(
      (entry) => entry.path === '/blog/ai-telefonist-voor-afspraakintake'
    )
  );
  assert.ok(
    getSeoContentSitemapEntries({ now: afterWeekTwo }).some(
      (entry) => entry.path === '/kennisbank/wat-is-interne-linkstructuur'
    )
  );
});

test('seo content bewaakt unieke slugs, clusters en interne links', () => {
  const items = getSeoContentItems({ now: new Date('2026-06-01T12:00:00.000Z') });
  const paths = items.map((item) => `${item.collection}/${item.slug}`);
  const uniquePaths = new Set(paths);
  const clusterKeys = new Set(getSeoContentClusters().map((cluster) => cluster.key));
  const commercialTargets = new Set([
    '/website-laten-maken',
    '/ai-automatisering',
    '/bedrijfssoftware-op-maat',
    '/crm-systeem-op-maat',
    '/chatbot-laten-maken',
    '/ai-telefonist',
    '/voicesoftware-op-maat',
    '/diensten',
  ]);

  assert.equal(uniquePaths.size, paths.length);
  assert.ok(getSeoContentPillars().length >= 4);
  assert.ok(getSeoContentClusters().length >= 6);

  for (const item of items) {
    const cluster = getSeoContentClusterForItem(item);

    assert.ok(item.title.length >= 20, item.slug);
    assert.ok(item.description.length >= 80, item.slug);
    assert.ok(item.sections.length >= 3, item.slug);
    assert.ok(countSeoContentWords(item) >= getSeoContentMinimumWordCount(item), `${item.slug} is te dun voor SEO.`);
    assert.ok(item.wordCount >= getSeoContentMinimumWordCount(item), `${item.slug} mist berekende woordkwaliteit.`);
    assert.ok(item.author && item.author.name === 'Martijn van de Ven', `${item.slug} mist auteur.`);
    assert.ok(item.reviewedBy && item.reviewedBy.name === 'Martijn van de Ven', `${item.slug} mist review-signaal.`);
    assert.ok(Array.isArray(item.faq) && item.faq.length >= 3, `${item.slug} mist FAQ-verdieping.`);
    assert.ok(item.relatedLinks.length >= 3, item.slug);
    assert.ok(item.relatedLinks.every((link) => String(link.href || '').startsWith('/')), item.slug);
    assert.ok(clusterKeys.has(cluster.key), item.slug);
    assert.ok(
      item.relatedLinks.some((link) => commercialTargets.has(String(link.href || ''))),
      `${item.slug} moet naar minimaal een money page linken.`
    );
    if (item.collection === 'branches' || item.collection === 'regio') {
      assert.equal(item.schemaType, 'Service', item.slug);
    }
  }
});

test('live seo content links only to public or stable pages', () => {
  const now = new Date('2026-05-20T12:00:00.000Z');
  const liveContentPaths = new Set(getSeoContentPublicPaths({ now }));
  const stablePublicPaths = new Set([
    '/',
    '/diensten',
    '/website-laten-maken',
    '/website-laten-maken-oisterwijk',
    '/ai-automatisering',
    '/bedrijfssoftware-op-maat',
    '/crm-systeem-op-maat',
    '/maatwerk-platform',
    '/chatbot-laten-maken',
    '/ai-telefonist',
    '/voicesoftware-op-maat',
    '/pakketten',
    '/over-softora',
    '/algemene-voorwaarden',
    '/privacybeleid',
  ]);
  const allowedPaths = new Set([...liveContentPaths, ...stablePublicPaths]);

  for (const item of getSeoContentItems({ now })) {
    for (const link of item.relatedLinks || []) {
      assert.ok(
        allowedPaths.has(link.href),
        `${getSeoContentPathForItem(item)} linkt naar niet-live content: ${link.href}`
      );
    }
  }
});

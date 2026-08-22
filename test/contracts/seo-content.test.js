const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SEO_CONTENT_IMAGES_BY_CLUSTER,
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
const {
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
} = require('../../server/services/public-seo');
const { extractInternalLinksFromHtml } = require('../../server/services/seo-machine-quality-gates');

const repoRoot = path.resolve(__dirname, '../..');

function extractCssRuleBlock(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`\\n${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

function readJpegDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  throw new Error(`Geen JPEG-dimensies gevonden voor ${filePath}`);
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

test('seo content houdt future-dated publicaties uit routes en sitemap tot publicatiedatum', () => {
  const beforeWeeklyBatch = new Date('2026-06-01T23:59:59.000Z');
  const firstBatchDay = new Date('2026-06-02T12:00:00.000Z');
  const afterWeeklyBatch = new Date('2026-06-08T12:00:00.000Z');
  const scheduledPaths = [
    '/blog/ai-automatisering-leadkwalificatie-mkb',
    '/kennisbank/wat-is-leadkwalificatie',
    '/blog/website-leadgeneratie-mkb-meten',
    '/kennisbank/wat-is-crm-datakwaliteit',
    '/regio/midden-brabant',
  ];

  const earlyPaths = getSeoContentPublicPaths({ now: beforeWeeklyBatch });
  const earlySitemap = getSeoContentSitemapEntries({ now: beforeWeeklyBatch });
  for (const pathName of scheduledPaths) {
    assert.ok(!earlyPaths.includes(pathName), `${pathName} mag nog niet publiek zijn.`);
    assert.ok(!earlySitemap.some((entry) => entry.path === pathName), `${pathName} mag nog niet in sitemap staan.`);
  }

  assert.ok(getSeoContentPublicPaths({ now: firstBatchDay }).includes('/blog/ai-automatisering-leadkwalificatie-mkb'));
  assert.ok(
    getSeoContentSitemapEntries({ now: firstBatchDay }).some(
      (entry) => entry.path === '/blog/ai-automatisering-leadkwalificatie-mkb'
    )
  );

  const livePaths = getSeoContentPublicPaths({ now: afterWeeklyBatch });
  const liveSitemap = getSeoContentSitemapEntries({ now: afterWeeklyBatch });
  for (const pathName of scheduledPaths) {
    assert.ok(livePaths.includes(pathName), `${pathName} moet na publicatiedatum publiek zijn.`);
    assert.ok(liveSitemap.some((entry) => entry.path === pathName), `${pathName} moet na publicatiedatum in sitemap staan.`);
  }
});

test('seo content linkt op publicatiedatum niet naar future-dated content', () => {
  const now = new Date('2026-06-02T12:00:00.000Z');
  const publicPaths = new Set([
    ...INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => entry.path),
    ...getSeoContentPublicPaths({ now }),
  ]);
  const pages = [
    ...getSeoContentCollectionPaths().map((pathName) => ({
      path: pathName,
      html: buildSeoContentIndexHtml(pathName.replace(/^\//, ''), {
        siteOrigin: 'https://www.softora.nl',
        now,
      }),
    })),
    ...getSeoContentItems({ now }).map((item) => ({
      path: getSeoContentPathForItem(item),
      html: buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' }),
    })),
  ];

  const brokenLinks = pages.flatMap((page) =>
    extractInternalLinksFromHtml(page.html)
      .filter((href) => !href.startsWith('/assets/'))
      .filter((href) => !publicPaths.has(href))
      .map((href) => `${page.path} -> ${href}`)
  );

  assert.deepEqual(brokenLinks, []);
});

test('CRM kennisbankcluster ondersteunt sales pipeline en datakwaliteit richting de money page', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  const pages = [
    getSeoContentItem('kennisbank', 'wat-is-een-crm-systeem', { now }),
    getSeoContentItem('kennisbank', 'wat-is-crm-datakwaliteit', { now }),
    getSeoContentItem('kennisbank', 'wat-is-een-sales-pipeline-crm', { now }),
  ].map((item) => ({
    path: getSeoContentPathForItem(item),
    html: buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' }),
  }));

  for (const page of pages) {
    assert.match(page.html, /href="\/crm-systeem-op-maat"/, `${page.path} moet de CRM money page ondersteunen.`);
  }

  const crmSystem = pages.find((page) => page.path === '/kennisbank/wat-is-een-crm-systeem').html;
  const dataQuality = pages.find((page) => page.path === '/kennisbank/wat-is-crm-datakwaliteit').html;
  const salesPipeline = pages.find((page) => page.path === '/kennisbank/wat-is-een-sales-pipeline-crm').html;

  assert.match(crmSystem, /Let op pipeline en datakwaliteit/);
  assert.match(crmSystem, /href="\/kennisbank\/wat-is-crm-datakwaliteit"/);
  assert.match(crmSystem, /href="\/kennisbank\/wat-is-een-sales-pipeline-crm"/);
  assert.match(dataQuality, /Signalen dat CRM-data opvolging remt/);
  assert.match(dataQuality, /href="\/kennisbank\/wat-is-een-sales-pipeline-crm"/);
  assert.match(salesPipeline, /Praktische fases voor MKB leadopvolging/);
  assert.match(salesPipeline, /nieuwe lead, te kwalificeren, afspraak gepland, voorstel verstuurd/);
});

test('seo content toont datumgebonden related links pas wanneer de steunpagina live is', () => {
  const beforeLeadQualification = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-automatisering-leadkwalificatie-mkb', {
      now: new Date('2026-06-02T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const afterLeadQualification = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-automatisering-leadkwalificatie-mkb', {
      now: new Date('2026-06-03T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.doesNotMatch(beforeLeadQualification, /href="\/kennisbank\/wat-is-leadkwalificatie"/);
  assert.match(afterLeadQualification, /href="\/kennisbank\/wat-is-leadkwalificatie"/);
});

test('seo content houdt de volgende wekelijkse batch uit public routes tot publicatie', () => {
  const beforeNextBatch = new Date('2026-06-08T23:59:59.000Z');
  const firstNextBatchDay = new Date('2026-06-09T12:00:00.000Z');
  const afterNextBatch = new Date('2026-06-15T12:00:00.000Z');
  const nextBatchPaths = [
    '/blog/ai-processen-automatiseren-zonder-controle-verliezen',
    '/kennisbank/wat-is-een-ai-workflow',
    '/blog/website-crm-koppeling-leadopvolging-mkb',
    '/kennisbank/wat-is-een-sales-pipeline-crm',
    '/vergelijkingen/crm-op-maat-vs-standaard-crm',
  ];

  const earlyPaths = getSeoContentPublicPaths({ now: beforeNextBatch });
  const earlySitemap = getSeoContentSitemapEntries({ now: beforeNextBatch });
  for (const pathName of nextBatchPaths) {
    assert.ok(!earlyPaths.includes(pathName), `${pathName} mag voor publicatiedatum niet publiek zijn.`);
    assert.ok(!earlySitemap.some((entry) => entry.path === pathName), `${pathName} mag voor publicatiedatum niet in sitemap staan.`);
  }

  assert.ok(
    getSeoContentPublicPaths({ now: firstNextBatchDay }).includes(
      '/blog/ai-processen-automatiseren-zonder-controle-verliezen'
    )
  );
  assert.ok(
    getSeoContentSitemapEntries({ now: firstNextBatchDay }).some(
      (entry) => entry.path === '/blog/ai-processen-automatiseren-zonder-controle-verliezen'
    )
  );

  const livePaths = getSeoContentPublicPaths({ now: afterNextBatch });
  const liveSitemap = getSeoContentSitemapEntries({ now: afterNextBatch });
  for (const pathName of nextBatchPaths) {
    assert.ok(livePaths.includes(pathName), `${pathName} moet op of na publicatiedatum publiek zijn.`);
    assert.ok(liveSitemap.some((entry) => entry.path === pathName), `${pathName} moet op of na publicatiedatum in sitemap staan.`);
  }
});

test('seo content houdt de derde wekelijkse batch uit public routes tot publicatie', () => {
  const beforeThirdBatch = new Date('2026-06-15T23:59:59.000Z');
  const firstThirdBatchDay = new Date('2026-06-16T12:00:00.000Z');
  const afterThirdBatch = new Date('2026-06-22T12:00:00.000Z');
  const thirdBatchPaths = [
    '/blog/ai-automatisering-offerte-opvolging-mkb',
    '/kennisbank/wat-is-offerte-automatisering',
    '/blog/chatbot-crm-koppeling-leads-opvolgen',
    '/kennisbank/wat-is-een-klantportaal',
    '/regio/tilburg-ai-automatisering',
  ];

  const earlyPaths = getSeoContentPublicPaths({ now: beforeThirdBatch });
  const earlySitemap = getSeoContentSitemapEntries({ now: beforeThirdBatch });
  for (const pathName of thirdBatchPaths) {
    assert.ok(!earlyPaths.includes(pathName), `${pathName} mag voor publicatiedatum niet publiek zijn.`);
    assert.ok(!earlySitemap.some((entry) => entry.path === pathName), `${pathName} mag voor publicatiedatum niet in sitemap staan.`);
  }

  assert.ok(
    getSeoContentPublicPaths({ now: firstThirdBatchDay }).includes(
      '/blog/ai-automatisering-offerte-opvolging-mkb'
    )
  );
  assert.ok(
    getSeoContentSitemapEntries({ now: firstThirdBatchDay }).some(
      (entry) => entry.path === '/blog/ai-automatisering-offerte-opvolging-mkb'
    )
  );

  const livePaths = getSeoContentPublicPaths({ now: afterThirdBatch });
  const liveSitemap = getSeoContentSitemapEntries({ now: afterThirdBatch });
  for (const pathName of thirdBatchPaths) {
    assert.ok(livePaths.includes(pathName), `${pathName} moet op of na publicatiedatum publiek zijn.`);
    assert.ok(liveSitemap.some((entry) => entry.path === pathName), `${pathName} moet op of na publicatiedatum in sitemap staan.`);
  }
});

test('seo content houdt de vierde wekelijkse batch uit public routes en sitemap tot publicatie', () => {
  const beforeFourthBatch = new Date('2026-06-22T23:59:59.000Z');
  const firstFourthBatchDay = new Date('2026-06-23T12:00:00.000Z');
  const afterFourthBatch = new Date('2026-06-29T12:00:00.000Z');
  const fourthBatchPaths = [
    '/blog/ai-automatisering-klantintake-mkb',
    '/kennisbank/wat-is-procesautomatisering',
    '/blog/website-laten-maken-tilburg-leadgeneratie',
    '/kennisbank/wat-is-een-crm-integratie',
    '/branches/adviesbureaus',
  ];

  const earlyPaths = getSeoContentPublicPaths({ now: beforeFourthBatch });
  const earlySitemap = getSeoContentSitemapEntries({ now: beforeFourthBatch });
  for (const pathName of fourthBatchPaths) {
    assert.ok(!earlyPaths.includes(pathName), `${pathName} mag voor publicatiedatum niet publiek zijn.`);
    assert.ok(!earlySitemap.some((entry) => entry.path === pathName), `${pathName} mag voor publicatiedatum niet in sitemap staan.`);
  }

  assert.ok(
    getSeoContentPublicPaths({ now: firstFourthBatchDay }).includes('/blog/ai-automatisering-klantintake-mkb')
  );
  assert.ok(
    getSeoContentSitemapEntries({ now: firstFourthBatchDay }).some(
      (entry) => entry.path === '/blog/ai-automatisering-klantintake-mkb'
    )
  );

  const livePaths = getSeoContentPublicPaths({ now: afterFourthBatch });
  const liveSitemap = getSeoContentSitemapEntries({ now: afterFourthBatch });
  for (const pathName of fourthBatchPaths) {
    assert.ok(livePaths.includes(pathName), `${pathName} moet op of na publicatiedatum publiek zijn.`);
    assert.ok(liveSitemap.some((entry) => entry.path === pathName), `${pathName} moet op of na publicatiedatum in sitemap staan.`);
  }
});

test('seo content verbergt vierde-batch links naar steunpagina’s tot die live zijn', () => {
  const beforeProcessAutomation = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-automatisering-klantintake-mkb', {
      now: new Date('2026-06-23T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const afterProcessAutomation = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-automatisering-klantintake-mkb', {
      now: new Date('2026-06-24T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const beforeCrmIntegration = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'website-laten-maken-tilburg-leadgeneratie', {
      now: new Date('2026-06-25T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const afterCrmIntegration = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'website-laten-maken-tilburg-leadgeneratie', {
      now: new Date('2026-06-26T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.doesNotMatch(beforeProcessAutomation, /href="\/kennisbank\/wat-is-procesautomatisering"/);
  assert.match(afterProcessAutomation, /href="\/kennisbank\/wat-is-procesautomatisering"/);
  assert.doesNotMatch(beforeCrmIntegration, /href="\/kennisbank\/wat-is-een-crm-integratie"/);
  assert.match(afterCrmIntegration, /href="\/kennisbank\/wat-is-een-crm-integratie"/);
});

test('seo content houdt de vijfde wekelijkse batch uit public routes en sitemap tot publicatie', () => {
  const beforeFifthBatch = new Date('2026-06-29T12:00:00.000Z');
  const firstFifthBatchDay = new Date('2026-06-30T12:00:00.000Z');
  const afterFifthBatch = new Date('2026-07-03T12:00:00.000Z');
  const fifthBatchPaths = [
    '/branches/adviesbureaus',
    '/blog/crm-taken-reminders-automatiseren-mkb',
    '/kennisbank/wat-is-lead-scoring',
    '/blog/ai-telefonie-menselijke-overdracht',
    '/kennisbank/wat-is-chatbot-overdracht',
  ];
  const newSupportPaths = fifthBatchPaths.slice(1);

  const earlyPaths = getSeoContentPublicPaths({ now: beforeFifthBatch });
  const earlySitemap = getSeoContentSitemapEntries({ now: beforeFifthBatch });
  assert.ok(earlyPaths.includes('/branches/adviesbureaus'));
  assert.ok(earlySitemap.some((entry) => entry.path === '/branches/adviesbureaus'));
  for (const pathName of newSupportPaths) {
    assert.ok(!earlyPaths.includes(pathName), `${pathName} mag voor publicatiedatum niet publiek zijn.`);
    assert.ok(!earlySitemap.some((entry) => entry.path === pathName), `${pathName} mag voor publicatiedatum niet in sitemap staan.`);
  }

  assert.ok(
    getSeoContentPublicPaths({ now: firstFifthBatchDay }).includes(
      '/blog/crm-taken-reminders-automatiseren-mkb'
    )
  );
  assert.ok(
    getSeoContentSitemapEntries({ now: firstFifthBatchDay }).some(
      (entry) => entry.path === '/blog/crm-taken-reminders-automatiseren-mkb'
    )
  );

  const livePaths = getSeoContentPublicPaths({ now: afterFifthBatch });
  const liveSitemap = getSeoContentSitemapEntries({ now: afterFifthBatch });
  for (const pathName of fifthBatchPaths) {
    assert.ok(livePaths.includes(pathName), `${pathName} moet op of na publicatiedatum publiek zijn.`);
    assert.ok(liveSitemap.some((entry) => entry.path === pathName), `${pathName} moet op of na publicatiedatum in sitemap staan.`);
  }
});

test('seo content verbergt vijfde-batch links naar steunpagina’s tot die live zijn', () => {
  const beforeLeadScoring = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-taken-reminders-automatiseren-mkb', {
      now: new Date('2026-06-30T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const afterLeadScoring = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-taken-reminders-automatiseren-mkb', {
      now: new Date('2026-07-01T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const beforeChatbotTransfer = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-telefonie-menselijke-overdracht', {
      now: new Date('2026-07-02T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const afterChatbotTransfer = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-telefonie-menselijke-overdracht', {
      now: new Date('2026-07-03T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.doesNotMatch(beforeLeadScoring, /href="\/kennisbank\/wat-is-lead-scoring"/);
  assert.match(afterLeadScoring, /href="\/kennisbank\/wat-is-lead-scoring"/);
  assert.doesNotMatch(beforeChatbotTransfer, /href="\/kennisbank\/wat-is-chatbot-overdracht"/);
  assert.match(afterChatbotTransfer, /href="\/kennisbank\/wat-is-chatbot-overdracht"/);
});

test('seo content renders the existing blog visual language with real links', () => {
  const html = buildSeoContentIndexHtml('blog', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /data-softora-public-seo="structured-data"/);
  assert.match(html, /class="hero-banner"/);
  assert.match(html, /class="filter-bar"/);
  assert.match(html, /class="blog-card featured"/);
  assert.match(
    html,
    /<img src="\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg" alt="Overleg aan tafel over workflow, planning en procesautomatisering voor het MKB\." width="1600" height="1000"/
  );
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
  assert.match(html, /"image":\[\{"@type":"ImageObject","contentUrl":"https:\/\/www\.softora\.nl\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg"/);
  assert.match(html, /"wordCount":\d{3,}/);
  assert.match(html, /"author":\{"@type":"Person","name":"Martijn van de Ven"/);
  assert.match(html, /"reviewedBy":\{"@type":"Person","name":"Martijn van de Ven"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Wanneer is AI automatisering voor het MKB interessant voor mijn bedrijf\?/);
  assert.doesNotMatch(html, /Wanneer is AI automatisering voor het MKB: waar begin je\? interessant/);
  assert.match(html, /data-softora-public-seo="eeat"/);
  assert.match(html, /data-softora-public-seo="faq"/);
  assert.match(html, />Martijn van de Ven<\/span>/);
  assert.match(html, /<figure class="artikel-img">/);
  assert.match(
    html,
    /<img src="\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg" alt="Overleg aan tafel over workflow, planning en procesautomatisering voor het MKB\." width="1600" height="1000"/
  );
  assert.match(html, /data-content-cluster="ai-automatisering"/);
  assert.match(html, /AI automatisering voor het MKB: waar begin je\?/);
  assert.match(html, /href="\/blog">Terug naar blog<\/a>/);
  assert.match(html, /href="\/ai-telefonist"/);
  assert.match(html, /data-softora-public-seo="conversion-cta"/);
  assert.match(
    html,
    /href="https:\/\/wa\.me\/31643262792"[^>]*data-softora-conversion-target="whatsapp"[^>]*>Contact<\/a>/
  );

  const kennisbankHtml = buildSeoContentArticleHtml(getSeoContentItem('kennisbank', 'wat-is-een-ai-telefonist'), {
    siteOrigin: 'https://www.softora.nl',
  });
  assert.match(kennisbankHtml, /Wanneer is een AI telefonist interessant voor mijn bedrijf\?/);
  assert.doesNotMatch(kennisbankHtml, /Wanneer is Wat is een AI telefonist/);
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
  assert.match(html, /<link rel="stylesheet" href="\/assets\/seo-content\.css\?v=20260608a">/);
  assert.match(html, /<section class="artikel-hero">/);
  assert.match(html, /<figure class="artikel-img">/);
  assert.match(html, /<article class="artikel-body">/);
  assert.match(html, /<section class="content-cta" data-softora-public-seo="conversion-cta">/);
});

test('seo content images zijn per cluster realistisch vastgezet met metadata', () => {
  const items = getSeoContentItems({ now: new Date('2026-06-10T12:00:00.000Z') });
  const seenImages = new Set();

  for (const item of items) {
    const image = getSeoContentImageForItem(item);

    assert.match(image.src, /^\/assets\/seo-content\/[a-z0-9-]+-softora\.jpg$/);
    assert.ok(image.alt.length >= 55, item.slug);
    assert.equal(image.width, 1600, `${item.slug} mist vaste afbeeldingsbreedte`);
    assert.ok([900, 1000].includes(image.height), `${item.slug} mist een ondersteunde vaste afbeeldingshoogte`);
    assert.doesNotMatch(image.alt, /placeholder|binnenkort|foto moet|later/i);
    seenImages.add(image.src);

    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(imagePath), `${image.src} bestaat niet op schijf.`);
    const dimensions = readJpegDimensions(imagePath);
    assert.deepEqual(dimensions, { width: image.width, height: image.height }, image.src);
  }

  assert.ok(seenImages.size >= 6, 'Elke SEO-cluster moet een eigen herkenbare foto hebben.');

  for (const image of Object.values(SEO_CONTENT_IMAGES_BY_CLUSTER)) {
    assert.doesNotMatch(image.src, /generated|placeholder/i);
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    const dimensions = readJpegDimensions(imagePath);
    assert.deepEqual(dimensions, { width: image.width, height: image.height }, image.src);
  }
});

test('nieuwe softwareoffertegids gebruikt precies twee eigen inhoudelijke beelden', () => {
  const item = getSeoContentItem('blog', 'maatwerk-software-offerte-beoordelen');
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });

  assert.equal(item.image.src, '/assets/seo-content/maatwerk-software-offerte-vergelijkingsmatrix-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/maatwerk-software-offerte-waarschuwingssignalen-softora.jpg');
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
});

test('websiteoffertegids gebruikt precies twee eigen beelden en natuurlijke inkomende links', () => {
  const item = getSeoContentItem('blog', 'website-offerte-vergelijken');
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
  const costHtml = buildSeoContentArticleHtml(getSeoContentItem('blog', 'website-laten-maken-kosten-2026'));
  const comparisonHtml = buildSeoContentArticleHtml(
    getSeoContentItem('vergelijkingen', 'website-laten-maken-vs-zelf-maken')
  );

  assert.equal(item.image.src, '/assets/seo-content/website-offerte-vergelijkingsmatrix-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/website-offerte-oplevering-toegang-softora.jpg');
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /href="\/website-laten-maken"/);
  assert.match(costHtml, /href="\/blog\/website-offerte-vergelijken"/);
  assert.match(comparisonHtml, /href="\/blog\/website-offerte-vergelijken"/);
});

test('CRM-kostengids gebruikt precies twee eigen beelden en natuurlijke inkomende links', () => {
  const item = getSeoContentItem('blog', 'crm-systeem-kosten-mkb');
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
  const comparisonHtml = buildSeoContentArticleHtml(
    getSeoContentItem('vergelijkingen', 'crm-op-maat-vs-standaard-crm')
  );
  const spreadsheetHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-systeem-op-maat-spreadsheets-vervangen')
  );

  assert.equal(item.image.src, '/assets/seo-content/crm-totale-kostenopbouw-mkb-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/crm-kostenscenarios-standaard-maatwerk-softora.jpg');
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(comparisonHtml, /href="\/blog\/crm-systeem-kosten-mkb"/);
  assert.match(spreadsheetHtml, /href="\/blog\/crm-systeem-kosten-mkb"/);
});

test('CRM-implementatiegids gebruikt twee eigen procesbeelden, FAQ en inkomende links', () => {
  const item = getSeoContentItem('blog', 'crm-implementatie-doorlooptijd-mkb');
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
  const comparisonHtml = buildSeoContentArticleHtml(
    getSeoContentItem('vergelijkingen', 'crm-op-maat-vs-standaard-crm')
  );
  const definitionHtml = buildSeoContentArticleHtml(
    getSeoContentItem('kennisbank', 'wat-is-een-crm-systeem')
  );

  assert.equal(item.image.src, '/assets/seo-content/crm-implementatiefasen-beslismomenten-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/crm-implementatie-rollen-acceptatie-softora.jpg');
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(comparisonHtml, /href="\/blog\/crm-implementatie-doorlooptijd-mkb"/);
  assert.match(definitionHtml, /href="\/blog\/crm-implementatie-doorlooptijd-mkb"/);
});

test('CRM-eisengids gebruikt twee eigen procesbeelden, FAQ en natuurlijke inkomende links', () => {
  const item = getSeoContentItem('blog', 'crm-eisen-wensenlijst-mkb');
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
  const comparisonHtml = buildSeoContentArticleHtml(
    getSeoContentItem('vergelijkingen', 'crm-op-maat-vs-standaard-crm')
  );
  const implementationHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-implementatie-doorlooptijd-mkb')
  );

  assert.equal(item.image.src, '/assets/seo-content/crm-eisen-requirementscanvas-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/crm-eisen-prioriteitenmatrix-softora.jpg');
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(comparisonHtml, /href="\/blog\/crm-eisen-wensenlijst-mkb"/);
  assert.match(implementationHtml, /href="\/blog\/crm-eisen-wensenlijst-mkb"/);
});

test('bedrijfssoftware-kostengids gebruikt quality v2, twee eigen beelden en inkomende money-page-links', () => {
  const item = getSeoContentItem('blog', 'bedrijfssoftware-laten-maken-kosten', {
    now: new Date('2026-08-03T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
  const softwarePage = fs.readFileSync(path.join(repoRoot, 'premium-bedrijfssoftware.html'), 'utf8');
  const crmPage = fs.readFileSync(path.join(repoRoot, 'crm-systeem-op-maat.html'), 'utf8');

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.targetMoneyPage, '/bedrijfssoftware-op-maat');
  assert.ok(item.informationGain.includes('controleerbare kostenkaart'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.image.src, '/assets/seo-content/bedrijfssoftware-kosten-scopekaart-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/bedrijfssoftware-kosten-fasering-softora.jpg');
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
  assert.match(softwarePage, /href="\/blog\/bedrijfssoftware-laten-maken-kosten"/);
  assert.match(crmPage, /href="\/blog\/bedrijfssoftware-laten-maken-kosten"/);
});

test('chatbot-kostengids gebruikt quality v2, twee eigen beelden en inkomende money-page-links', () => {
  const item = getSeoContentItem('blog', 'chatbot-kosten-mkb', {
    now: new Date('2026-08-04T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' });
  const chatbotPage = fs.readFileSync(path.join(repoRoot, 'premium-chatbot.html'), 'utf8');
  const aiPage = fs.readFileSync(path.join(repoRoot, 'ai-automatisering.html'), 'utf8');
  const firstImagePath = path.join(repoRoot, item.image.src.replace(/^\//, ''));
  const secondImagePath = path.join(repoRoot, item.secondaryImage.src.replace(/^\//, ''));

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.targetMoneyPage, '/chatbot-laten-maken');
  assert.ok(item.informationGain.includes('controleerbaar kostenmodel'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.image.src, '/assets/seo-content/chatbot-kosten-kostenlagen-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg');
  assert.deepEqual(readJpegDimensions(firstImagePath), { width: 1600, height: 1000 });
  assert.deepEqual(readJpegDimensions(secondImagePath), { width: 1600, height: 1000 });
  assert.ok(fs.statSync(firstImagePath).size < 300 * 1024);
  assert.ok(fs.statSync(secondImagePath).size < 300 * 1024);
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /width="1600" height="1000" loading="lazy"/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:image:width" content="1600">/);
  assert.match(html, /<meta property="og:image:height" content="1000">/);
  assert.match(html, /"image":\[\{"@type":"ImageObject","contentUrl":"https:\/\/www\.softora\.nl\/assets\/seo-content\/chatbot-kosten-kostenlagen-softora\.jpg"/);
  assert.match(html, /href="\/chatbot-laten-maken"/);
  assert.match(html, /href="\/blog\/chatbot-crm-koppeling-leads-opvolgen"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
  assert.match(chatbotPage, /href="\/blog\/chatbot-kosten-mkb"/);
  assert.match(aiPage, /href="\/blog\/chatbot-kosten-mkb"/);

  const sitemapEntry = getSeoContentSitemapEntries({ now: new Date('2026-08-04T12:00:00.000Z') })
    .find((entry) => entry.path === '/blog/chatbot-kosten-mkb');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/chatbot-kosten-kostenlagen-softora.jpg',
    '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg',
  ]);
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
  assert.match(regioHtml, /"telephone":"\+31643262792"/);
  assert.match(regioHtml, /"addressLocality":"Oisterwijk"/);
  assert.match(regioHtml, /"addressRegion":"Noord-Brabant"/);
  assert.match(regioHtml, /"areaServed":\{"@type":"AdministrativeArea","name":"Tilburg"\}/);
  assert.match(regioHtml, /Terug naar regio/);
  assert.match(regioHtml, /Berkel-Enschot/);
  assert.match(regioHtml, /href="\/ai-automatisering"/);
  assert.match(regioHtml, /href="\/regio\/oisterwijk"/);
  assert.match(regioHtml, /href="\/crm-systeem-op-maat"/);
  assert.match(regioHtml, /href="\/branches\/zakelijke-dienstverleners"/);

  const oisterwijkHtml = buildSeoContentArticleHtml(getSeoContentItem('regio', 'oisterwijk'), {
    siteOrigin: 'https://www.softora.nl',
  });
  assert.match(oisterwijkHtml, /Moergestel/);
  assert.match(oisterwijkHtml, /href="\/crm-systeem-op-maat"/);
  assert.match(oisterwijkHtml, /href="\/regio\/tilburg"/);
});

test('current live seo content keeps weak pages supported by contextual incoming links', () => {
  const now = new Date('2026-05-27T12:00:00.000Z');
  const collectionPaths = getSeoContentCollectionPaths();
  const pages = [
    ...INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => ({
      path: entry.path,
      html: applyPublicSeoHeadDefaults(fs.readFileSync(path.join(repoRoot, entry.fileName), 'utf8'), entry.fileName, {
        siteOrigin: 'https://www.softora.nl',
      }),
    })),
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
  const contentArticlePaths = new Set(getSeoContentItems({ now }).map((item) => getSeoContentPathForItem(item)));
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
    if (!contentArticlePaths.has(page.path)) continue;
    assert.ok(incoming.get(page.path).size >= 2, `${page.path} heeft te weinig contextuele interne ingangen.`);
  }
});

test('seo linkmachine run date keeps fresh support articles above orphan risk', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const pages = [
    ...INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => ({
      path: entry.path,
      html: applyPublicSeoHeadDefaults(fs.readFileSync(path.join(repoRoot, entry.fileName), 'utf8'), entry.fileName, {
        siteOrigin: 'https://www.softora.nl',
      }),
    })),
    ...getSeoContentCollectionPaths().map((pathName) => ({
      path: pathName,
      html: buildSeoContentIndexHtml(pathName.replace(/^\//, ''), {
        siteOrigin: 'https://www.softora.nl',
        now,
      }),
    })),
    ...getSeoContentItems({ now }).map((item) => ({
      path: getSeoContentPathForItem(item),
      html: buildSeoContentArticleHtml(item, { siteOrigin: 'https://www.softora.nl' }),
    })),
  ];
  const publicPaths = new Set(pages.map((page) => page.path));
  const incoming = new Map(pages.map((page) => [page.path, new Set()]));

  for (const page of pages) {
    for (const href of extractInternalLinksFromHtml(page.html)) {
      if (href !== page.path && publicPaths.has(href)) incoming.get(href).add(page.path);
    }
  }

  for (const pathName of [
    '/blog/ai-telefonist-voor-afspraakintake',
    '/kennisbank/wat-is-interne-linkstructuur',
    '/kennisbank/wat-is-leadkwalificatie',
  ]) {
    assert.ok(incoming.get(pathName).size >= 3, `${pathName} heeft te weinig live contextuele ingangen.`);
  }

  const internalLinkStructure = pages.find((page) => page.path === '/kennisbank/wat-is-interne-linkstructuur');
  assert.ok(internalLinkStructure.html.includes('href="/bedrijfssoftware-op-maat"'));
  assert.ok(internalLinkStructure.html.includes('href="/crm-systeem-op-maat"'));
  assert.ok(internalLinkStructure.html.includes('href="/ai-automatisering"'));
  assert.ok(internalLinkStructure.html.includes('href="/website-laten-maken"'));
  assert.match(internalLinkStructure.html, /Controleer op orphan pages, doodlopende routes en overlap/);
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
    assert.ok(Array.isArray(item.faq), `${item.slug} mist een geldige FAQ-collectie.`);
    if (Number(item.qualityVersion) < 2) {
      assert.ok(item.faq.length >= 3, `${item.slug} mist FAQ-verdieping.`);
    }
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

test('interne-linkgids gebruikt native quality v2 zonder generieke opvulling', () => {
  const item = getSeoContentItem('kennisbank', 'wat-is-interne-linkstructuur', {
    now: new Date('2026-07-26T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-07-26');
  assert.ok(item.wordCount >= 850);
  assert.equal(item.faq.length, 0);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/wat-is-interne-linkstructuur">/);
  assert.match(html, /"dateModified":"2026-07-26"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat">bedrijfssoftware op maat<\/a>/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM op maat<\/a>/);
  assert.match(html, /href="\/ai-automatisering">AI-automatisering voor een controleerbare workflow<\/a>/);
  assert.doesNotMatch(html, /<section class="artikel-faq"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
});

test('CRM-integratiegids gebruikt een toetsbaar contract en twee verschillende beelden', () => {
  const item = getSeoContentItem('kennisbank', 'wat-is-een-crm-integratie', {
    now: new Date('2026-08-12T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-12');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/crm-systeem-op-maat');
  assert.ok(item.informationGain.includes('integratiecontract'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualFamily, 'technical-integration-patchbay-object-study');
  assert.equal(item.visualBrief.support.visualFamily, 'risograph-integration-recovery-loop');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/crm-integratie-patchpaneel-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/crm-integratie-foutafhandeling-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/wat-is-een-crm-integratie">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /"dateModified":"2026-08-12"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Ontwerp de foutwachtrij vóór de succesroute live gaat/);
  assert.match(html, /Wijs per gegeven één leidend systeem aan/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM-systeem op maat<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-crm-datakwaliteit">CRM-datakwaliteit<\/a>/);
  assert.match(html, /href="\/blog\/maatwerk-software-offerte-beoordelen">maatwerksoftware-offerte beoordeelt<\/a>/);
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
});

test('AI-leadkwalificatie gebruikt een bewijskaart, menselijke review en twee verschillende beelden', () => {
  const item = getSeoContentItem('blog', 'ai-automatisering-leadkwalificatie-mkb', {
    now: new Date('2026-08-14T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const followUpHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-automatisering-leadopvolging', {
      now: new Date('2026-08-14T12:00:00.000Z'),
    }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-14');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/ai-automatisering');
  assert.ok(item.informationGain.includes('harde uitsluitingen'));
  assert.ok(item.informationGain.includes('menselijke override'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualFamily, 'translucent-human-review-console');
  assert.equal(item.visualBrief.support.visualFamily, 'woven-evidence-gate-tapestry');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/ai-leadkwalificatie-menselijke-beslispoort-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/ai-leadkwalificatie-bewijsroute-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog\/ai-automatisering-leadkwalificatie-mkb">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /"dateModified":"2026-08-14"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Maak één bewijskaart per aanvraag/);
  assert.match(html, /Behandel ontbrekende informatie als eigen toestand/);
  assert.match(html, /href="\/ai-automatisering">AI automatisering<\/a>/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM-systeem op maat<\/a>/);
  assert.match(html, /href="\/blog\/ai-automatisering-leadopvolging">Leadopvolging<\/a>/);
  assert.match(html, /href="\/blog\/ai-automatisering-klantintake-mkb"/);
  assert.match(followUpHtml, /href="\/blog\/ai-automatisering-leadkwalificatie-mkb">criteria voor kwalificatie<\/a>/);
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
});

test('conversiegerichte-websitegids bewaakt de route tot bevestigde overdracht', () => {
  const item = getSeoContentItem('kennisbank', 'wat-is-een-conversiegerichte-website', {
    now: new Date('2026-08-15T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-15');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/website-laten-maken');
  assert.ok(item.informationGain.includes('vijfdelige routekaart'));
  assert.ok(item.informationGain.includes('leklogboek'));
  assert.ok(item.wordCount >= 1400);
  assert.equal(item.image.src, '/assets/seo-content/conversiegerichte-website-bewijsroute-softora.jpg');
  const imagePath = path.join(repoRoot, item.image.src.replace(/^\//, ''));
  assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
  assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/wat-is-een-conversiegerichte-website">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /"dateModified":"2026-08-15"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Leg per route vijf bewijspunten vast/);
  assert.match(html, /Een mooie bedankpagina zonder aantoonbare ontvangst is geen voltooide conversie/);
  assert.match(html, /href="\/website-laten-maken">website laten maken<\/a>/);
  assert.match(html, /href="\/blog\/website-laten-maken-kosten-2026">kostengids<\/a>/);
  assert.match(html, /href="\/vergelijkingen\/website-laten-maken-vs-zelf-maken">vergelijking tussen laten maken en zelf maken<\/a>/);
  assert.match(html, /href="\/blog\/website-leadgeneratie-mkb-meten"><span>Websiteleadgeneratie meten<\/span><\/a>/);
  assert.match(html, /href="\/blog\/website-offerte-vergelijken"><span>Website-offertes vergelijken<\/span><\/a>/);
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 0);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
});

test('chatbot-vs-livechat gebruikt quality v2 als unieke beslispagina', () => {
  const item = getSeoContentItem('vergelijkingen', 'chatbot-vs-livechat', {
    now: new Date('2026-08-07T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-07');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/chatbot-laten-maken');
  assert.ok(item.informationGain.includes('controleerbaar beslismodel'));
  assert.ok(item.wordCount >= 1400);
  assert.equal(item.faq.length, 0);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualFamily, 'documentary-routing-tabletop');
  assert.equal(item.image.src, '/assets/seo-content/chatbot-livechat-beslisroute-softora.jpg');
  assert.deepEqual(
    readJpegDimensions(path.join(repoRoot, item.image.src.replace(/^\//, ''))),
    { width: 1600, height: 1000 }
  );
  assert.ok(fs.statSync(path.join(repoRoot, item.image.src.replace(/^\//, ''))).size < 300 * 1024);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/vergelijkingen\/chatbot-vs-livechat">/);
  assert.match(html, /"dateModified":"2026-08-07"/);
  assert.match(html, /Gebruik acht criteria om ieder gesprekstype te kiezen/);
  assert.match(html, /Beslismatrix voor herkenbare klantvragen/);
  assert.match(html, /href="\/chatbot-laten-maken">chatbot laten maken<\/a>/);
  assert.match(html, /href="\/ai-automatisering">bredere AI-automatisering<\/a>/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM<\/a>/);
  assert.match(html, /href="\/blog\/chatbot-kosten-mkb"><span>Wat kost een chatbot\?<\/span><\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-chatbot-overdracht"><span>Wat is chatbot-overdracht\?<\/span><\/a>/);
  assert.doesNotMatch(html, /De beste oplossing is vaak combinatie/);
  assert.doesNotMatch(html, /<section class="artikel-faq"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
});

test('chatbot-CRM-koppeling gebruikt quality v2 met herstelroute en twee unieke beelden', () => {
  const item = getSeoContentItem('blog', 'chatbot-crm-koppeling-leads-opvolgen', {
    now: new Date('2026-08-09T12:00:00.000Z'),
  });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-09');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/chatbot-laten-maken');
  assert.ok(item.informationGain.includes('foutwachtrij'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.faq.length, 0);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualFamily, 'dark-operations-interface');
  assert.equal(item.visualBrief.support.visualFamily, 'cobalt-transit-system-map');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/chatbot-crm-handoff-interface-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/chatbot-crm-foutafhandeling-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog\/chatbot-crm-koppeling-leads-opvolgen">/);
  assert.match(html, /"dateModified":"2026-08-09"/);
  assert.match(html, /Ontwerp de foutwachtrij vóór de succesroute live gaat/);
  assert.match(html, /Wijs per gegeven één leidend systeem aan/);
  assert.match(html, /href="\/chatbot-laten-maken">chatbot laten maken<\/a>/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM-scope<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-crm-integratie">CRM-integratie<\/a>/);
  assert.match(html, /href="\/blog\/chatbot-kosten-mkb">kosten en koppelingen van de beoogde chatbot<\/a>/);
  assert.doesNotMatch(html, /<section class="artikel-faq"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);
});

test('chatbot-offertegids normaliseert voorstellen met bewijs en twee verschillende beelden', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const item = getSeoContentItem('blog', 'chatbot-offerte-vergelijken', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const chatbotPage = fs.readFileSync(path.join(repoRoot, 'premium-chatbot.html'), 'utf8');
  const costHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'chatbot-kosten-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.publishedAt, '2026-08-10');
  assert.equal(item.targetMoneyPage, '/chatbot-laten-maken');
  assert.ok(item.informationGain.includes('vier beslispoorten'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualFamily, 'forest-proposal-evidence-tabletop');
  assert.equal(item.visualBrief.support.visualFamily, 'yellow-screenprint-evidence-grid');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/chatbot-offerte-vergelijking-bewijsstukken-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/chatbot-offerte-beslismatrix-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog\/chatbot-offerte-vergelijken">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /"datePublished":"2026-08-10"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Gebruik vier beslispoorten in plaats van één totaalscore/);
  assert.match(html, /href="\/chatbot-laten-maken">chatbot laten maken<\/a>/);
  assert.match(html, /href="\/blog\/chatbot-crm-koppeling-leads-opvolgen">chatbot en CRM koppelen<\/a>/);
  assert.match(html, /href="\/vergelijkingen\/chatbot-vs-livechat">chatbot en livechat per gesprekstype<\/a>/);
  assert.match(costHtml, /href="\/blog\/chatbot-offerte-vergelijken">chatbot-offertes op dezelfde scope<\/a>/);
  assert.match(chatbotPage, /href="\/blog\/chatbot-offerte-vergelijken">chatbot-offertes naast dezelfde beslispoorten<\/a>/);
  assert.doesNotMatch(html, /beste leverancier|gegarandeerde besparing|foutloze werking/i);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/blog/chatbot-offerte-vergelijken');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/chatbot-offerte-vergelijking-bewijsstukken-softora.jpg',
    '/assets/seo-content/chatbot-offerte-beslismatrix-softora.jpg',
  ]);
});

test('CRM-adoptiegids maakt werkafspraken en herstel per rol controleerbaar', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const item = getSeoContentItem('blog', 'crm-adoptie-medewerkers-mkb', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const taskHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-taken-reminders-automatiseren-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const costHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-systeem-kosten-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.publishedAt, '2026-08-11');
  assert.equal(item.targetMoneyPage, '/crm-systeem-op-maat');
  assert.ok(item.informationGain.includes('vier terugvalsignalen'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualFamily, 'documentary-crm-role-rehearsal');
  assert.equal(item.visualBrief.support.visualFamily, 'paper-cut-adoption-feedback-loop');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/crm-adoptie-rollentest-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/crm-adoptie-feedbacklus-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog\/crm-adoptie-medewerkers-mkb">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /"datePublished":"2026-08-11"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Gebruik een feedbackwachtrij in plaats van directe scopegroei/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM-systeem op maat<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-crm-datakwaliteit">CRM-datakwaliteit<\/a>/);
  assert.match(html, /href="\/blog\/crm-taken-reminders-automatiseren-mkb">CRM-taken en reminders<\/a>/);
  assert.match(taskHtml, /href="\/blog\/crm-adoptie-medewerkers-mkb">CRM-adoptie per rol<\/a>/);
  assert.match(costHtml, /href="\/blog\/crm-adoptie-medewerkers-mkb">praktische CRM-adoptieroute<\/a>/);
  assert.doesNotMatch(html, /adoptiegarantie|garandeert adoptie|garandeert besparing|iedere medewerker zal/i);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/blog/crm-adoptie-medewerkers-mkb');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/crm-adoptie-rollentest-softora.jpg',
    '/assets/seo-content/crm-adoptie-feedbacklus-softora.jpg',
  ]);
});

test('AI-telefonist kostengids maakt belvolume, scope en menselijke controle vergelijkbaar', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');
  const item = getSeoContentItem('blog', 'ai-telefonist-kosten-mkb', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const comparisonHtml = buildSeoContentArticleHtml(
    getSeoContentItem('vergelijkingen', 'ai-telefonist-vs-receptionist', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const appointmentHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-telefonist-voor-afspraakintake', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.publishedAt, '2026-08-17');
  assert.equal(item.targetMoneyPage, '/ai-telefonist');
  assert.ok(item.informationGain.includes('drie volumescenario’s'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualType, 'object-study');
  assert.equal(item.visualBrief.hero.visualFamily, 'acoustic-telephony-testbench');
  assert.equal(item.visualBrief.support.visualType, 'architecture-diagram');
  assert.equal(item.visualBrief.support.visualFamily, 'charcoal-signal-cost-cutaway');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.sourceType, 'trainedAlgorithmicMedia');
  assert.equal(item.secondaryImage.sourceType, 'trainedAlgorithmicMedia');
  assert.equal(item.image.src, '/assets/seo-content/ai-telefonist-kosten-testbank-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/ai-telefonist-kosten-signaalpad-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/blog\/ai-telefonist-kosten-mkb">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:image:width" content="1600">/);
  assert.match(html, /<meta property="og:image:height" content="900">/);
  assert.match(html, /"datePublished":"2026-08-17"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Bereken gebruik met drie belvolumescenario’s/);
  assert.match(html, /href="\/ai-telefonist">AI telefonist laten maken<\/a>/);
  assert.match(html, /href="\/ai-automatisering">uitleg over AI automatisering<\/a>/);
  assert.match(html, /href="\/vergelijkingen\/ai-telefonist-vs-receptionist">vergelijking tussen AI telefonist en receptionist<\/a>/);
  assert.match(comparisonHtml, /href="\/blog\/ai-telefonist-kosten-mkb"><span>Kosten en scope van een AI telefonist<\/span><\/a>/);
  assert.match(appointmentHtml, /href="\/blog\/ai-telefonist-kosten-mkb"><span>Kosten van een AI telefonist<\/span><\/a>/);
  assert.doesNotMatch(html, /gegarandeerde bereikbaarheid|foutloze intake|garandeert besparing|volledig autonoom/i);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/blog/ai-telefonist-kosten-mkb');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/ai-telefonist-kosten-testbank-softora.jpg',
    '/assets/seo-content/ai-telefonist-kosten-signaalpad-softora.jpg',
  ]);
});

test('AI-telefonist definitiegids maakt techniek, taakgrens en menselijk herstel toetsbaar', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  const item = getSeoContentItem('kennisbank', 'wat-is-een-ai-telefonist', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const costHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-telefonist-kosten-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.publishedAt, '2026-05-20');
  assert.equal(item.updatedAt, '2026-08-22');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.growthEventAt, '2026-08-22');
  assert.equal(item.targetMoneyPage, '/ai-telefonist');
  assert.ok(item.informationGain.includes('zesveldige gesprekskaart'));
  assert.ok(item.sections.length >= 10);
  assert.equal(item.sources.length, 6);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/wat-is-een-ai-telefonist">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /"datePublished":"2026-05-20"/);
  assert.match(html, /"dateModified":"2026-08-22"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Vul vóór een demo een zesveldige gesprekskaart in/);
  assert.match(html, /href="\/ai-telefonist">AI telefonist laten maken<\/a>/);
  assert.match(html, /href="\/kennisbank\/ai-telefonist-crm-koppeling">AI telefonie koppelen aan CRM of agenda<\/a>/);
  assert.match(html, /href="\/blog\/ai-telefonie-menselijke-overdracht">gids over menselijke overdracht<\/a>/);
  assert.match(costHtml, /href="\/kennisbank\/wat-is-een-ai-telefonist">wat een AI telefonist precies is<\/a>/);
  assert.doesNotMatch(html, /altijd bereikbaar|foutloze gesprekken|volledig autonoom|garandeert afspraken|AVG-proof/i);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/kennisbank/wat-is-een-ai-telefonist');
  assert.equal(sitemapEntry.images.length, 1);
  assert.equal(sitemapEntry.images[0].loc, '/assets/seo-content/ai-klantcontact-chatbot-telefonie-softora.jpg');
});

test('AI-telefonist CRM-gids maakt events, duplicatecontrole en herstel toetsbaar', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const item = getSeoContentItem('kennisbank', 'ai-telefonist-crm-koppeling', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const appointmentHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-telefonist-voor-afspraakintake', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const costHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-telefonist-kosten-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.publishedAt, '2026-08-18');
  assert.equal(item.growthEventKind, 'new_url');
  assert.equal(item.targetMoneyPage, '/ai-telefonist');
  assert.ok(item.informationGain.includes('unieke gebeurtenissleutel'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualType, 'editorial-scene');
  assert.equal(item.visualBrief.hero.visualFamily, 'documentary-call-routing-workbench');
  assert.equal(item.visualBrief.support.visualType, 'process-diagram');
  assert.equal(item.visualBrief.support.visualFamily, 'swiss-stepped-recovery-signal-map');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.sourceType, 'trainedAlgorithmicMedia');
  assert.equal(item.secondaryImage.sourceType, 'trainedAlgorithmicMedia');
  assert.equal(item.image.src, '/assets/seo-content/ai-telefonist-crm-routering-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/ai-telefonist-crm-herstelroute-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  }
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/ai-telefonist-crm-koppeling">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:image:width" content="1600">/);
  assert.match(html, /<meta property="og:image:height" content="900">/);
  assert.match(html, /"datePublished":"2026-08-18"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Gebruik een unieke gebeurtenissleutel vóór je schrijft/);
  assert.match(html, /href="\/ai-telefonist">AI telefonist laten maken<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-crm-integratie">uitleg over een CRM-integratie<\/a>/);
  assert.match(html, /href="\/blog\/ai-telefonist-kosten-mkb">kostengids voor een AI telefonist<\/a>/);
  assert.match(appointmentHtml, /href="\/kennisbank\/ai-telefonist-crm-koppeling"><span>AI telefonist koppelen aan CRM of agenda<\/span><\/a>/);
  assert.match(costHtml, /href="\/kennisbank\/ai-telefonist-crm-koppeling">AI telefonist koppelen aan CRM of agenda<\/a>/);
  assert.doesNotMatch(html, /foutloze koppeling|volledig autonome route|gegarandeerde opvolging|altijd beschikbaar/i);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/kennisbank/ai-telefonist-crm-koppeling');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/ai-telefonist-crm-routering-softora.jpg',
    '/assets/seo-content/ai-telefonist-crm-herstelroute-softora.jpg',
  ]);
});

test('procesautomatiseringsgids maakt proceskaart, foutpad en acceptatiebewijs toetsbaar', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');
  const item = getSeoContentItem('kennisbank', 'wat-is-procesautomatisering', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const aiDefinitionHtml = buildSeoContentArticleHtml(
    getSeoContentItem('kennisbank', 'wat-is-ai-automatisering', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );
  const intakeHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'ai-automatisering-klantintake-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-20');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/ai-automatisering');
  assert.ok(item.informationGain.includes('negendelige proceskaart'));
  assert.ok(item.informationGain.includes('fout- en herstelroute'));
  assert.ok(item.wordCount >= 1300);
  assert.equal(item.faq.length, 0);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualType, 'object-study');
  assert.equal(item.visualBrief.hero.visualFamily, 'tactile-accordion-process-bench');
  assert.equal(item.visualBrief.support.visualType, 'process-diagram');
  assert.equal(item.visualBrief.support.visualFamily, 'swiss-yellow-exception-route');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/procesautomatisering-proceskaart-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/procesautomatisering-foutpad-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
    assert.equal(image.sourceType, 'trainedAlgorithmicMedia');
  }
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/wat-is-procesautomatisering">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:image:width" content="1600">/);
  assert.match(html, /<meta property="og:image:height" content="900">/);
  assert.match(html, /"datePublished":"2026-06-24"/);
  assert.match(html, /"dateModified":"2026-08-20"/);
  assert.match(html, /Vul een proceskaart met negen vaste velden/);
  assert.match(html, /Ontwerp de fout- en herstelroute vóór de succesroute live gaat/);
  assert.match(html, /href="\/ai-automatisering">AI automatisering<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-ai-workflow">een AI workflow<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-crm-integratie">gids over een CRM-integratie<\/a>/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat">bedrijfssoftware op maat<\/a>/);
  assert.match(aiDefinitionHtml, /href="\/kennisbank\/wat-is-procesautomatisering"><span>Wat is procesautomatisering\?<\/span><\/a>/);
  assert.match(intakeHtml, /href="\/kennisbank\/wat-is-procesautomatisering"><span>Wat is procesautomatisering\?<\/span><\/a>/);
  assert.doesNotMatch(html, /gegarandeerde tijdwinst|foutloze automatisering|volledig autonoom|altijd correct/i);
  assert.doesNotMatch(html, /<section class="artikel-faq"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/kennisbank/wat-is-procesautomatisering');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/procesautomatisering-proceskaart-softora.jpg',
    '/assets/seo-content/procesautomatisering-foutpad-softora.jpg',
  ]);
});

test('klantportaalgids maakt taken, rechten en uitzonderingen toetsbaar', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');
  const item = getSeoContentItem('kennisbank', 'wat-is-een-klantportaal', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const crmHtml = fs.readFileSync(path.join(repoRoot, 'crm-systeem-op-maat.html'), 'utf8');

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-21');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/bedrijfssoftware-op-maat');
  assert.ok(item.informationGain.includes('zesveldige portaalkaart'));
  assert.ok(item.informationGain.includes('acceptatiescenario'));
  assert.ok(item.wordCount >= 1400);
  assert.equal(item.faq.length, 0);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.visualBrief.hero.visualType, 'documentary-process');
  assert.equal(item.visualBrief.hero.visualFamily, 'documentary-access-rights-workbench');
  assert.equal(item.visualBrief.support.visualType, 'architecture-diagram');
  assert.equal(item.visualBrief.support.visualFamily, 'vermilion-bauhaus-permission-route');
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  assert.equal(item.image.src, '/assets/seo-content/klantportaal-rechtenwerktafel-softora.jpg');
  assert.equal(item.secondaryImage.src, '/assets/seo-content/klantportaal-toegangsflow-controle-softora.jpg');
  for (const image of [item.image, item.secondaryImage]) {
    const imagePath = path.join(repoRoot, image.src.replace(/^\//, ''));
    assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
    assert.ok(fs.statSync(imagePath).size < 300 * 1024);
    assert.equal(image.sourceType, 'trainedAlgorithmicMedia');
  }
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/kennisbank\/wat-is-een-klantportaal">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:image:width" content="1600">/);
  assert.match(html, /<meta property="og:image:height" content="900">/);
  assert.match(html, /"datePublished":"2026-06-19"/);
  assert.match(html, /"dateModified":"2026-08-21"/);
  assert.match(html, /Vul voor iedere portaaltaak zes velden in/);
  assert.match(html, /Bouw een menselijke uitzonderingsroute die echt uitvoerbaar is/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat">bedrijfssoftware<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-crm-integratie">gids over een CRM-integratie<\/a>/);
  assert.match(html, /href="\/maatwerk-platform">maatwerk platform<\/a>/);
  assert.match(crmHtml, /href="\/kennisbank\/wat-is-een-klantportaal">wat is een klantportaal\?<\/a>/);
  assert.doesNotMatch(html, /is absoluut veilig|is AVG-proof|garandeert tijdwinst|heeft een vaste doorlooptijd/i);
  assert.doesNotMatch(html, /<section class="artikel-faq"/);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/kennisbank/wat-is-een-klantportaal');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/klantportaal-rechtenwerktafel-softora.jpg',
    '/assets/seo-content/klantportaal-toegangsflow-controle-softora.jpg',
  ]);
});

test('adviesbureauspagina maakt projectstart en overdracht controleerbaar', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  const item = getSeoContentItem('branches', 'adviesbureaus', { now });
  const html = buildSeoContentArticleHtml(item, {
    siteOrigin: 'https://www.softora.nl',
  });
  const taskHtml = buildSeoContentArticleHtml(
    getSeoContentItem('blog', 'crm-taken-reminders-automatiseren-mkb', { now }),
    { siteOrigin: 'https://www.softora.nl' }
  );

  assert.equal(item.qualityVersion, 2);
  assert.equal(item.updatedAt, '2026-08-16');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.targetMoneyPage, '/crm-systeem-op-maat');
  assert.ok(item.informationGain.includes('vijf beslispoorten'));
  assert.ok(item.wordCount >= 1500);
  assert.equal(item.image.sourceType, 'trainedAlgorithmicMedia');
  assert.equal(item.image.src, '/assets/seo-content/adviesbureau-projectstart-bewijsroute-softora.jpg');

  const imagePath = path.join(repoRoot, item.image.src.replace(/^\//, ''));
  assert.deepEqual(readJpegDimensions(imagePath), { width: 1600, height: 900 });
  assert.ok(fs.statSync(imagePath).size < 300 * 1024);
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 0);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/branches\/adviesbureaus">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:image:width" content="1600">/);
  assert.match(html, /<meta property="og:image:height" content="900">/);
  assert.match(html, /"@type":"Service"/);
  assert.match(html, /"@type":"ImageObject","contentUrl":"https:\/\/www\.softora\.nl\/assets\/seo-content\/adviesbureau-projectstart-bewijsroute-softora\.jpg"/);
  assert.match(html, /"datePublished":"2026-06-29"/);
  assert.match(html, /"dateModified":"2026-08-16"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /Gebruik een projectstartbewijs in plaats van alleen een leadstatus/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM-systeem op maat<\/a>/);
  assert.match(html, /href="\/website-laten-maken">website laten maken<\/a>/);
  assert.match(html, /href="\/ai-automatisering">AI automatisering<\/a>/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-crm-integratie">CRM-integratie<\/a>/);
  assert.match(taskHtml, /href="\/branches\/adviesbureaus">projectstart en overdracht voor adviesbureaus<\/a>/);
  assert.doesNotMatch(html, /garandeert omzet|garandeert tijdwinst|wij leveren foutloos|AI beslist zelfstandig/i);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert/);

  const sitemapEntry = getSeoContentSitemapEntries({ now })
    .find((entry) => entry.path === '/branches/adviesbureaus');
  assert.deepEqual(sitemapEntry.images.map((image) => image.loc), [
    '/assets/seo-content/adviesbureau-projectstart-bewijsroute-softora.jpg',
  ]);
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

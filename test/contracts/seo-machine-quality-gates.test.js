const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
} = require('../../server/services/public-seo');
const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentClusterForItem,
  getSeoContentClusters,
  getSeoContentCollectionPaths,
  getSeoContentItems,
  getSeoContentPathForItem,
} = require('../../server/services/seo-content');
const {
  auditContentQuality,
  auditConversionCtas,
  auditLinkGraph,
  auditSeoImages,
  buildSeoLinkGraph,
} = require('../../server/services/seo-machine-quality-gates');

const repoRoot = path.resolve(__dirname, '../..');
const siteOrigin = 'https://www.softora.nl';
const seoMachineNow = new Date('2026-06-10T12:00:00.000Z');

function renderStaticPublicPages() {
  return INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => {
    const filePath = path.join(repoRoot, entry.fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    return {
      path: entry.path,
      kind: entry.kind,
      html: applyPublicSeoHeadDefaults(source, entry.fileName, { siteOrigin }),
    };
  });
}

function renderSeoContentPages() {
  return [
    ...getSeoContentCollectionPaths().map((pathName) => {
      const collection = pathName.replace(/^\//, '');
      return {
        path: pathName,
        kind: 'content-index',
        html: buildSeoContentIndexHtml(collection, { siteOrigin, now: seoMachineNow }),
      };
    }),
    ...getSeoContentItems({ now: seoMachineNow }).map((item) => ({
      path: getSeoContentPathForItem(item),
      kind: 'content-article',
      html: buildSeoContentArticleHtml(item, { siteOrigin }),
    })),
  ];
}

test('seo machine contentkwaliteit blijft sterk genoeg om automatisch door te groeien', () => {
  const items = getSeoContentItems({ now: seoMachineNow }).map((item) => ({
    ...item,
    cluster: getSeoContentClusterForItem(item).key,
  }));
  const issues = auditContentQuality({
    items,
    clusters: getSeoContentClusters(),
  });

  assert.deepEqual(issues, []);
});

test('seo machine houdt money pages ondersteund met interne links', () => {
  const pages = [...renderStaticPublicPages(), ...renderSeoContentPages()];
  const graph = buildSeoLinkGraph(pages);
  const issues = auditLinkGraph({ graph });

  assert.deepEqual(issues, []);
});

test('publieke SEO-pagina CTAs zijn meetbaar zonder homepage content aan te raken', () => {
  const pages = renderStaticPublicPages();
  const conversionPages = pages.filter((page) => !['home', 'legal'].includes(page.kind));
  const issues = auditConversionCtas({ pages: conversionPages });
  const diensten = pages.find((page) => page.path === '/diensten');
  const homepage = pages.find((page) => page.path === '/');

  assert.deepEqual(issues, []);
  assert.match(diensten.html, /data-softora-conversion="public-cta"/);
  assert.match(diensten.html, /data-softora-conversion-page="\/diensten"/);
  assert.doesNotMatch(homepage.html, /data-softora-conversion-page="\/"/);
});

test('SEO-content CTAs zijn meetbaar en linken terug naar commerciële pagina’s', () => {
  const item = getSeoContentItems({ now: seoMachineNow }).find(
    (contentItem) => contentItem.slug === 'ai-automatisering-mkb-waar-beginnen'
  );
  const html = buildSeoContentArticleHtml(item, { siteOrigin });

  assert.match(html, /data-softora-conversion="content-primary"/);
  assert.match(html, /data-softora-conversion="content-contact"/);
  assert.match(html, /data-softora-conversion-page="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(html, /data-softora-conversion-target="service"/);
  assert.match(html, /data-softora-conversion-target="contact"/);
  assert.match(html, /href="\/pakketten">Pakketten<\/a>/);
});

test('SEO-content pagina’s gebruiken echte afbeeldingen met alt-tekst en sterke bestandsnamen', () => {
  const pages = renderSeoContentPages();
  const issues = auditSeoImages({ pages });
  const article = pages.find((page) => page.path === '/blog/ai-automatisering-mkb-waar-beginnen');

  assert.deepEqual(issues, []);
  assert.match(article.html, /<img src="\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg"/);
  assert.doesNotMatch(article.html, /<div class="artikel-img">[^<]+<\/div>/);
});

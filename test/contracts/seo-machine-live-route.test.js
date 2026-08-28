const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectXmlLocations,
  runSeoMachineLiveRouteCheck,
} = require('../../server/services/seo-machine-live-route');

const LIVE_COMMIT = 'a'.repeat(40);
const URL = 'https://www.softora.nl/blog/test-route';
const HERO = '/assets/seo-content/test-route-hero.jpg';
const SUPPORT = '/assets/seo-content/test-route-support.jpg';

function buildHtml(overrides = {}) {
  const canonical = overrides.canonical || URL;
  const robots = overrides.robots || 'index, follow, max-image-preview:large';
  const whatsapp = overrides.whatsapp || 'https://wa.me/31643262792';
  return `<!doctype html>
    <html><head>
      <title>Test route | Softora</title>
      <meta name="description" content="Een controleerbare testpagina.">
      <meta name="robots" content="${robots}">
      <meta property="og:image" content="https://www.softora.nl${HERO}">
      <meta property="og:image:width" content="1600">
      <meta property="og:image:height" content="900">
      <link rel="canonical" href="${canonical}">
      <script type="application/ld+json">${JSON.stringify({
    '@type': 'Article',
    image: [{ '@type': 'ImageObject', contentUrl: `https://www.softora.nl${HERO}`, width: 1600, height: 900 }],
  })}</script>
    </head><body>
      <h1>Test route</h1>
      <img src="${HERO}" alt="Hero met proces" width="1600" height="900">
      <img src="${SUPPORT}" alt="Beslismatrix" width="1200" height="900">
      <a href="/chatbot-laten-maken">Chatbot laten maken</a>
      <a href="${whatsapp}">Contact</a>
    </body></html>`;
}

function buildSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>${URL}</loc><image:image><image:loc>https://www.softora.nl${HERO}</image:loc></image:image>
      <image:image><image:loc>https://www.softora.nl${SUPPORT}</image:loc></image:image></url>
    </urlset>`;
}

function makeFetch({ html = buildHtml(), sitemap = buildSitemap(), healthCommit = LIVE_COMMIT } = {}) {
  return async (url) => {
    const value = String(url);
    if (value.endsWith('/api/healthz')) {
      return new Response(JSON.stringify({ deployment: { commitSha: healthCommit } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (value.endsWith('/sitemap.xml')) {
      return new Response(sitemap, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    if (value === URL) return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    if (value.endsWith(HERO) || value.endsWith(SUPPORT)) {
      return new Response('image', { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('missing', { status: 404 });
  };
}

const contentItems = [{
  collection: 'blog',
  slug: 'test-route',
  publishedAt: '2026-08-28',
  visualQualityVersion: 2,
  targetMoneyPage: '/chatbot-laten-maken',
  image: { src: HERO, alt: 'Hero met proces', width: 1600, height: 900 },
  secondaryImage: { src: SUPPORT, alt: 'Beslismatrix', width: 1200, height: 900 },
}];

test('live route gate proves commit, crawlability, schema, CTA and both content images', async () => {
  const result = await runSeoMachineLiveRouteCheck({
    url: URL,
    liveCommit: LIVE_COMMIT,
    fetchImpl: makeFetch(),
    contentItems,
  });

  assert.equal(result.status, 'ready', result.errors.join('\n'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.liveCommit, LIVE_COMMIT);
  assert.equal(result.summary.checkedImages, 2);
  assert.equal(result.summary.sitemap, true);
});

test('live route gate blocks canonical, robots, CTA and deployment mismatches', async () => {
  const result = await runSeoMachineLiveRouteCheck({
    url: URL,
    liveCommit: LIVE_COMMIT,
    fetchImpl: makeFetch({
      html: buildHtml({
        canonical: 'https://www.softora.nl/blog/ander-pad',
        robots: 'noindex, follow',
        whatsapp: 'https://wa.me/31643262792?text=Hallo',
      }),
      healthCommit: 'b'.repeat(40),
    }),
    contentItems,
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /healthz commit/);
  assert.match(result.errors.join(' '), /canonical/);
  assert.match(result.errors.join(' '), /robotsmeta/);
  assert.match(result.errors.join(' '), /WhatsApp-link/);
});

test('live route gate blocks weak hero search-preview and schema evidence', async () => {
  const html = buildHtml()
    .replace('property="og:image:width" content="1600"', 'property="og:image:width" content="1500"')
    .replace('"@type":"ImageObject"', '"@type":"Thing"')
    .replace('alt="Hero met proces"', 'alt="Ander beeld"');
  const result = await runSeoMachineLiveRouteCheck({
    url: URL,
    liveCommit: LIVE_COMMIT,
    fetchImpl: makeFetch({ html }),
    contentItems,
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /visual-alt wijkt af/);
  assert.match(result.errors.join(' '), /ImageObject/);
  assert.match(result.errors.join(' '), /og:image-dimensies/);
});

test('live route gate accepts one proven visual for a non-blog Quality V2 refresh', async () => {
  const html = buildHtml().replace(
    `      <img src="${SUPPORT}" alt="Beslismatrix" width="1200" height="900">\n`,
    ''
  );
  const result = await runSeoMachineLiveRouteCheck({
    url: URL.replace('/blog/', '/kennisbank/'),
    liveCommit: LIVE_COMMIT,
    fetchImpl: async (url) => {
      const requested = String(url);
      if (requested === URL.replace('/blog/', '/kennisbank/')) {
        return new Response(html.replaceAll(URL, URL.replace('/blog/', '/kennisbank/')), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return makeFetch({
        sitemap: buildSitemap().replaceAll(URL, URL.replace('/blog/', '/kennisbank/')),
      })(url);
    },
    contentItems: [{
      collection: 'kennisbank',
      slug: 'test-route',
      qualityVersion: 2,
      growthEventKind: 'substantial_refresh',
      growthEventAt: '2026-08-28',
      targetMoneyPage: '/chatbot-laten-maken',
      image: { src: HERO, alt: 'Hero met proces', width: 1600, height: 900 },
    }],
  });

  assert.equal(result.status, 'ready', result.errors.join('\n'));
  assert.equal(result.summary.checkedImages, 1);
});

test('sitemap parser includes page and namespaced image locations', () => {
  assert.deepEqual(collectXmlLocations(buildSitemap()), [
    URL,
    `https://www.softora.nl${HERO}`,
    `https://www.softora.nl${SUPPORT}`,
  ]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const SEO_GROWTH_CSS_VERSION = '20260528a';
const LOW_TRUST_PUBLIC_IMAGE_PATTERN = /\/assets\/(?:home-service-[^"']*-ai|home-over-office-meeting-ai|home-hero-generated-v2|softora-office-digital-growth)\.jpg/i;
const { INDEXABLE_PUBLIC_SEO_PAGES, applyPublicSeoHeadDefaults } = require('../../server/services/public-seo');
const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentCollectionPaths,
  getSeoContentItems,
} = require('../../server/services/seo-content');

function readFile(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8');
}

function getSeoGrowthPages() {
  return fs
    .readdirSync(root)
    .filter((fileName) => fileName.endsWith('.html'))
    .filter((fileName) => readFile(fileName).includes('/assets/seo-growth-pages.css'));
}

function getImgTags(source) {
  return Array.from(source.matchAll(/<img\b[^>]*>/gi), (match) => match[0]);
}

test('seo-growth pages use the current shared design stylesheet', () => {
  const pages = getSeoGrowthPages();

  assert.ok(pages.includes('diensten.html'), 'diensten.html moet onder de gedeelde designbewaking vallen');
  assert.ok(pages.length >= 5, 'verwacht meerdere seo-growth pagina’s onder dezelfde template');

  for (const fileName of pages) {
    const source = readFile(fileName);
    assert.match(
      source,
      new RegExp(`/assets/seo-growth-pages\\.css\\?v=${SEO_GROWTH_CSS_VERSION}`),
      `${fileName} gebruikt niet de actuele seo-growth stylesheet`
    );
  }
});

test('seo-growth hero keeps titles broad and hero secondary CTAs visible', () => {
  const css = readFile('assets/seo-growth-pages.css');

  assert.match(
    css,
    /\.seo-growth-hero-content\s*\{[\s\S]*width:\s*min\(1120px,\s*calc\(100% - 40px\)\);/s,
    'hero content mag niet opnieuw als te smalle tekstkolom eindigen'
  );
  assert.match(
    css,
    /\.seo-growth-hero h1\s*\{[\s\S]*max-width:\s*1040px;[\s\S]*font-size:\s*clamp\(48px,\s*7\.2vw,\s*96px\);/s,
    'hero H1 moet breed genoeg blijven voor korte, krachtige regels'
  );
  assert.match(
    css,
    /\.seo-growth-hero \.seo-growth-button\.secondary\s*\{[\s\S]*background:\s*rgba\(255,255,255,\.1\);[\s\S]*color:\s*#fff;[\s\S]*border-color:\s*rgba\(255,255,255,\.34\);/s,
    'hero secondary CTA moet op donkere beelden zichtbaar zijn'
  );
  assert.match(
    css,
    /\.seo-growth-hero \.seo-growth-button\.secondary:hover\s*\{[\s\S]*background:\s*rgba\(255,255,255,\.18\);[\s\S]*color:\s*#fff;/s,
    'hero secondary CTA moet ook bij hover zichtbaar blijven'
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*\.seo-growth-hero-content\s*\{[\s\S]*width:\s*100%;/s,
    'mobiele hero content moet de volle breedte benutten tegen onnodige titelbreuken'
  );
  assert.match(
    css,
    /@media \(max-width:\s*520px\)\s*\{[\s\S]*\.seo-growth-hero h1\s*\{[\s\S]*font-size:\s*clamp\(42px,\s*11vw,\s*48px\);[\s\S]*line-height:\s*1;/s,
    'mobiele hero H1 moet compacter worden voordat titels in vijf regels vallen'
  );
});

test('seo-growth action links are rendered as real buttons', () => {
  const pages = getSeoGrowthPages();

  for (const fileName of pages) {
    const source = readFile(fileName);
    const actionBlocks = [...source.matchAll(/<div class="seo-growth-actions">([\s\S]*?)<\/div>/g)];

    assert.ok(actionBlocks.length > 0, `${fileName} heeft geen zichtbare actieknoppen in de template`);

    for (const [, block] of actionBlocks) {
      const anchors = [...block.matchAll(/<a\s+[^>]*>/g)].map((match) => match[0]);
      assert.ok(anchors.length > 0, `${fileName} heeft een actieblok zonder link`);

      for (const anchor of anchors) {
        assert.match(
          anchor,
          /\bclass="[^"]*\bseo-growth-button\b[^"]*"/,
          `${fileName} bevat een actie-link die niet als knop is opgemaakt: ${anchor}`
        );
      }
    }
  }
});

test('seo-growth template images use trustworthy filenames and stable dimensions', () => {
  const pages = getSeoGrowthPages();

  for (const fileName of pages) {
    const source = readFile(fileName);
    const imgTags = getImgTags(source);

    assert.ok(imgTags.length > 0, `${fileName} moet echte publieke beelden tonen`);

    for (const tag of imgTags) {
      assert.doesNotMatch(
        tag,
        /home-hero-generated-v2|home-over-office-meeting-ai|home-service-[^"']*-ai|softora-office-digital-growth/i,
        `${fileName} gebruikt een zwakke AI/generated publieke beeldnaam: ${tag}`
      );
      assert.match(tag, /\balt="[^"]{18,}"/, `${fileName} mist betekenisvolle alt-tekst: ${tag}`);
      assert.match(tag, /\bwidth="\d+"/, `${fileName} mist vaste image width: ${tag}`);
      assert.match(tag, /\bheight="\d+"/, `${fileName} mist vaste image height: ${tag}`);
    }
  }
});

test('indexable public SEO pages avoid low-trust generated-looking image filenames', () => {
  const pages = INDEXABLE_PUBLIC_SEO_PAGES
    .filter((entry) => entry.kind !== 'home')
    .map((entry) => entry.fileName);

  for (const fileName of pages) {
    const source = readFile(fileName);
    assert.doesNotMatch(
      source,
      LOW_TRUST_PUBLIC_IMAGE_PATTERN,
      `${fileName} gebruikt een zwakke AI/generated publieke beeldnaam`
    );
  }
});

test('rendered public SEO metadata avoids low-trust generated-looking images', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const renderedPages = [
    ...INDEXABLE_PUBLIC_SEO_PAGES
      .filter((entry) => entry.kind !== 'home')
      .map((entry) => ({
        label: entry.path,
        html: applyPublicSeoHeadDefaults(readFile(entry.fileName), entry.fileName, {
          siteOrigin: 'https://www.softora.nl',
        }),
      })),
    ...getSeoContentCollectionPaths().map((collectionPath) => ({
      label: collectionPath,
      html: buildSeoContentIndexHtml(collectionPath.replace(/^\//, ''), {
        siteOrigin: 'https://www.softora.nl',
        now,
      }),
    })),
    ...getSeoContentItems({ now }).map((item) => ({
      label: `${item.collection}/${item.slug}`,
      html: buildSeoContentArticleHtml(item, {
        siteOrigin: 'https://www.softora.nl',
      }),
    })),
  ];

  for (const page of renderedPages) {
    assert.doesNotMatch(
      page.html,
      LOW_TRUST_PUBLIC_IMAGE_PATTERN,
      `${page.label} rendert een zwakke AI/generated publieke metadata-afbeelding`
    );
  }
});

test('ai automation money page uses the realistic workflow image across hero and social metadata', () => {
  const source = readFile('ai-automatisering.html');

  assert.match(
    source,
    /<meta property="og:image" content="https:\/\/www\.softora\.nl\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg">/
  );
  assert.match(
    source,
    /<meta name="twitter:image" content="https:\/\/www\.softora\.nl\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg">/
  );
  assert.match(
    source,
    /<img class="seo-growth-hero-image" src="\/assets\/seo-content\/ai-automatisering-workflow-softora\.jpg\?v=20260605a" alt="Overleg aan tafel over AI automatisering, workflow en leadopvolging voor het MKB\." width="1600" height="1000" loading="eager" fetchpriority="high" decoding="async">/
  );
  assert.doesNotMatch(
    source,
    /softora-strategy-meeting\.jpg/,
    'AI automatisering mag niet terugvallen naar het geconstrueerde Softora-kantoorbeeld'
  );
});

test('legacy public hero line breaks keep readable text spacing', () => {
  const pages = [
    'premium-websites.html',
    'website-laten-maken-oisterwijk.html',
    'premium-bedrijfssoftware.html',
    'premium-chatbot.html',
    'premium-voicesoftware.html',
  ];

  for (const fileName of pages) {
    const source = readFile(fileName);
    const h1 = source.match(/<h1 class="hero-title">([\s\S]*?)<\/h1>/)?.[1] || '';
    const text = h1
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    assert.doesNotMatch(
      text,
      /website(?:voor|in)|maatvoor|chatbotdie|voicesoftwaredie/i,
      `${fileName} hero-kop plakt woorden tegen elkaar`
    );
  }
});

test('legacy public service heroes use route-relevant realistic assets', () => {
  const bedrijfssoftware = readFile('premium-bedrijfssoftware.html');
  const voicesoftware = readFile('premium-voicesoftware.html');
  const legacyHeroBackground = /\.hero::before\s*\{[\s\S]*?background:\s*url\('([^']+)'\)[^;]*;/;

  assert.match(
    bedrijfssoftware,
    /\.hero::before\s*\{[\s\S]*background:\s*url\('\/assets\/softora-crm-workflow\.jpg'\) center center \/ cover no-repeat;/s,
    'Bedrijfssoftware hero moet een concrete CRM/workflow-foto gebruiken in plaats van een generiek dashboard'
  );
  assert.match(
    voicesoftware,
    /\.hero::before\s*\{[\s\S]*background:\s*url\('\/assets\/softora-telefonie-studio\.jpg'\) center center \/ cover no-repeat;/s,
    'Voicesoftware hero moet een voice/telefonie-foto gebruiken in plaats van een generiek dashboard'
  );
  assert.notStrictEqual(
    bedrijfssoftware.match(legacyHeroBackground)?.[1],
    voicesoftware.match(legacyHeroBackground)?.[1],
    'Oudere servicepagina’s mogen niet opnieuw dezelfde generieke hero-foto delen'
  );
});

test('seo-growth mobile navigation keeps the contact CTA in the visible flow', () => {
  const css = readFile('assets/seo-growth-pages.css');

  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*\.seo-growth-nav-links\s*\{[\s\S]*width:\s*100%;[\s\S]*flex-wrap:\s*wrap;[\s\S]*overflow-x:\s*visible;[\s\S]*padding-bottom:\s*0;/s,
    'mobiele seo-growth navigatie mag de contact CTA niet buiten beeld duwen'
  );
});

test('seo content mobile navigation keeps public route links in visible flow', () => {
  const css = readFile('assets/seo-content.css');

  assert.match(
    css,
    /@media \(max-width:\s*980px\)\s*\{[\s\S]*\.nav-links\s*\{(?=[\s\S]*?width:\s*100%;)(?=[\s\S]*?flex-wrap:\s*wrap;)(?=[\s\S]*?justify-content:\s*flex-start;)[\s\S]*?\}/s,
    'mobiele contentnavigatie mag geen losse rechts zwevende route overhouden'
  );
  assert.match(
    css,
    /@media \(max-width:\s*980px\)\s*\{[\s\S]*\.filter-bar\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*overflow-x:\s*visible;[\s\S]*padding-bottom:\s*20px;/s,
    'mobiele contentfilters moeten zichtbaar wrappen in plaats van route-links te verbergen'
  );
  assert.match(
    css,
    /@media \(max-width:\s*980px\)\s*\{[\s\S]*\.filter-tab\s*\{[\s\S]*border:\s*1px solid var\(--border\);[\s\S]*border-radius:\s*999px;/s,
    'mobiele contentfilters moeten als duidelijke tabs/chips herkenbaar blijven'
  );
});

test('seo content conversion CTA labels can wrap without mobile overflow', () => {
  const css = readFile('assets/seo-content.css');

  assert.match(
    css,
    /\.content-cta-actions\s*\{[\s\S]*min-width:\s*0;/s,
    'content CTA actions moeten als flex-container kunnen krimpen op mobiel'
  );
  assert.match(
    css,
    /\.content-cta-primary,\s*\.content-cta-secondary\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*flex:\s*0 1 auto;[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*white-space:\s*normal;/s,
    'lange content CTA labels moeten kunnen afbreken in plaats van horizontale druk te maken'
  );
  assert.doesNotMatch(
    css.match(/\.content-cta-primary,\s*\.content-cta-secondary\s*\{[\s\S]*?\}/)?.[0] || '',
    /white-space:\s*nowrap;/,
    'content CTA knoppen mogen niet terug naar nowrap'
  );
});

test('diensten hero keeps the secondary insight CTA in the button system', () => {
  const source = readFile('diensten.html');

  assert.match(
    source,
    /<a class="seo-growth-button secondary" href="\/blog">Bekijk inzichten<\/a>/,
    'Bekijk inzichten moet een zichtbare secundaire knop blijven'
  );
});

test('over softora page keeps headline, quote and CTA layout polished', () => {
  const source = readFile('premium-over-softora.html');

  assert.match(
    source,
    /\/assets\/seo-growth-pages\.css\?v=20260528a/,
    'Over Softora moet de gedeelde SEO-growth template blijven gebruiken'
  );
  assert.doesNotMatch(
    source.match(/<h1>[\s\S]*?<\/h1>/)?.[0] || '',
    /<br>/,
    'Over Softora H1 moet breed kunnen ademen'
  );
  assert.match(
    source,
    /<section class="seo-growth-hero">[\s\S]*softora-strategy-meeting\.jpg[\s\S]*width="1536" height="1024"/s,
    'Over Softora moet een echte hero-foto tonen binnen de template'
  );
  assert.match(
    source,
    /<a class="seo-growth-card over-image-card" href="\/website-laten-maken">[\s\S]*softora-website-wireframes\.jpg[\s\S]*width="1122" height="1402"/s,
    'Websiteblok op Over Softora moet een foto houden'
  );
  assert.match(
    source,
    /<a class="seo-growth-card over-image-card" href="\/bedrijfssoftware-op-maat">[\s\S]*softora-crm-workflow\.jpg[\s\S]*width="1122" height="1402"/s,
    'Softwareblok op Over Softora moet een foto houden'
  );
  assert.match(
    source,
    /<a class="seo-growth-card over-image-card" href="\/ai-automatisering">[\s\S]*softora-chatbot-klantcontact\.jpg[\s\S]*width="1122" height="1402"/s,
    'AI-blok op Over Softora moet een foto houden'
  );
  assert.match(
    source,
    /Martijn van de Ven/,
    'Over Softora mag niet opnieuw de echte eigenaar publiek als quotepersoon tonen'
  );
  assert.doesNotMatch(
    source,
    /Serv[eé]\s+Creusen/i,
    'Servé mag voorlopig niet aan de voorkant van deze pagina terugkomen'
  );
  assert.doesNotMatch(source, /class="big-title"|class="intro"|class="quote-wrap"/);
});

test('maatwerk platform hero stays immediately visible and on-brand on mobile', () => {
  const source = readFile('maatwerk-platform.html');

  assert.match(
    source,
    /<link rel="stylesheet" href="\/assets\/fonts\.css\?v=20260409a">/,
    'maatwerk-platform moet de lokale Softora fonts gebruiken'
  );
  assert.doesNotMatch(source, /fonts\.googleapis|fonts\.gstatic/i, 'publieke maatwerkpagina mag geen losse Google font template houden');
  assert.match(source, /--accent-color:\s*#8b2252;/, 'maatwerk-platform moet de Softora accentkleur gebruiken');
  assert.doesNotMatch(source, /#4a5fd7|#3d4eb8|#7b8ef8|74,\s*95,\s*215/i, 'oude blauwe one-off accenten mogen niet terugkomen');
  assert.doesNotMatch(source, /cursor:\s*none;/i, 'publieke links en knoppen mogen geen verborgen cursor afdwingen');
  assert.doesNotMatch(source, /ambient-blob|blob-1/i, 'publieke maatwerkpagina mag geen losse gradient-blob decoratie houden');
  assert.match(
    source,
    /\.hero \.eyebrow,\s*\.hero h1,\s*\.hero p,\s*\.hero-buttons\s*\{[\s\S]*opacity:\s*1;[\s\S]*transform:\s*none;[\s\S]*animation:\s*none;/s,
    'boven-de-vouw hero-copy mag niet eerst onzichtbaar animeren'
  );
  assert.match(
    source,
    /@media \(max-width:\s*768px\)\s*\{[\s\S]*\.hero-buttons\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*max-width:\s*320px;[\s\S]*\.hero-buttons \.magnetic-btn\s*\{[\s\S]*width:\s*100%;/s,
    'mobiele hero-knoppen moeten leesbaar stapelen zonder woordbreuken'
  );
});

test('design protocol protects the homepage and public templates', () => {
  const source = readFile('docs/public-design-quality.md');

  assert.match(source, /Homepage-inhoud en homepage-layout blijven met rust/i);
  assert.match(source, /Bestaande templates en secties zijn leidend/i);
  assert.match(source, /CTA/i);
  assert.match(source, /contrast/i);
  assert.match(source, /geen losse SEO-blokken/i);
});

test('rendered public SEO content avoids internal planning language', () => {
  const forbiddenPublicCopy = /komt later|SEO-machine|contentlaag krijgt straks|volgende contentblokken|verder lezen per onderwerp|foto volgt later/i;
  const now = new Date('2026-05-28T12:00:00.000Z');
  const collectionPaths = getSeoContentCollectionPaths();
  const pages = [
    ...collectionPaths.map((collectionPath) => ({
      label: collectionPath,
      html: buildSeoContentIndexHtml(collectionPath.replace(/^\//, ''), { now }),
    })),
    ...getSeoContentItems({ now }).map((item) => ({
      label: `${item.collection}/${item.slug}`,
      html: buildSeoContentArticleHtml(item),
    })),
  ];

  assert.ok(pages.length > collectionPaths.length, 'verwacht renderbare publieke SEO-contentpagina’s');

  for (const page of pages) {
    assert.doesNotMatch(page.html, forbiddenPublicCopy, `${page.label} bevat interne planningstaal`);
  }
});

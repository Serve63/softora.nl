const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const SEO_GROWTH_CSS_VERSION = '20260520b';

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
        /home-hero-generated-v2|home-over-office-meeting-ai|home-service-[^"']*-ai/i,
        `${fileName} gebruikt een zwakke AI/generated publieke beeldnaam: ${tag}`
      );
      assert.match(tag, /\balt="[^"]{18,}"/, `${fileName} mist betekenisvolle alt-tekst: ${tag}`);
      assert.match(tag, /\bwidth="\d+"/, `${fileName} mist vaste image width: ${tag}`);
      assert.match(tag, /\bheight="\d+"/, `${fileName} mist vaste image height: ${tag}`);
    }
  }
});

test('seo-growth mobile navigation keeps the contact CTA in the visible flow', () => {
  const css = readFile('assets/seo-growth-pages.css');

  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*\.seo-growth-nav-links\s*\{[\s\S]*width:\s*100%;[\s\S]*flex-wrap:\s*wrap;[\s\S]*overflow-x:\s*visible;[\s\S]*padding-bottom:\s*0;/s,
    'mobiele seo-growth navigatie mag de contact CTA niet buiten beeld duwen'
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
    /\/assets\/seo-growth-pages\.css\?v=20260520b/,
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

test('design protocol protects the homepage and public templates', () => {
  const source = readFile('docs/public-design-quality.md');

  assert.match(source, /Homepage-inhoud en homepage-layout blijven met rust/i);
  assert.match(source, /Bestaande templates en secties zijn leidend/i);
  assert.match(source, /CTA/i);
  assert.match(source, /contrast/i);
  assert.match(source, /geen losse SEO-blokken/i);
});

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
    /<h1 class="big-title">Digitale groei zonder ruis<span>\.<\/span><\/h1>/,
    'Over Softora H1 mag niet opnieuw met harde breaks in vier smalle regels vallen'
  );
  assert.doesNotMatch(
    source.match(/<h1 class="big-title">[\s\S]*?<\/h1>/)?.[0] || '',
    /<br>/,
    'Over Softora H1 moet breed kunnen ademen'
  );
  assert.match(
    source,
    /\.intro\s*\{[\s\S]*max-width:\s*1240px;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*gap:\s*42px;/s,
    'Over Softora hero moet de titel breed laten ademen'
  );
  assert.match(
    source,
    /\.big-title\s*\{[\s\S]*max-width:\s*1080px;/s,
    'Over Softora H1 moet breed genoeg blijven voor krachtige regels'
  );
  assert.match(
    source,
    /@media \(max-width:\s*1100px\)\s*\{[\s\S]*\.intro\s*\{[\s\S]*grid-template-columns:\s*1fr;[\s\S]*\.big-title\s*\{[\s\S]*max-width:\s*980px;/s,
    'Over Softora H1 mag op laptopbreedte niet opnieuw in een smalle kolom vallen'
  );
  assert.match(
    source,
    /\.quote-wrap\s*\{[\s\S]*background:\s*transparent;[\s\S]*padding:\s*0 80px 84px;/s,
    'Quote mag geen lompe full-width zwarte balk meer zijn'
  );
  assert.match(
    source,
    /\.quote-inner\s*\{[\s\S]*max-width:\s*1180px;[\s\S]*background:\s*var\(--dark\);[\s\S]*border-radius:\s*8px;[\s\S]*padding:\s*72px 88px;/s,
    'Quote moet als nette, ingekaderde sectie blijven renderen'
  );
  assert.match(
    source,
    /\.btn-outline\s*\{[\s\S]*background:\s*#fff;[\s\S]*color:\s*var\(--dark\);[\s\S]*border:\s*1px solid #ded9d0;/s,
    'Secundaire CTA’s moeten zichtbaar blijven op de lichte achtergrond'
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const SEO_GROWTH_CSS_VERSION = '20260520a';

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

test('diensten hero keeps the secondary insight CTA in the button system', () => {
  const source = readFile('diensten.html');

  assert.match(
    source,
    /<a class="seo-growth-button secondary" href="\/blog">Bekijk inzichten<\/a>/,
    'Bekijk inzichten moet een zichtbare secundaire knop blijven'
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

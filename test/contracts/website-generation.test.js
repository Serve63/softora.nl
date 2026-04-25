const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebsiteGenerationHelpers } = require('../../server/services/website-generation');

function createHelpers(overrides = {}) {
  return createWebsiteGenerationHelpers({
    env: overrides.env || {},
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    clipText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    escapeHtml: (value) =>
      String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    sanitizeReferenceImages:
      overrides.sanitizeReferenceImages ||
      ((images) =>
        (Array.isArray(images) ? images : []).map((item, index) => ({
          id: `img-${index + 1}`,
          name: String(item?.name || `image-${index + 1}`),
          dataUrl: String(item?.dataUrl || ''),
        }))),
  });
}

test('website generation helpers build preview prompt, brief and filename from scan data', () => {
  const helpers = createHelpers();
  const scan = {
    host: 'softora.nl',
    title: 'Softora',
    metaDescription: 'Premium websites',
    h1: 'Meer klanten met een premium site',
    headings: ['Diensten', 'Cases'],
    paragraphs: ['Sterke websites voor Nederlandse bedrijven.'],
    visualCues: ['licht design', 'grote hero'],
    brandColorHints: ['accent: #8b2252', 'accent-light: #a62d65'],
    brandPalette: ['#8b2252', '#a62d65', '#f8f7f4', '#1a1a2e'],
    navigationLabels: ['Home', 'Diensten', 'Contact'],
    ctaLabels: ['Start project', 'Bekijk werkwijze'],
    fontHints: ['Oswald', 'Inter'],
    layoutHints: ['sterke hero/above-the-fold', 'split-layout met tekst en beeld'],
    referenceImageCount: 2,
    bodyTextSample: 'Wij bouwen websites die converteren.',
  };

  const prompt = helpers.buildWebsitePreviewPromptFromScan(scan);
  const designDna = helpers.buildWebsitePreviewDesignDnaFromScan(scan);
  const designDnaLock = helpers.formatWebsitePreviewDesignDnaLock(scan);
  const brief = helpers.buildWebsitePreviewBriefFromScan(scan);
  const fileName = helpers.buildWebsitePreviewDownloadFileName(scan);

  assert.match(prompt, /Domein of merk: softora\.nl\./);
  assert.match(prompt, /Bekijk eerst de website grondig op basis van de URL-scan hieronder/i);
  assert.match(prompt, /Gebruik deze scan en eventuele referentiebeelden alleen als moodboard\/context/i);
  assert.match(prompt, /Genereer een volledig nieuw ultra-premium full-page desktop homepage-concept/i);
  assert.match(prompt, /aangeleverde screenshot alleen dient als moodboard voor merkidentiteit, branche, contentbasis, kleuren, sfeer en doelgroep/i);
  assert.match(prompt, /ontwerp vanaf nul een radicaal andere Awwwards-level website/i);
  assert.match(prompt, /totaal nieuwe informatiearchitectuur/i);
  assert.match(prompt, /geen herkenbare kopie van layout, hero, sectievolgorde, grids, kaartenrijen, iconenblokken, USP-blokken of footerstructuur/i);
  assert.match(prompt, /rustige, ruimtelijke, branche-passende editorial compositie/i);
  assert.match(prompt, /veel negative space, sterke visual hierarchy, hoogwaardige beeldregie/i);
  assert.match(prompt, /asymmetrische layout, subtiele diepte, verfijnde CTA’s, premium typografie/i);
  assert.match(prompt, /maximaal 5 grote ademende contentmomenten/i);
  assert.match(prompt, /UI-ONLY OUTPUT/i);
  assert.match(prompt, /duidelijk een gerenderde desktop website-interface/i);
  assert.match(prompt, /zichtbare navigatie, hero, typografie, secties, knoppen en footer/i);
  assert.match(prompt, /Maak géén losse stockfoto, kantoorinterieur, teamfoto, lifestylebeeld, mockup-scene of fotografische sfeerplaat/i);
  assert.match(prompt, /Fotografie mag alleen klein en ingebed binnen het website-ontwerp voorkomen/i);
  assert.match(prompt, /kies altijd de website-screenshot met duidelijke UI-elementen/i);
  assert.match(prompt, /Er zijn 2 referentiebeeld\(en\) meegegeven; behandel die uitsluitend als moodboard/i);
  assert.doesNotMatch(prompt, /DESIGN-DNA LOCK/);
  assert.doesNotMatch(prompt, /COPY LOCK/);
  assert.doesNotMatch(prompt, /STYLE LOCK/);
  assert.doesNotMatch(prompt, /TEXT STABILITY LOCK/);
  assert.doesNotMatch(prompt, /harde bron van waarheid/);
  assert.match(prompt, /Belangrijkste huidige heading: Meer klanten met een premium site\./);
  assert.match(prompt, /Originele navigatie-labels: Home \| Diensten \| Contact\./);
  assert.match(prompt, /Originele CTA\/knop-labels: Start project \| Bekijk werkwijze\./);
  assert.match(prompt, /Gedetecteerde merkkleur-variabelen: accent: #8b2252 \| accent-light: #a62d65\./);
  assert.match(prompt, /Gedetecteerde terugkerende merkkleuren: #8b2252 \| #a62d65 \| #f8f7f4 \| #1a1a2e\./);
  assert.match(prompt, /Gedetecteerde typografie\/font hints: Oswald \| Inter\./);
  assert.match(prompt, /Gedetecteerde layout\/stijl hints: sterke hero\/above-the-fold \| split-layout met tekst en beeld\./);
  assert.match(prompt, /exact 1 hoge portrait full-page desktop homepage screenshot/i);
  assert.equal(designDna.brand, 'softora.nl');
  assert.deepEqual(designDna.mandatoryPalette, ['#8b2252', '#a62d65', '#f8f7f4', '#1a1a2e']);
  assert.deepEqual(designDna.navigationSignals, ['Home', 'Diensten', 'Contact']);
  assert.deepEqual(designDna.ctaSignals, ['Start project', 'Bekijk werkwijze']);
  assert.deepEqual(designDna.typographySignals, ['Oswald', 'Inter']);
  assert.deepEqual(designDna.layoutSignals, ['sterke hero/above-the-fold', 'split-layout met tekst en beeld']);
  assert.match(designDnaLock, /Verbeterregel: Verbeter layout, hiërarchie, spacing/);
  assert.match(designDnaLock, /Navigatie-labels zo herkenbaar mogelijk behouden: Home \| Diensten \| Contact/i);
  assert.match(designDnaLock, /CTA-knoppen\/actiecopy zo herkenbaar mogelijk behouden: Start project \| Bekijk werkwijze/i);
  assert.match(designDnaLock, /Typografie\/font-signalen: Oswald \| Inter/i);
  assert.match(designDnaLock, /geen copy die losstaat van de gescande site/i);
  assert.equal(
    brief,
    'Titel: Softora · Hoofdboodschap: Meer klanten met een premium site · Omschrijving: Premium websites · Secties: Diensten, Cases · Beeldreferenties: licht design, grote hero · Kleuren: #8b2252, #a62d65, #f8f7f4, #1a1a2e'
  );
  assert.equal(fileName, 'softora.nl-preview.png');
});

test('website generation helpers normalize html documents and detect unusable strict html', () => {
  const helpers = createHelpers();

  const wrapped = helpers.ensureHtmlDocument('```html\n<section><h1>Hallo</h1></section>\n```', {
    title: 'Softora',
  });
  const strictGood = helpers.ensureStrictAnthropicHtml(
    '<!doctype html><html lang="nl"><body><main><h1>Hallo</h1></main></body></html>'
  );
  const strictBad = helpers.ensureStrictAnthropicHtml('<section><h1>Los fragment</h1></section>');

  assert.match(wrapped, /<!doctype html>/i);
  assert.match(wrapped, /<title>Softora<\/title>/);
  assert.match(wrapped, /<section><h1>Hallo<\/h1><\/section>/);
  assert.match(strictGood, /<html/i);
  assert.equal(strictBad, '');
});

test('website generation helpers infer industry, sanitize images and build prompts/blueprints', () => {
  const helpers = createHelpers({
    sanitizeReferenceImages: () => [
      { id: 'img-1', name: 'hero-reference.png', dataUrl: 'data:image/png;base64,abc' },
    ],
  });

  const context = helpers.buildWebsiteGenerationContext({
    prompt: 'Maak een premium website voor een marketing bureau met sterke CTA.',
    company: 'Softora Agency',
    description: 'SEO en marketing strategie',
    referenceImages: [{ name: 'hero-reference.png', dataUrl: 'data:image/png;base64,abc' }],
  });
  const prompts = helpers.buildWebsiteGenerationPrompts({
    prompt: 'Maak een premium website voor een marketing bureau met sterke CTA.',
    company: 'Softora Agency',
    description: 'SEO en marketing strategie',
    referenceImages: [{ name: 'hero-reference.png', dataUrl: 'data:image/png;base64,abc' }],
  });
  const blueprint = helpers.buildLocalWebsiteBlueprint({
    prompt: 'Maak een premium website voor een marketing bureau met sterke CTA.',
    company: 'Softora Agency',
    description: 'SEO en marketing strategie',
  });

  assert.equal(context.industry.key, 'consulting');
  assert.equal(context.referenceImages.length, 1);
  assert.match(prompts.userPrompt, /<reference_image_count>1<\/reference_image_count>/);
  assert.match(prompts.userPrompt, /hero-reference\.png/);
  assert.match(prompts.systemPrompt, /elite webdesigner/i);
  assert.match(blueprint, /<brand_core>/);
  assert.match(blueprint, /Softora Agency/);
});

test('website generation helpers evaluate html quality and anthropic stage config safely', () => {
  const helpers = createHelpers({
    env: {
      ANTHROPIC_WEBSITE_BUILD_EFFORT: 'max',
      ANTHROPIC_WEBSITE_MAX_TOKENS: '20000',
      ANTHROPIC_WEBSITE_ENABLE_ADAPTIVE_THINKING: 'true',
    },
  });

  const usableHtml = `
    <!doctype html>
    <html lang="nl">
    <body>
      <header><nav><a href="#cta">Start</a><a href="#contact">Contact</a></nav></header>
      <main>
        <section><h1>Premium websites</h1><p>${'Sterke copy '.repeat(20)}</p><button>Plan gesprek</button></section>
        <section><h2>Waarom Softora</h2><p>${'Meer tekst '.repeat(20)}</p></section>
        <section><h3>Cases</h3><form><input /><button>Verstuur</button></form></section>
      </main>
      <footer>Footer</footer>
    </body>
    </html>
  `;

  assert.equal(helpers.isLikelyUsableWebsiteHtml(usableHtml), true);
  assert.equal(helpers.getAnthropicWebsiteStageEffort('build'), 'max');
  assert.equal(helpers.getAnthropicWebsiteStageMaxTokens('build'), 20000);
  assert.equal(helpers.supportsAnthropicAdaptiveThinking('claude-opus-4-6'), true);
  assert.equal(helpers.supportsAnthropicAdaptiveThinking('claude-3-haiku'), false);
});

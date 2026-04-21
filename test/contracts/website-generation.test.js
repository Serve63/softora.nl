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
    bodyTextSample: 'Wij bouwen websites die converteren.',
  };

  const prompt = helpers.buildWebsitePreviewPromptFromScan(scan);
  const brief = helpers.buildWebsitePreviewBriefFromScan(scan);
  const fileName = helpers.buildWebsitePreviewDownloadFileName(scan);

  assert.match(prompt, /Brand or domain: softora\.nl\./);
  assert.match(prompt, /preserve the same core brand colors, accent usage, contrast relationships/i);
  assert.match(prompt, /Do not invent a new color palette/i);
  assert.match(prompt, /Primary heading on current site: Meer klanten met een premium site\./);
  assert.match(prompt, /Detected brand color variables: accent: #8b2252 \| accent-light: #a62d65\./);
  assert.match(prompt, /Detected recurring brand colors: #8b2252 \| #a62d65 \| #f8f7f4 \| #1a1a2e\./);
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

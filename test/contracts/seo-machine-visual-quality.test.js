const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { SEO_CONTENT_ITEMS } = require('../../server/services/seo-content');
const {
  auditVisualBriefs,
  buildVisualQualityReport,
} = require('../../server/services/seo-machine-visual-quality');

const repoRoot = path.resolve(__dirname, '../..');

function buildValidFutureBlog(overrides = {}) {
  return {
    collection: 'blog',
    slug: 'visueel-unieke-testpagina',
    publishedAt: '2026-08-05',
    visualQualityVersion: 2,
    image: {
      src: '/assets/seo-content/test-onderwerp-editorial-scene-softora.jpg',
      alt: 'Een concrete werksituatie die het hoofdonderwerp van de testpagina zichtbaar maakt.',
      width: 1600,
      height: 900,
    },
    secondaryImage: {
      src: '/assets/seo-content/test-onderwerp-beslismatrix-softora.jpg',
      alt: 'Beslismatrix met de belangrijkste keuzes voor het onderwerp van de testpagina.',
      width: 1600,
      height: 900,
    },
    visualBrief: {
      hero: {
        role: 'representative',
        visualType: 'editorial-scene',
        visualFamily: 'editorial-human-workflow',
        composition: 'Een horizontale documentaire scene met een duidelijke voorgrond, handeling en rustige achtergrond.',
        informationGoal: 'Laat in een oogopslag zien welke concrete werksituatie de koper wil verbeteren en wie daarbij betrokken is.',
        differenceFromRecent: 'Gebruikt een echte editoriale compositie met mensen en diepte, zonder witte isometrische tegel, zwevende dashboards of 3D-lijnen.',
        sourceType: 'trainedAlgorithmicMedia',
        textDensity: 'none',
        previewSafe: true,
      },
      support: {
        role: 'explanatory',
        visualType: 'decision-matrix',
        visualFamily: 'flat-decision-matrix',
        composition: 'Een vlakke beslismatrix met drie heldere assen, beperkte labels en visueel verschillende keuzepaden.',
        informationGoal: 'Maakt de afweging uit de hoofdtekst controleerbaar door opties, risico en passende vervolgstap naast elkaar te zetten.',
        differenceFromRecent: 'Gebruikt een platte informatiegrafiek met een donkere achtergrond en raster, zonder isometrische kamer, witte kaart of 3D-objecten.',
        sourceType: 'trainedAlgorithmicMedia',
        textDensity: 'minimal',
      },
    },
    ...overrides,
  };
}

test('recente Softora-beelden blijven na visuele rotatie onder de gelijkenisdrempel', async () => {
  const report = await buildVisualQualityReport({
    items: SEO_CONTENT_ITEMS,
    repoRoot,
  });

  assert.equal(report.status, 'ready');
  assert.ok(report.candidateCount >= 1);
  assert.equal(report.legacyDebt.status, 'healthy');
  assert.equal(report.legacyDebt.similarPairCount, 0);
  assert.deepEqual(report.legacyDebt.nearestPairs, []);
});

test('visual quality version 2 vereist twee verschillende en bruikbare beeldrollen', () => {
  const valid = buildValidFutureBlog();
  const invalid = {
    ...valid,
    slug: 'visueel-zwakke-testpagina',
    visualQualityVersion: 1,
    secondaryImage: undefined,
    visualBrief: undefined,
  };

  assert.deepEqual(auditVisualBriefs({ items: [valid] }), []);
  const issueTypes = auditVisualBriefs({ items: [invalid] }).map((entry) => entry.type);
  assert.ok(issueTypes.includes('missing-visual-quality-version'));
  assert.ok(issueTypes.includes('wrong-visual-count'));
  assert.ok(issueTypes.includes('invalid-visual-roles'));
});

test('een nieuw beeld dat recente Softora-assets kopieert wordt geblokkeerd', async () => {
  const copied = buildValidFutureBlog({
    slug: 'visueel-gekopieerde-testpagina',
    image: {
      src: '/assets/seo-content/chatbot-kosten-kostenlagen-softora.jpg',
      alt: 'Kopie van een recent beeld voor de gelijkenistest.',
      width: 1600,
      height: 900,
    },
    secondaryImage: {
      src: '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg',
      alt: 'Tweede kopie van een recent beeld voor de gelijkenistest.',
      width: 1600,
      height: 900,
    },
  });
  const report = await buildVisualQualityReport({
    items: [...SEO_CONTENT_ITEMS, copied],
    repoRoot,
  });

  assert.equal(report.status, 'blocked');
  assert.ok(report.issues.some((entry) => entry.type === 'recent-visual-similarity'));
});

test('four-image articles validate every image role, original diagram provenance and dimensions', () => {
  const item = SEO_CONTENT_ITEMS.find((entry) => entry.slug === 'website-snelheid-verbeteren');
  assert.equal(item.visualQualityVersion, 3);
  assert.deepEqual(auditVisualBriefs({ items: [item] }), []);
  const missingFourth = { ...item, sections: item.sections.map((section) => section.image?.src.includes('testen-en-controleren') ? { ...section, image: undefined } : section) };
  assert.ok(auditVisualBriefs({ items: [missingFourth] }).some((entry) => entry.type === 'wrong-visual-count'));
  const badBrief = { ...item, visualBrief: { ...item.visualBrief, supports: item.visualBrief.supports.map((brief, index) => index === 2 ? { ...brief, role: 'representative', sourceType: 'unknown', textDensity: 'dense', visualType: 'unknown' } : brief) } };
  const types = auditVisualBriefs({ items: [badBrief] }).map((entry) => entry.type);
  for (const type of ['invalid-visual-roles', 'missing-ai-source-type', 'invalid-support-text-density', 'invalid-support-visual-type', 'visual-source-mismatch']) assert.ok(types.includes(type), type);
  const smallFourth = { ...item, sections: item.sections.map((section) => section.image?.src.includes('testen-en-controleren') ? { ...section, image: { ...section.image, width: 100, height: 100 } } : section) };
  const smallTypes = auditVisualBriefs({ items: [smallFourth] }).map((entry) => entry.type);
  assert.ok(smallTypes.includes('image-too-small'));
  assert.ok(smallTypes.includes('non-landscape-preview-ratio'));
});

test('a copied fourth section image is rejected by the existing similarity threshold', async () => {
  const item = SEO_CONTENT_ITEMS.find((entry) => entry.slug === 'website-snelheid-verbeteren');
  const copied = { ...item, slug: 'fourth-image-copy', sections: item.sections.map((section) => section.image?.src.includes('testen-en-controleren') ? { ...section, image: { ...section.image, src: '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg' } } : section) };
  const report = await buildVisualQualityReport({ items: [...SEO_CONTENT_ITEMS, copied], repoRoot });
  assert.equal(report.status, 'blocked');
  assert.ok(report.issues.some((entry) => entry.type === 'recent-visual-similarity' && (entry.pair.left.src === '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg' || entry.pair.right.src === '/assets/seo-content/chatbot-kosten-scopevergelijking-softora.jpg')));
  assert.equal(report.similarityThreshold, 0.85);
});

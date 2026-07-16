const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MINIMUM_READY_ITEMS,
  calculateSeoCandidateScore,
  loadSeoMachineBacklog,
  validateSeoMachineBacklog,
} = require('../../server/services/seo-machine-backlog');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('versioned SEO backlog has at least fifteen valid publication-ready briefs', () => {
  const result = validateSeoMachineBacklog(loadSeoMachineBacklog());

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.summary.ready >= MINIMUM_READY_ITEMS, true);
  assert.equal(result.summary.commercialShare >= 0.7, true);
  assert.equal(result.summary.topReady.length, 5);
});

test('SEO backlog validator blocks readiness and weighted-score drift', () => {
  const backlog = clone(loadSeoMachineBacklog());
  backlog.items = backlog.items.slice(0, MINIMUM_READY_ITEMS - 1);
  backlog.items[0].weightedScore = 1;

  const result = validateSeoMachineBacklog(backlog);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /minimaal 15 vereist/i);
  assert.match(result.errors.join('\n'), /weightedScore/i);
});

test('SEO backlog validator blocks duplicate and already-used public paths', () => {
  const backlog = clone(loadSeoMachineBacklog());
  backlog.items[1].path = backlog.items[0].path;
  backlog.items[2].path = '/blog/website-laten-maken-kosten-2026';

  const result = validateSeoMachineBacklog(backlog);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /path is dubbel/i);
  assert.match(result.errors.join('\n'), /bestaat al live of gepland/i);
});

test('SEO candidate scoring uses the stable positive weights and risk penalties', () => {
  assert.equal(calculateSeoCandidateScore({
    businessFit: 5,
    conversionProximity: 5,
    nonBrandOpportunity: 5,
    attainability: 3,
    uniqueness: 5,
    cannibalizationRisk: 2,
    effort: 4,
  }), 4.4);
});

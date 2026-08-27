const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildD28NonBrandedPerformance,
  normalizePagePath,
} = require('../../server/services/seo-machine-performance');

function publicationPlan(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    path: `/kennisbank/cohort-${index + 1}`,
    eventAt: `2026-07-${String(index + 2).padStart(2, '0')}`,
    publishedAt: `2026-07-${String(index + 2).padStart(2, '0')}`,
    publicationKind: 'new_url',
    status: 'live',
  }));
}

function readyReport(nonBranded) {
  return { status: 'ready', pages: { nonBranded } };
}

test('D28 performance cohort becomes scale-ready only with reach and a non-brand click', () => {
  const performance = buildD28NonBrandedPerformance({
    publicationPlan: publicationPlan(),
    report: readyReport([
      { page: 'https://www.softora.nl/kennisbank/cohort-1', clicks: 1, impressions: 50, position: 8 },
      { page: 'https://softora.nl/kennisbank/cohort-2/', clicks: 0, impressions: 30, position: 14 },
      { page: '/kennisbank/cohort-3', clicks: 0, impressions: 20, position: 22 },
    ]),
    now: new Date('2026-08-27T12:00:00.000Z'),
  });
  assert.equal(performance.status, 'scale_ready');
  assert.equal(performance.summary.reviewed, 5);
  assert.equal(performance.summary.impressing, 3);
  assert.equal(performance.summary.clicks, 1);
});

test('D28 performance cohort triggers recovery for weak non-brand discovery', () => {
  const performance = buildD28NonBrandedPerformance({
    publicationPlan: publicationPlan(),
    report: readyReport([
      { page: '/kennisbank/cohort-1', clicks: 0, impressions: 120, position: 35 },
    ]),
    now: new Date('2026-08-27T12:00:00.000Z'),
  });
  assert.equal(performance.status, 'performance_recovery');
  assert.equal(performance.summary.impressionRate, 0.2);
  assert.equal(performance.summary.clicks, 0);
});

test('D28 performance reports degraded data and normalizes page URLs', () => {
  assert.equal(normalizePagePath('https://www.softora.nl/blog/test/'), '/blog/test');
  assert.equal(buildD28NonBrandedPerformance({ report: null }).status, 'data_degraded');
});

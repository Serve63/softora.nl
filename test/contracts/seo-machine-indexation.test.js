const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyIndexationState,
  collectIndexationReport,
  mapWithConcurrency,
  selectInspectionTargets,
} = require('../../server/services/seo-machine-indexation');

test('indexation controller classifies Search Console coverage states', () => {
  assert.equal(classifyIndexationState({ verdict: 'PASS' }), 'indexed');
  assert.equal(classifyIndexationState({ coverageState: 'URL is unknown to Google' }), 'unknown');
  assert.equal(classifyIndexationState({ coverageState: 'Crawled - currently not indexed' }), 'crawled_not_indexed');
  assert.equal(classifyIndexationState({ coverageState: 'Discovered - currently not indexed' }), 'discovered_not_indexed');
  assert.equal(classifyIndexationState({ coverageState: 'Duplicate without user-selected canonical' }), 'duplicate');
  assert.equal(classifyIndexationState({ coverageState: 'Excluded by noindex tag' }), 'blocked');
  assert.equal(classifyIndexationState({ coverageState: 'Gecrawld - momenteel niet geïndexeerd' }), 'crawled_not_indexed');
  assert.equal(classifyIndexationState({ coverageState: 'Ontdekt - momenteel niet geïndexeerd' }), 'discovered_not_indexed');
  assert.equal(classifyIndexationState({ coverageState: 'Dubbele pagina zonder door gebruiker gekozen canonieke versie' }), 'duplicate');
});

test('indexation report builds D14 cohort and evidence debt for non-indexed URLs', async () => {
  const payloads = new Map([
    ['https://www.softora.nl/blog/indexed', {
      inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } },
    }],
    ['https://www.softora.nl/blog/unknown', {
      inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' } },
    }],
  ]);
  const report = await collectIndexationReport({
    now: new Date('2026-07-23T12:00:00.000Z'),
    targets: [
      { path: '/blog/indexed', url: 'https://www.softora.nl/blog/indexed', kind: 'content', publishedAt: '2026-07-01' },
      { path: '/blog/unknown', url: 'https://www.softora.nl/blog/unknown', kind: 'content', publishedAt: '2026-07-02' },
    ],
    client: { inspectUrl: async (url) => payloads.get(url) },
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.summary.d14.inspected, 2);
  assert.equal(report.summary.d14.indexed, 1);
  assert.equal(report.summary.d14.rate, 0.5);
  assert.equal(report.summary.requestEvidenceDue, 1);
  assert.equal(report.items[1].indexingRequest.status, 'evidence_required');
});

test('inspection targets include money pages and only recent live content once', () => {
  const targets = selectInspectionTargets({
    now: new Date('2026-07-23T12:00:00.000Z'),
    priorityPaths: ['/crm-systeem-op-maat'],
    publicationPlan: [
      { path: '/blog/recent', status: 'live', publishedAt: '2026-07-22', cluster: 'software-crm' },
      { path: '/blog/old', status: 'live', publishedAt: '2026-01-01', cluster: 'software-crm' },
      { path: '/blog/draft', status: 'scheduled', publishedAt: '2026-07-22', cluster: 'software-crm' },
    ],
  });
  assert.deepEqual(targets.map((target) => target.path), ['/crm-systeem-op-maat', '/blog/recent']);
});

test('indexation work preserves order while limiting concurrent API calls', async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 5 : 1));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40]);
  assert.equal(maximumActive, 2);
});

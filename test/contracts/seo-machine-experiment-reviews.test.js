const test = require('node:test');
const assert = require('node:assert/strict');

const {
  digestExperimentMemory,
  parseExperimentReviewSchedule,
  validateExperimentReviewEvidence,
} = require('../../server/services/seo-machine-experiment-reviews');

const MEMORY = `# SEO memory

## 2026-08-01T08:00:00Z
- Experiment \`done-d14\`: URL \`/blog/done\`; hypothesis: useful page; reviews 2026-08-15, 2026-08-29 and 2026-09-26; status active.

## 2026-08-14T22:00:00Z
- Due experiment outcome \`done-d14\` at D14: indexed with 0 clicks and 12 impressions; hold to D28 without a causal claim.
- Experiment \`due-d14\`: URL \`/kennisbank/due\`; hypothesis: useful guide; reviews 2026-08-29, 2026-09-12 and 2026-10-10; status active.
`;

function report() {
  return {
    status: 'ready',
    generatedAt: '2026-08-29T06:15:00.000Z',
  };
}

function review(experimentId, stage, dueAt) {
  return {
    experimentId,
    stage,
    dueAt,
    outcome: 'insufficient_data',
    decision: 'hold',
    indexationStatus: 'indexed',
    metrics: {
      nonBrandedClicks: 0,
      nonBrandedImpressions: 12,
      averagePosition: 24.5,
      baselineComparison: 'Impressies zijn nog te schaars voor een richtinggevend effectbesluit.',
    },
    evidence: 'De URL is geindexeerd, maar het non-branded venster is nog te klein voor causaliteit.',
    nextAction: 'Ongewijzigd vasthouden tot de volgende geplande reviewdatum.',
  };
}

function evidence() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-29T06:20:00.000Z',
    sourceReport: {
      path: 'reports/seo-agent/latest.json',
      generatedAt: '2026-08-29T06:15:00.000Z',
    },
    memoryDigest: digestExperimentMemory(MEMORY),
    reviews: [
      review('done-d14', 'D28', '2026-08-29'),
      review('due-d14', 'D14', '2026-08-29'),
    ],
  };
}

test('review schedule derives only due, unfinished D14/D28/D56 stages from memory', () => {
  const schedule = parseExperimentReviewSchedule(MEMORY, new Date('2026-08-29T12:00:00.000Z'));

  assert.deepEqual(schedule.due.map(({ experimentId, stage, dueAt }) => ({ experimentId, stage, dueAt })), [
    { experimentId: 'done-d14', stage: 'D28', dueAt: '2026-08-29' },
    { experimentId: 'due-d14', stage: 'D14', dueAt: '2026-08-29' },
  ]);
  assert.equal(schedule.completed.some((item) => item.experimentId === 'done-d14' && item.stage === 'D14'), true);
});

test('review schedule uses the Amsterdam calendar at the UTC day boundary', () => {
  const schedule = parseExperimentReviewSchedule(MEMORY, new Date('2026-08-28T22:30:00.000Z'));

  assert.equal(schedule.today, '2026-08-29');
  assert.deepEqual(schedule.due.map((item) => `${item.experimentId}:${item.stage}`), [
    'done-d14:D28',
    'due-d14:D14',
  ]);
});

test('review schedule recognizes plural aggregate review lines from historical runs', () => {
  const memory = `# SEO memory

## 2026-08-01T08:00:00Z
- Experiment \`first\`: URL \`/blog/first\`; reviews 2026-08-15, 2026-08-29 and 2026-09-26.
- Experiment \`second\`: URL \`/blog/second\`; reviews 2026-08-15, 2026-08-29 and 2026-09-26.

## 2026-08-15T08:00:00Z
- Due reviews: \`/blog/first\` D14 is indexed; \`/blog/second\` D14 has sparse impressions; both remain on hold.
`;
  const schedule = parseExperimentReviewSchedule(memory, new Date('2026-08-15T12:00:00.000Z'));

  assert.deepEqual(schedule.completed.map((item) => `${item.experimentId}:${item.stage}`), [
    'first:D14',
    'second:D14',
  ]);
  assert.deepEqual(schedule.due, []);
});

test('review gate accepts exact structured evidence for every due experiment', () => {
  const result = validateExperimentReviewEvidence({
    memoryContent: MEMORY,
    evidence: evidence(),
    report: report(),
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-29T06:25:00.000Z'),
  });

  assert.equal(result.status, 'ready', result.errors.join('\n'));
  assert.equal(result.summary.dueCount, 2);
  assert.deepEqual(result.summary.reviewKeys, ['done-d14:D28', 'due-d14:D14']);
});

test('review gate blocks omitted reviews, stale reports and changed memory', () => {
  const candidate = evidence();
  candidate.reviews.pop();
  candidate.sourceReport.generatedAt = '2026-08-28T06:15:00.000Z';
  candidate.memoryDigest = digestExperimentMemory(`${MEMORY}\nchanged`);

  const result = validateExperimentReviewEvidence({
    memoryContent: MEMORY,
    evidence: candidate,
    report: report(),
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-29T06:25:00.000Z'),
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.errors.join(' '), /due-d14:D14/);
  assert.match(result.errors.join(' '), /sourceReport.generatedAt/);
  assert.match(result.errors.join(' '), /memoryDigest/);
});

test('review gate blocks stale reports, time travel and false report provenance', () => {
  const stale = validateExperimentReviewEvidence({
    memoryContent: MEMORY,
    evidence: evidence(),
    report: report(),
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-29T12:45:01.000Z'),
  });
  assert.equal(stale.status, 'blocked');
  assert.match(stale.errors.join(' '), /ouder dan 30 minuten/);

  const candidate = evidence();
  candidate.generatedAt = '2026-08-29T06:14:59.000Z';
  candidate.sourceReport.path = '/tmp/latest.json';
  const invalidProvenance = validateExperimentReviewEvidence({
    memoryContent: MEMORY,
    evidence: candidate,
    report: report(),
    reportPath: 'reports/seo-agent/latest.json',
    now: new Date('2026-08-29T06:25:00.000Z'),
  });
  assert.equal(invalidProvenance.status, 'blocked');
  assert.match(invalidProvenance.errors.join(' '), /voor het gekoppelde GSC-rapport/);
  assert.match(invalidProvenance.errors.join(' '), /veilig relatief repopad/);
});

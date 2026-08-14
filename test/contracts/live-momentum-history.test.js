const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../../assets/live-momentum-history');
const historyState = require('../../assets/live-momentum-history-state');

function snapshot(period, goals, retiredGoals = []) {
  return JSON.stringify({ version: 2, period, goals, retiredGoals });
}

function values(entries) {
  return Object.fromEntries(entries.map(([period, state]) => [
    `${history.MONTH_STATE_PREFIX}${period}`,
    state,
  ]));
}

test('maandgemiddelde start op de vroegste werkelijk geregistreerde dag en telt 0%-dagen mee', () => {
  const result = history.buildMonthlyAverages(values([['2026-07', snapshot('2026-07', [
    { activeFromDay: 13, doneDays: [13, 14] },
  ])]]), new Date('2026-08-01T10:00:00.000Z'));

  assert.equal(result.startDate, '2026-07-13');
  assert.equal(result.months[0].dayCount, 19);
  assert.equal(result.months[0].days[0].score, 100);
  assert.equal(result.months[0].days[2].score, 0);
  assert.equal(result.months[0].average, (200 / 19));
});

test('volledige maand, schrikkeljaar en maandgrens gebruiken alle kalenderdagen', () => {
  const result = history.buildMonthlyAverages(values([['2028-02', snapshot('2028-02', [
    { activeFromDay: 1, doneDays: [29] },
  ])]]), new Date('2028-03-01T12:00:00.000Z'));

  assert.equal(result.months[0].startDay, 1);
  assert.equal(result.months[0].endDay, 29);
  assert.equal(result.months[0].dayCount, 29);
  assert.equal(result.months[0].average, 100 / 29);
});

test('lopende maand stopt in Europe/Amsterdam bij vandaag en telt nooit toekomstige dagen', () => {
  const result = history.buildMonthlyAverages(values([['2026-08', snapshot('2026-08', [
    { activeFromDay: 1, doneDays: [1, 3, 31] },
  ])]]), new Date('2026-08-02T21:59:59.000Z'));

  assert.equal(result.months[0].isCurrent, true);
  assert.equal(result.months[0].endDay, 2);
  assert.equal(result.months[0].dayCount, 2);
  assert.equal(result.months[0].average, 50);
  assert.deepEqual(result.months[0].days.map((day) => day.day), [1, 2]);
});

test('historische actieve doelen en retired doelen bepalen per dag de ongeronde score', () => {
  const result = history.buildMonthlyAverages(values([['2026-08', snapshot('2026-08', [
    { activeFromDay: 1, doneDays: [1, 2] },
    { activeFromDay: 15, doneDays: [15] },
  ], [
    { activeFromDay: 1, activeUntilDay: 10, doneDays: [1] },
  ])]]), new Date('2026-08-15T12:00:00.000Z'));
  const month = result.months[0];

  assert.deepEqual(month.days.slice(0, 2).map((day) => day.score), [100, 50]);
  assert.equal(month.days[10].total, 1);
  assert.equal(month.days[14].total, 2);
  assert.equal(month.days[14].score, 50);
  assert.equal(month.average, month.days.reduce((sum, day) => sum + day.score, 0) / 15);
});

test('iedere maand gebruikt zijn eigen historische doelenlijst', () => {
  const result = history.buildMonthlyAverages(values([
    ['2026-07', snapshot('2026-07', [{ activeFromDay: 31, doneDays: [31] }])],
    ['2026-08', snapshot('2026-08', [
      { activeFromDay: 1, doneDays: [1] },
      { activeFromDay: 1, doneDays: [] },
    ])],
  ]), new Date('2026-08-01T12:00:00.000Z'));

  assert.deepEqual(result.months.map((month) => month.average), [100, 50]);
  assert.deepEqual(result.months.map((month) => month.dayCount), [1, 1]);
});

test('legacy tracked/empty arrays leveren startdatum zonder hardcoded kalenderstart', () => {
  const result = history.buildMonthlyAverages(values([['2026-07', snapshot('2026-07', [
    { trackedDays: [20, 21], emptyDays: [13, 14, 15], doneDays: [20] },
  ])]]), new Date('2026-08-01T12:00:00.000Z'));

  assert.equal(result.startDate, '2026-07-13');
  assert.equal(result.months[0].dayCount, 19);
});

test('lege, corrupte en toekomstige data geven een nette lege historie', () => {
  assert.deepEqual(history.buildMonthlyAverages({}, new Date('2026-08-14T12:00:00Z')), {
    startDate: null,
    months: [],
  });
  assert.deepEqual(history.buildMonthlyAverages({
    [`${history.MONTH_STATE_PREFIX}2026-08`]: '{broken',
  }, new Date('2026-08-14T12:00:00Z')).months, []);
  assert.deepEqual(history.buildMonthlyAverages(values([['2026-09', snapshot('2026-09', [
    { activeFromDay: 1, doneDays: [] },
  ])]]), new Date('2026-08-14T12:00:00Z')).months, []);
});

test('Amsterdam-middernacht schakelt de lopende maand exact op lokale datum', () => {
  const state = values([
    ['2026-08', snapshot('2026-08', [{ activeFromDay: 31, doneDays: [31] }])],
    ['2026-09', snapshot('2026-09', [{ activeFromDay: 1, doneDays: [1] }])],
  ]);
  const before = history.buildMonthlyAverages(state, new Date('2026-08-31T21:59:59.000Z'));
  const after = history.buildMonthlyAverages(state, new Date('2026-08-31T22:00:00.000Z'));

  assert.deepEqual(before.months.map((month) => month.key), ['2026-08']);
  assert.deepEqual(after.months.map((month) => month.key), ['2026-08', '2026-09']);
  assert.equal(after.months[1].endDay, 1);
});

test('verwijderde doelen blijven als historische waarheid tot de vorige tracked dag bewaard', () => {
  const controller = historyState.createController({
    stateKey: `${history.MONTH_STATE_PREFIX}2026-08`,
    maxRetiredGoals: 8,
    period: { startDay: 1, lastDay: 31 },
    periodKey: '2026-08',
    version: 2,
    normalizeGoal: (goal) => ({ ...goal }),
    getGoals: () => [{ id: 'active', label: 'Actief', activeFromDay: 1, doneDays: [] }],
    getLegacyMissionState: () => null,
    getEndGameState: () => ({})
  });

  controller.retire({ id: 'retired', label: 'Historisch', activeFromDay: 4, doneDays: [4, 5] }, 11);
  const stored = controller.buildSnapshot();

  assert.equal(stored.retiredGoals.length, 1);
  assert.equal(stored.retiredGoals[0].activeUntilDay, 10);
  assert.deepEqual(stored.retiredGoals[0].doneDays, [4, 5]);
});

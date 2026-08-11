const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTrainingExerciseCompleted,
  normalizeTrainingDayCompletions,
  readCanonicalExerciseSource,
  reconcileExerciseSources,
  trainingDateKey,
  updateTrainingExerciseCompletion,
} = require('../../assets/sportschool-logboek-state');

function exercise(kg, overrides = {}) {
  return {
    title: 'LEG EXTENSIONS',
    notes: '',
    sets: '3',
    reps: '8',
    kg,
    ...overrides,
  };
}

function occurrence(day, order, kg) {
  return {
    day,
    order,
    exerciseKey: 'name:LEG EXTENSIONS',
    source: exercise(kg),
    fallback: exercise('100'),
  };
}

test('gekoppelde oefening houdt nieuwe canonieke invoer vast ondanks oude dagkopie', () => {
  const sources = { 'name:LEG EXTENSIONS': exercise('10') };
  const canonical = readCanonicalExerciseSource(
    sources,
    'name:LEG EXTENSIONS',
    exercise('10')
  );
  canonical.kg = '100';

  assert.equal(
    readCanonicalExerciseSource(sources, 'name:LEG EXTENSIONS', exercise('10')).kg,
    '100'
  );

  const reconciled = reconcileExerciseSources(sources, [
    occurrence('tuesday', 1, '100'),
    occurrence('thursday', 2, '10'),
  ]);

  assert.equal(reconciled.exerciseSources['name:LEG EXTENSIONS'].kg, '100');
  assert.deepEqual(reconciled.entries.map((entry) => entry.source.kg), ['100', '100']);
  assert.equal(reconciled.repaired, true);
});

test('gekoppelde oefening kan niet terugvallen naar een oude schuine-streepwaarde', () => {
  const reconciled = reconcileExerciseSources(
    { 'name:LEG EXTENSIONS': exercise('100') },
    [occurrence('tuesday', 1, '100'), occurrence('thursday', 2, '100/104')]
  );

  assert.equal(reconciled.exerciseSources['name:LEG EXTENSIONS'].kg, '100');
  assert.deepEqual(reconciled.entries.map((entry) => entry.source.kg), ['100', '100']);
});

test('oude snapshots zonder gekoppelde bron behouden de niet-standaard trainingswaarde', () => {
  const reconciled = reconcileExerciseSources({}, [
    occurrence('tuesday', 1, '100'),
    occurrence('thursday', 2, '104'),
  ]);

  assert.equal(reconciled.exerciseSources['name:LEG EXTENSIONS'].kg, '104');
  assert.deepEqual(reconciled.entries.map((entry) => entry.source.kg), ['104', '104']);
});

test('afvinken gebruikt de exacte kalenderdatum binnen de huidige Nederlandse trainingsweek', () => {
  const thursday = new Date(2026, 7, 6, 12);
  const sunday = new Date(2026, 7, 9, 12);

  assert.equal(trainingDateKey('thursday', thursday), '2026-08-06');
  assert.equal(trainingDateKey('tuesday', thursday), '2026-08-04');
  assert.equal(trainingDateKey('sunday', thursday), '2026-08-09');
  assert.equal(trainingDateKey('monday', sunday), '2026-08-03');
  assert.equal(trainingDateKey('sunday', sunday), '2026-08-09');
});

test('afvinken en ongedaan maken blijven beperkt tot oefening en trainingsdatum', () => {
  const first = updateTrainingExerciseCompletion({}, '2026-08-06', 2, true);
  assert.equal(first.changed, true);
  assert.deepEqual(first.completions, {
    '2026-08-06': { day: 'thursday', exercises: { 2: true } },
  });
  assert.equal(isTrainingExerciseCompleted(first.completions, '2026-08-06', 2), true);
  assert.equal(isTrainingExerciseCompleted(first.completions, '2026-08-13', 2), false);

  const second = updateTrainingExerciseCompletion(first.completions, '2026-08-06', 4, true);
  const unchecked = updateTrainingExerciseCompletion(second.completions, '2026-08-06', 2, false);
  assert.deepEqual(unchecked.completions, {
    '2026-08-06': { day: 'thursday', exercises: { 4: true } },
  });

  const cleared = updateTrainingExerciseCompletion(unchecked.completions, '2026-08-06', 4, false);
  assert.equal(cleared.changed, true);
  assert.deepEqual(cleared.completions, {});
});

test('ongeldige of vervuilde afvinkdata kan niet in de centrale snapshot blijven staan', () => {
  assert.deepEqual(
    normalizeTrainingDayCompletions({
      '2026-02-30': { day: 'monday', exercises: { 1: true } },
      '2026-08-06': { day: 'monday', exercises: { 1: true, 2: false, x: true } },
      rommel: ['1'],
    }),
    {
      '2026-08-06': { day: 'thursday', exercises: { 1: true } },
    }
  );
});

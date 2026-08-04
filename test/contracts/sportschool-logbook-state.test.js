const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readCanonicalExerciseSource,
  reconcileExerciseSources,
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

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCompletedOnDate,
  readCanonicalExerciseSource,
  reconcileExerciseSources,
  setCompletedOnDate,
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

test('oefening-voltooiing is per trainingsdatum en blijft los van de canonieke oefeningsbron', () => {
  const base = exercise('100', { completedDates: ['2026-08-10', 'not-a-date'] });
  const completedToday = setCompletedOnDate(base, '2026-08-11', true);

  assert.deepEqual(completedToday.completedDates, ['2026-08-10', '2026-08-11']);
  assert.equal(isCompletedOnDate(completedToday, '2026-08-11'), true);
  assert.equal(isCompletedOnDate(completedToday, '2026-08-12'), false);
  assert.equal(completedToday.kg, '100');

  const reopened = setCompletedOnDate(completedToday, '2026-08-11', false);
  assert.deepEqual(reopened.completedDates, ['2026-08-10']);
  assert.equal(isCompletedOnDate(reopened, '2026-08-11'), false);
});

test('voltooiing accepteert geen ongeldige datum en maakt geen blijvende dagstatus', () => {
  const base = exercise('100');
  const unchanged = setCompletedOnDate(base, 'vandaag', true);

  assert.deepEqual(unchanged.completedDates, []);
  assert.equal(isCompletedOnDate(unchanged, 'vandaag'), false);
});

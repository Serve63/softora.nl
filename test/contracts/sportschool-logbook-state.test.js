const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFormSessionSlots,
  isCompletedOnDate,
  legacyFormHistoryFromSessions,
  nextFormStatus,
  normalizeFormSessionHistory,
  readCanonicalExerciseSource,
  reconcileExerciseSources,
  setCompletedOnDate,
  setFormSessionStatus,
} = require('../../assets/sportschool-logboek-state');

test('vormstatus doorloopt per tik rood omlaag, geel gelijk, groen omhoog en weer leeg', () => {
  assert.equal(nextFormStatus(''), 'down');
  assert.equal(nextFormStatus('down'), 'same');
  assert.equal(nextFormStatus('same'), 'up');
  assert.equal(nextFormStatus('up'), '');
});

test('vormgeschiedenis schuift per trainingsdatum en reserveert rechts een leeg vak voor vandaag', () => {
  const history = [
    { date: '2026-08-04', status: 'up' },
    { date: '2026-08-11', status: 'same' },
    { date: '2026-08-18', status: 'down' },
  ];

  assert.deepEqual(buildFormSessionSlots(history, '2026-08-25', true), [
    { date: '2026-08-11', status: 'same', isCurrent: false },
    { date: '2026-08-18', status: 'down', isCurrent: false },
    { date: '2026-08-25', status: '', isCurrent: true },
  ]);

  const nextHistory = setFormSessionStatus(history, '2026-08-25', 'up');
  assert.deepEqual(nextHistory, [
    { date: '2026-08-11', status: 'same' },
    { date: '2026-08-18', status: 'down' },
    { date: '2026-08-25', status: 'up' },
  ]);
  assert.deepEqual(buildFormSessionSlots(nextHistory, '2026-08-25', true), [
    { date: '2026-08-11', status: 'same', isCurrent: false },
    { date: '2026-08-18', status: 'down', isCurrent: false },
    { date: '2026-08-25', status: 'up', isCurrent: true },
  ]);

  const clearedHistory = setFormSessionStatus(nextHistory, '2026-08-25', '');
  assert.deepEqual(clearedHistory, [
    { date: '2026-08-11', status: 'same' },
    { date: '2026-08-18', status: 'down' },
  ]);
  assert.deepEqual(buildFormSessionSlots(clearedHistory, '2026-08-25', true), [
    { date: '2026-08-11', status: 'same', isCurrent: false },
    { date: '2026-08-18', status: 'down', isCurrent: false },
    { date: '2026-08-25', status: '', isCurrent: true },
  ]);
  assert.deepEqual(setFormSessionStatus(nextHistory, '2026-08-25', 'onbekend'), nextHistory);
});

test('dezelfde trainingsdatum schuift na herladen niet nogmaals door', () => {
  const once = setFormSessionStatus(
    [{ date: '2026-08-18', status: 'same' }],
    '2026-08-25',
    'down'
  );
  const corrected = setFormSessionStatus(once, '2026-08-25', 'up');

  assert.deepEqual(corrected, [
    { date: '2026-08-18', status: 'same' },
    { date: '2026-08-25', status: 'up' },
  ]);
  assert.equal(corrected.filter((entry) => entry.date === '2026-08-25').length, 1);
});

test('oude vaste pijlvakjes migreren behoudend naar maximaal drie sessies', () => {
  assert.deepEqual(normalizeFormSessionHistory(['up', '', 'same', 'down']), [
    { status: 'up' },
    { status: 'same' },
    { status: 'down' },
  ]);
  assert.deepEqual(legacyFormHistoryFromSessions([{ status: 'up' }]), ['', '', 'up']);
});

test('een niet-actieve trainingsdag toont alleen de laatste drie bekende sessies', () => {
  const slots = buildFormSessionSlots(
    [
      { date: '2026-08-04', status: 'down' },
      { date: '2026-08-11', status: 'same' },
      { date: '2026-08-18', status: 'up' },
    ],
    '2026-08-25',
    false
  );

  assert.deepEqual(slots.map((slot) => slot.status), ['down', 'same', 'up']);
  assert.equal(slots.some((slot) => slot.isCurrent), false);
});

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

const test = require('node:test');
const assert = require('node:assert/strict');

const calendar = require('../../assets/live-momentum-calendar.js');

test('live momentum calendar supports every month length and leap years', () => {
  assert.equal(calendar.createPeriod({ year: 2026, month: 1 }).lastDay, 31);
  assert.equal(calendar.createPeriod({ year: 2026, month: 4 }).lastDay, 30);
  assert.equal(calendar.createPeriod({ year: 2026, month: 2 }).lastDay, 28);
  assert.equal(calendar.createPeriod({ year: 2028, month: 2 }).lastDay, 29);
});

test('live momentum calendar only starts the original July period on day 13', () => {
  const originalPeriod = calendar.createPeriod({ year: 2026, month: 7 });
  const nextPeriod = calendar.createPeriod({ year: 2026, month: 8 });

  assert.equal(originalPeriod.key, '2026-07');
  assert.equal(originalPeriod.label, 'Juli 2026');
  assert.equal(originalPeriod.startDay, 13);
  assert.equal(nextPeriod.key, '2026-08');
  assert.equal(nextPeriod.label, 'Augustus 2026');
  assert.equal(nextPeriod.startDay, 1);
});

test('live momentum calendar uses Amsterdam date boundaries', () => {
  const beforeAmsterdamMidnight = new Date('2026-07-31T21:59:59.000Z');
  const afterAmsterdamMidnight = new Date('2026-07-31T22:00:00.000Z');

  assert.equal(calendar.getCurrentPeriod(beforeAmsterdamMidnight).key, '2026-07');
  assert.equal(calendar.getDayForPeriod(
    calendar.getCurrentPeriod(beforeAmsterdamMidnight),
    beforeAmsterdamMidnight
  ), 31);
  assert.equal(calendar.getCurrentPeriod(afterAmsterdamMidnight).key, '2026-08');
  assert.equal(calendar.getDayForPeriod(
    calendar.getCurrentPeriod(afterAmsterdamMidnight),
    afterAmsterdamMidnight
  ), 1);
});

test('live momentum calendar rolls December into January of the next year', () => {
  const december = calendar.getCurrentPeriod(new Date('2026-12-31T22:59:59.000Z'));
  const january = calendar.getCurrentPeriod(new Date('2026-12-31T23:00:00.000Z'));

  assert.equal(december.key, '2026-12');
  assert.equal(january.key, '2027-01');
  assert.equal(january.label, 'Januari 2027');
});

test('live momentum calendar selects the latest prior monthly Supabase state', () => {
  const values = {
    unrelated: 'keep',
    [calendar.getMonthStateKey('2026-07')]: '{}',
    [calendar.getMonthStateKey('2026-09')]: '{}',
    [calendar.getMonthStateKey('2026-10')]: '{}',
    [calendar.getMonthStateKey('invalid')]: '{}'
  };

  assert.equal(
    calendar.findLatestPriorMonthStateKey(values, '2026-11'),
    calendar.getMonthStateKey('2026-10')
  );
  assert.equal(
    calendar.findLatestPriorMonthStateKey(values, '2026-09'),
    calendar.getMonthStateKey('2026-07')
  );
  assert.equal(calendar.findLatestPriorMonthStateKey(values, '2026-07'), null);
});

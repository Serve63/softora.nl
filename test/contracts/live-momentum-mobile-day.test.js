const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calendar = require('../../assets/live-momentum-calendar.js');
const mobileDay = require('../../assets/live-momentum-mobile-day.js');

test('gisteren volgt de Amsterdamse kalender, inclusief maand-, jaar- en zomertijdgrenzen', () => {
  const cases = [
    ['2026-10-06T22:06:00Z', '2026-10', 6],
    ['2026-10-31T23:06:00Z', '2026-10', 31],
    ['2026-12-31T23:06:00Z', '2026-12', 31],
    ['2026-03-29T22:06:00Z', '2026-03', 29],
    ['2026-10-25T23:06:00Z', '2026-10', 25],
    ['2028-03-01T10:00:00Z', '2028-02', 29]
  ];
  for (const [now, period, day] of cases) {
    const selection = mobileDay.selectedDate(calendar, 'yesterday', new Date(now));
    assert.equal(selection.period.key, period, now);
    assert.equal(selection.day, day, now);
  }
  assert.equal(mobileDay.selectedDate(calendar, 'today', new Date(cases[0][0])).day, 7);
});

test('gisteren gebruikt zijn eigen opgeslagen maand en alleen doelen die die dag actief waren', () => {
  const selection = mobileDay.selectedDate(calendar, 'yesterday', new Date('2026-10-31T23:06:00Z'));
  const snapshot = {
    version: 2, period: '2026-10',
    goals: [{ id: 'workout', activeFromDay: 1, doneDays: [31] }, { id: 'new', activeFromDay: 31, doneDays: [] }],
    retiredGoals: [{ id: 'old', activeFromDay: 1, activeUntilDay: 31, doneDays: [31] }, { id: 'earlier', activeFromDay: 1, activeUntilDay: 30 }],
    heldDays: []
  };
  const values = {
    [calendar.getMonthStateKey('2026-10')]: JSON.stringify(snapshot),
    [calendar.getMonthStateKey('2026-11')]: JSON.stringify({ ...snapshot, period: '2026-11', goals: [] })
  };
  const original = JSON.stringify(values);
  const day = mobileDay.readDay(calendar, values, selection);
  assert.deepEqual(day.goals.map((goal) => goal.id), ['workout', 'new', 'old']);
  assert.deepEqual(day.retiredGoals.map((goal) => goal.id), ['old']);
  assert.equal(day.noData, false);
  assert.equal(JSON.stringify(values), original);
  const sixth = { period: calendar.createPeriod({ year: 2026, month: 10 }), day: 6 };
  assert.deepEqual(mobileDay.readDay(calendar, values, sixth).goals.map((goal) => goal.id), ['workout', 'old', 'earlier']);
});

test('ontbrekende of ongeldige historie wordt nooit als doelen van vandaag getoond', () => {
  const selection = mobileDay.selectedDate(calendar, 'yesterday', new Date('2026-10-31T23:06:00Z'));
  const key = calendar.getMonthStateKey('2026-10');
  assert.equal(mobileDay.readDay(calendar, {}, selection), null);
  assert.equal(mobileDay.readDay(calendar, { [key]: '{' }, selection), null);
  assert.equal(mobileDay.readDay(calendar, { [key]: { period: '2026-11', goals: [] } }, selection), null);
  assert.equal(mobileDay.readDay(calendar, { [key]: { period: '2026-10', goals: [], heldDays: [31] } }, selection).noData, true);
});

test('de mobiele dagkeuze behoudt de echte vandaagkolom en gebruikt bestaande opslag', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const source = read('assets/live-momentum-mobile-day.js');
  const mobile = read('assets/live-momentum-mobile.js');
  const html = read('live-momentum.html');
  const css = read('assets/live-momentum-mobile.css');
  assert.doesNotMatch(source, /classList\.(?:add|remove|toggle)\('is-today'|localStorage|\.set\(/);
  assert.match(source, /cell\.classList\.toggle\('is-mobile-day', selected\)/);
  assert.match(source, /softora:momentum-history-state/);
  assert.match(source, /if \(!mobileQuery\.matches\) return;/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(html, /data-momentum-mobile-focus-score aria-live="polite"/);
  assert.match(html, /role="menuitemradio" aria-checked="false" data-momentum-mobile-day="yesterday">Gisteren/);
  assert.match(html, /live-momentum-mobile-day\.js\?v=20261007a/);
  assert.match(mobile, /focusScore\.textContent = noData \? '—' : `\$\{score\}%`/);
  assert.ok(css.indexOf('.momentum-mobile-day-trigger {') > css.indexOf('@media (max-width: 900px)'));
});

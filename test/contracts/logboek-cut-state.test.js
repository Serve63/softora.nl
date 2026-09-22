const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../../assets/logboek-cut-state');
test('Amsterdam dates roll at midnight, including winter and summer time', () => {
  for (const [instant, date] of [
    ['2026-09-22T21:59:59Z','2026-09-22'], ['2026-09-22T22:00:00Z','2026-09-23'],
    ['2026-12-31T22:59:59Z','2026-12-31'], ['2026-12-31T23:00:00Z','2027-01-01'],
    ['2026-03-29T00:59:59Z','2026-03-29'], ['2026-03-29T01:00:00Z','2026-03-29'],
    ['2026-10-25T00:59:59Z','2026-10-25'], ['2026-10-25T01:00:00Z','2026-10-25'],
  ]) assert.equal(state.dateKey(new Date(instant)), date);
});
test('all seven weekdays use the correct schedule', () => {
  ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach((day,i) => {
    assert.equal(state.weekday(`2026-09-${21+i}`), day);
  });
});
test('progress requires every prescribed set, and ignores unrelated records', () => {
  const session = {exercises:[{order:1,sets:2}], checks:{'1:0':{done:true},'2:0':{done:true}}};
  assert.deepEqual(state.progress(session),{total:2,completed:1,percent:50});
  session.checks['1:1']={done:true}; assert.equal(state.progress(session).percent,100);
  session.checks['1:0']={done:false}; assert.equal(state.progress(session).percent,50);
  assert.equal(state.progress({exercises:[]}).percent,0);
});

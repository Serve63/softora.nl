const test = require('node:test');
const assert = require('node:assert/strict');

const { VERSION, mergeRemoteSnapshot } = require('../../assets/sportschool-logboek-bootstrap');

function day(orders, exercises = {}) {
  return { orders, exercises };
}

test('logboek bootstrap vult lege lokale dagen aan vanuit de canonieke snapshot', () => {
  const remote = {
    version: 2,
    exerciseSources: {
      'name:BENCH PRESS': { title: 'BENCH PRESS', sets: '2', reps: '8', kg: '80', notes: '' },
    },
    days: {
      monday: day([101], { '101': { title: 'BENCH PRESS', sets: '2', reps: '8', kg: '80' } }),
      tuesday: day([]),
    },
  };
  const local = {
    exerciseSources: {
      'name:LOCAL EXERCISE': { title: 'LOCAL EXERCISE', sets: '3', reps: '10', kg: '20', notes: '' },
    },
    days: {
      monday: day([]),
      tuesday: day([201], { '201': { title: 'LOCAL EXERCISE', formHistory: ['up', '', ''] } }),
    },
  };

  const merged = mergeRemoteSnapshot(remote, local);

  assert.equal(merged.remoteBootstrapVersion, VERSION);
  assert.deepEqual(merged.days.monday, remote.days.monday);
  assert.deepEqual(merged.days.tuesday, local.days.tuesday);
  assert.deepEqual(merged.exerciseSources['name:BENCH PRESS'], remote.exerciseSources['name:BENCH PRESS']);
  assert.deepEqual(merged.exerciseSources['name:LOCAL EXERCISE'], local.exerciseSources['name:LOCAL EXERCISE']);
});

test('logboek bootstrap behoudt een bewust lege lokale dag als de bron ook leeg is', () => {
  const remote = { days: { monday: day([]) } };
  const local = { days: { monday: day([]) } };

  const merged = mergeRemoteSnapshot(remote, local);

  assert.deepEqual(merged.days.monday, local.days.monday);
});

test('logboek bootstrap weigert ongeldige remote snapshots', () => {
  assert.equal(mergeRemoteSnapshot(null, {}), null);
  assert.equal(mergeRemoteSnapshot({ days: [] }, {}), null);
});

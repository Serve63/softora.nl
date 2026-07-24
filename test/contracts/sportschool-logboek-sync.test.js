const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bindResumeEvents,
  createResumeRevalidator,
  mergeConflictSnapshots,
  readRemoteSnapshotInfo,
} = require('../../assets/sportschool-logboek-sync');

const STATE_KEY = 'sportschool_logboek_v1';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
    this.visibilityState = 'visible';
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }
}

function remoteState(updatedAt, kg) {
  const snapshot = {
    version: 2,
    updatedAt,
    exerciseSources: {
      'name:CHEST PRESS': {
        title: 'CHEST PRESS',
        notes: '',
        sets: '3',
        reps: '8',
        kg,
      },
    },
    days: {},
  };
  return {
    ok: true,
    values: { [STATE_KEY]: JSON.stringify(snapshot) },
    updatedAt,
  };
}

function parseSnapshot(raw) {
  return raw ? JSON.parse(raw) : null;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('hervatten via pageshow, visible en focus dedupliceert naar één servercontrole en past nieuwere remote data toe', async () => {
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  let fetchCount = 0;
  const applied = [];
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const revalidator = createResumeRevalidator({
    fetchRemoteState: async () => {
      fetchCount += 1;
      return fetchPromise;
    },
    readSnapshotInfo: (state) => readRemoteSnapshotInfo(state, STATE_KEY, parseSnapshot),
    getKnownRemoteUpdatedAtMs: () => Date.parse('2026-07-24T10:00:00.000Z'),
    applyRemoteSnapshot: (snapshot) => applied.push(snapshot),
    nowMs: () => 1000,
  });
  bindResumeEvents({
    windowTarget,
    documentTarget,
    requestRefresh: (source) => revalidator.requestRefresh(source),
  });

  windowTarget.dispatch('pageshow');
  windowTarget.dispatch('focus');
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatch('visibilitychange');
  resolveFetch(remoteState('2026-07-24T10:01:00.000Z', '86'));
  await flushPromises();

  assert.equal(fetchCount, 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].exerciseSources['name:CHEST PRESS'].kg, '86');
});

test('lokale onopgeslagen invoer blokkeert hervat-refresh en wordt pas na geslaagde opslag opnieuw gecontroleerd', async () => {
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  let localChanges = true;
  let fetchCount = 0;
  const applied = [];
  const revalidator = createResumeRevalidator({
    fetchRemoteState: async () => {
      fetchCount += 1;
      return remoteState('2026-07-24T10:02:00.000Z', '88');
    },
    readSnapshotInfo: (state) => readRemoteSnapshotInfo(state, STATE_KEY, parseSnapshot),
    getKnownRemoteUpdatedAtMs: () => Date.parse('2026-07-24T10:00:00.000Z'),
    hasLocalChanges: () => localChanges,
    applyRemoteSnapshot: (snapshot) => applied.push(snapshot),
    nowMs: () => 2000,
  });
  bindResumeEvents({
    windowTarget,
    documentTarget,
    requestRefresh: (source) => revalidator.requestRefresh(source),
  });

  windowTarget.dispatch('pageshow');
  windowTarget.dispatch('focus');
  await flushPromises();
  assert.equal(fetchCount, 0);
  assert.equal(applied.length, 0);

  localChanges = false;
  const result = await revalidator.notifyLocalStateSettled();
  assert.equal(result.status, 'applied');
  assert.equal(fetchCount, 1);
  assert.equal(applied[0].exerciseSources['name:CHEST PRESS'].kg, '88');
});

test('remote data wordt alleen toegepast wanneer de servertimestamp aantoonbaar nieuwer is', async () => {
  const responses = [
    remoteState('2026-07-24T09:59:00.000Z', '80'),
    remoteState('2026-07-24T10:01:00.000Z', '86'),
  ];
  const applied = [];
  let now = 3000;
  const revalidator = createResumeRevalidator({
    fetchRemoteState: async () => responses.shift(),
    readSnapshotInfo: (state) => readRemoteSnapshotInfo(state, STATE_KEY, parseSnapshot),
    getKnownRemoteUpdatedAtMs: () => Date.parse('2026-07-24T10:00:00.000Z'),
    applyRemoteSnapshot: (snapshot) => applied.push(snapshot),
    nowMs: () => now,
  });

  const olderResult = await revalidator.requestRefresh('pageshow');
  now += 1000;
  const newerResult = await revalidator.requestRefresh('focus');

  assert.equal(olderResult.status, 'not-newer');
  assert.equal(newerResult.status, 'applied');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].exerciseSources['name:CHEST PRESS'].kg, '86');
});

test('lokale invoer die tijdens een servercontrole ontstaat wordt nooit door de response overschreven', async () => {
  let localChanges = false;
  let resolveFetch;
  const applied = [];
  const revalidator = createResumeRevalidator({
    fetchRemoteState: () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    readSnapshotInfo: (state) => readRemoteSnapshotInfo(state, STATE_KEY, parseSnapshot),
    getKnownRemoteUpdatedAtMs: () => Date.parse('2026-07-24T10:00:00.000Z'),
    hasLocalChanges: () => localChanges,
    applyRemoteSnapshot: (snapshot) => applied.push(snapshot),
    nowMs: () => 4000,
  });

  const refresh = revalidator.requestRefresh('visibilitychange');
  localChanges = true;
  resolveFetch(remoteState('2026-07-24T10:03:00.000Z', '90'));
  const result = await refresh;

  assert.equal(result.status, 'local-changes');
  assert.equal(applied.length, 0);
});

test('drieweg-merge bewaart lokale conflicten en neemt onafhankelijke nieuwere remote velden mee', () => {
  const base = {
    version: 2,
    updatedAt: '2026-07-24T10:00:00.000Z',
    exerciseSources: {
      chest: { title: 'CHEST PRESS', kg: '82', reps: '8' },
      row: { title: 'SEATED ROW', kg: '73', reps: '8' },
    },
    days: { monday: { orders: [1, 2] } },
  };
  const local = {
    ...base,
    updatedAt: '2026-07-24T10:01:00.000Z',
    exerciseSources: {
      ...base.exerciseSources,
      chest: { ...base.exerciseSources.chest, kg: '86' },
    },
  };
  const remote = {
    ...base,
    updatedAt: '2026-07-24T10:02:00.000Z',
    exerciseSources: {
      chest: { ...base.exerciseSources.chest, kg: '84' },
      row: { ...base.exerciseSources.row, reps: '10' },
    },
  };

  const merged = mergeConflictSnapshots(
    base,
    local,
    remote,
    () => '2026-07-24T10:03:00.000Z'
  );

  assert.equal(merged.exerciseSources.chest.kg, '86');
  assert.equal(merged.exerciseSources.row.reps, '10');
  assert.equal(merged.updatedAt, '2026-07-24T10:03:00.000Z');
});

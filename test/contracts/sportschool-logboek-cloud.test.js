const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cloud = require('../../assets/sportschool-logboek-cloud');
const { projectExercises } = require('../../server/services/logboek-cut');
const copy = value => JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setImmediate(resolve));
function plan(kg = '80', reps = '8') {
  const exercise = { exerciseKey: 'name:PRESS', title: 'PRESS', kg, reps, sets: '2', notes: '' };
  return { version: 3, updatedAt: '2026-08-19T12:00:00Z', exerciseSources: { 'name:PRESS': exercise },
    days: { monday: { orders: [1], exercises: { '1': exercise } }, wednesday: { orders: [1], exercises: { '1': exercise } } } };
}
function setup(local = plan('95'), stored = plan()) {
  const map = new Map();
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  if (local) storage.setItem(cloud.LOCAL_KEY, JSON.stringify(local));
  let snapshot = copy(stored), version = 1, status, saved = 0;
  const server = { authorized: true, online: true, conflict: false, acknowledgeOnly: false, posts: [], release: null };
  const body = () => ({ ok: true, values: { sportschool_logboek_v1: JSON.stringify(snapshot) }, updatedAt: `2026-09-23T10:00:${String(version).padStart(2, '0')}Z` });
  async function fetchImpl(url, options) {
    if (!server.online) throw Error('offline');
    if (options.method === 'GET') {
      assert.equal(url, '/api/sportschool-logboek-public');
      return { ok: true, status: 200, json: async () => body() };
    }
    assert.equal(url, '/api/sportschool-logboek');
    const input = JSON.parse(options.body); server.posts.push(input);
    if (!server.authorized) return { ok: false, status: 401, json: async () => ({ ok: false }) };
    if (server.conflict || input.baseUpdatedAt !== body().updatedAt) {
      return { ok: false, status: 409, json: async () => body() };
    }
    if (server.release) await server.release();
    if (server.acknowledgeOnly) return { ok: true, status: 200, json: async () => ({ ...body(), values: { sportschool_logboek_v1: JSON.stringify(input.snapshot) } }) };
    snapshot = copy(input.snapshot); version++;
    return { ok: true, status: 200, json: async () => body() };
  }
  const client = () => cloud.create({ storage, fetchImpl, onStatus: value => { status = value; }, onSaved: () => saved++ });
  return { storage, server, client, get status() { return status; }, get saved() { return saved; },
    get snapshot() { return copy(snapshot); }, set snapshot(next) { snapshot = copy(next); version++; },
    local: () => JSON.parse(storage.getItem(cloud.LOCAL_KEY)),
    edit: (kg, reps) => storage.setItem(cloud.LOCAL_KEY, JSON.stringify(plan(kg, reps))) };
}
test('a newer device-only weight is identified; reading never overwrites either version', async () => {
  const app = setup(); const client = app.client(); await client.refresh();
  assert.equal(app.status.kind, 'choice');
  assert.match(app.status.differences[0], /95 kg.*80 kg/);
  assert.equal(app.server.posts.length, 0);
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '95');
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].kg, '80');
  await client.useLocal();
  assert.equal(app.status.kind, 'synced');
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].kg, '95');
  assert.equal(projectExercises(app.snapshot, '2026-09-23')[0].kg, '95');
  assert.equal(projectExercises(app.snapshot, '2026-09-21')[0].kg, '95');
  const other = setup(null, app.snapshot); await other.client().refresh();
  assert.equal(other.local().exerciseSources['name:PRESS'].kg, '95');
});
test('login failure preserves the chosen local draft and resumes after reload', async () => {
  const app = setup(); app.server.authorized = false;
  const client = app.client(); await client.refresh(); await client.useLocal();
  assert.equal(app.status.kind, 'auth');
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '95');
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].kg, '80');
  app.server.authorized = true; await app.client().refresh();
  assert.equal(app.status.kind, 'synced');
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].kg, '95');
});
test('a stale unsynced device cannot replace newer server weights using a newer local timestamp', async () => {
  const local = plan('80'); local.updatedAt = '2030-01-01T00:00:00Z';
  const app = setup(local, plan('100')); const client = app.client(); await client.refresh();
  assert.equal(app.status.kind, 'choice'); assert.equal(app.server.posts.length, 0);
  await client.useRemote();
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '100');
  assert.equal(JSON.parse(app.storage.getItem(cloud.SYNC_KEY)).recovery.exerciseSources['name:PRESS'].kg, '80');
  assert.equal(app.server.posts.length, 0);
});
test('known devices fetch remote changes and autosave later edits without another import choice', async () => {
  const app = setup(plan()); const client = app.client(); await client.refresh();
  app.snapshot = plan('90'); await client.refresh();
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '90');
  app.edit('92,5'); await client.refresh();
  assert.equal(app.status.kind, 'synced');
  assert.equal(projectExercises(app.snapshot, '2026-09-23')[0].kg, '92,5');
});
test('independent offline and remote edits merge against the acknowledged baseline', async () => {
  const app = setup(plan()); const client = app.client(); await client.refresh();
  app.server.online = false; app.edit('92,5'); await client.refresh();
  assert.equal(app.status.kind, 'error');
  app.snapshot = plan('80', '12'); app.server.online = true;
  await app.client().refresh();
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].kg, '92,5');
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].reps, '12');
  assert.equal(app.status.kind, 'synced');
});
test('typing during a save keeps the latest input and queues it with the new baseline', async () => {
  const app = setup(plan()); const client = app.client(); await client.refresh();
  let release; app.server.release = () => new Promise(resolve => { release = resolve; });
  app.edit('90'); const saving = client.refresh(); await pause();
  app.edit('95'); app.server.release = null; release(); await saving; await pause(); await pause();
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '95');
  assert.equal(app.snapshot.exerciseSources['name:PRESS'].kg, '95');
  assert.deepEqual(app.server.posts.map(row => row.snapshot.exerciseSources['name:PRESS'].kg), ['90', '95']);
});
test('success in a legacy fallback is not reported as Supabase success', async () => {
  const app = setup(); const client = app.client(); await client.refresh();
  app.server.acknowledgeOnly = true; await client.useLocal();
  assert.equal(app.status.kind, 'error'); assert.equal(app.saved, 0);
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '95');
});
test('repeated concurrent changes stop retrying and keep the draft', async () => {
  const app = setup(); const client = app.client(); await client.refresh();
  app.server.conflict = true; await client.useLocal(); await pause(); await pause();
  assert.equal(app.server.posts.length, 2); assert.equal(app.status.kind, 'error');
  assert.equal(app.local().exerciseSources['name:PRESS'].kg, '95');
});
test('canonical weights win over stale day copies, including zero and decimal strings', () => {
  const snapshot = plan(); snapshot.days = copy(snapshot.days);
  snapshot.exerciseSources['name:PRESS'].kg = '0';
  assert.equal(cloud.normalize(snapshot).days.wednesday.exercises['1'].kg, '0');
  snapshot.exerciseSources['name:PRESS'].kg = '92,5';
  assert.equal(cloud.normalize(snapshot).days.monday.exercises['1'].kg, '92,5');
});
test('both logbooks load shared sync while schema writes retain the existing admin guard', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  for (const file of ['sportschool.html', 'logboek-cut.html']) {
    const html = read(file);
    assert.match(html, /sportschool-logboek-cloud\.js\?v=20260923a/);
    assert.match(html, /data-logbook-cloud/);
  }
  assert.match(read('assets/sportschool-logboek.js'), /cloud\?\.changed\(\)/);
  assert.match(read('assets/logboek-cut.js'), /onSaved:\(\)=>sync\.refresh\(\)/);
  assert.match(read('server/routes/runtime-ops.js'), /app\.post\('\/api\/sportschool-logboek', requirePremiumAdminApiAccess/);
  assert.doesNotMatch(read('assets/sportschool-logboek-cloud.js'), /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

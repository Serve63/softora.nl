const test = require('node:test');
const assert = require('node:assert/strict');
const createReadiness = require('../../assets/premium-database-readiness');

function environment() {
  const values = new Map([
    ['systemMailSentTodayCount', '77'], ['systemMailBouncesTodayCount', '48'],
    ['systemMailSentCount', '4.291'], ['mailRoiAppointmentsCount', '12'],
    ['mailRoiDealsCount', '4'],
  ]);
  const visible = { src: '/photo-visible.png', getBoundingClientRect: () => ({ top: 40, bottom: 74 }) };
  const belowFold = { src: '/photo-below.png', getBoundingClientRect: () => ({ top: 900, bottom: 934 }) };
  const events = [];
  const doc = {
    documentElement: { dataset: { softoraDatabaseActionsBound: 'true' }, clientHeight: 800 },
    getElementById: (id) => values.has(id) ? { textContent: values.get(id) } : null,
    querySelectorAll: () => [visible, belowFold],
  };
  const root = {
    document: doc,
    innerHeight: 800,
    SoftoraDatabaseSystemMailCount: {
      refreshTodaySentCount: async () => { events.push('stats'); },
      loadPersistedDealCount: async () => { events.push('roi'); },
      getMetricReadiness: () => ({ roi: true, stats: true }),
    },
    SoftoraScreenReadiness: {
      markReady: async (input) => { events.push('ready'); return input.actionsBound(); },
      markDegraded: (input) => { events.push(input.reason); },
    },
  };
  const state = { canonicalInventoryReady: true, remoteCustomersLoaded: true, photoRestorePending: false, photoRestoreFailed: false, dataLoading: false };
  return { readiness: createReadiness(root), root, state, values, visible, events };
}

test('Mailsysteem records readiness only after inventory, metrics, actions and visible photos are available', async () => {
  const env = environment();
  let request;
  env.root.SoftoraScreenReadiness.markReady = async (input) => { request = input; return input.actionsBound(); };
  assert.equal(await env.readiness.publish({ state: env.state }), true);
  assert.deepEqual(env.events, ['stats', 'roi']);
  assert.deepEqual(request.requiredData, { inventory: true, metrics: true });
  assert.deepEqual(request.requiredImages, [env.visible]);
  assert.equal(request.actionsBound(), true);
  env.root.document.documentElement.dataset.softoraDatabaseActionsBound = 'false';
  assert.equal(request.actionsBound(), false);
});

test('Mailsysteem cannot claim readiness with missing metrics or incomplete media restore', async () => {
  const env = environment();
  env.values.set('systemMailSentTodayCount', '--');
  assert.equal(await env.readiness.publish({ state: env.state }), false);
  assert.ok(env.events.includes('mail-metrics-unavailable'));
  assert.ok(!env.events.includes('ready'));

  env.values.set('systemMailSentTodayCount', '77');
  env.state.remoteCustomersLoaded = false;
  assert.equal(await env.readiness.publish({ state: env.state }), false);
  assert.ok(env.events.includes('database-inventory-incomplete'));
  env.state.remoteCustomersLoaded = true;
  env.state.photoRestoreFailed = true;
  assert.equal(await env.readiness.publish({ state: env.state }), false);
  assert.ok(env.events.includes('database-inventory-incomplete'));
  assert.ok(!env.events.includes('ready'));
});

test('Mailsysteem does not claim readiness from old bootstrap numbers after a failed live metric read', async () => {
  const env = environment();
  env.root.SoftoraDatabaseSystemMailCount.getMetricReadiness = () => ({ roi: false, stats: true });
  assert.equal(await env.readiness.publish({ state: env.state }), false);
  assert.ok(env.events.includes('mail-metrics-unavailable'));
  assert.ok(!env.events.includes('ready'));
});

test('Mailsysteem retries a transient metric failure and publishes readiness after fresh data arrives', async () => {
  const env = environment();
  let retry;
  let delay;
  let roiVerified = false;
  env.root.setTimeout = (callback, ms) => { retry = callback; delay = ms; return 1; };
  env.root.SoftoraDatabaseSystemMailCount.getMetricReadiness = () => ({ roi: roiVerified, stats: true });
  assert.equal(await env.readiness.publish({ state: env.state }), false);
  assert.equal(delay, 2000);
  roiVerified = true;
  assert.equal(await retry(), true);
  assert.equal(env.events.at(-1), 'ready');
});

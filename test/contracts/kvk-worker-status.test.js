const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, modelLabel } = require('../../assets/kvk-database-worker-status');
const now = Date.parse('2026-09-09T20:00:00Z');
const worker = { workerState: 'running', workerHeartbeatAt: new Date(now).toISOString(), model: 'gpt-5.6-luna', reasoningEffort: 'max' };

test('worker summary counts search and both review lanes with their models', () => {
  const result = summarize({ enabled: true, workers: { vuller: worker, controle: worker, goedgekeurd: { ...worker, model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' } } }, {}, now);
  assert.deepEqual(result[0], { kind: 'searchers', active: 1, models: ['Luna Max'] });
  assert.deepEqual(result[1], { kind: 'controllers', active: 2, models: ['Luna Max', 'Sol xhigh'] });
  assert.equal(modelLabel('gpt-6-astra', 'high'), 'Astra high');
});

test('disabled, stale, waiting, stalled and pre-request workers are not currently active', () => {
  for (const update of [{ workerHeartbeatAt: new Date(now - 150001).toISOString() }, { workerState: 'waiting' }, { stale: true }, { stalled: true }, { queuePending: false }]) {
    assert.equal(summarize({ enabled: true, workers: { vuller: { ...worker, ...update } } }, {}, now)[0].active, 0);
  }
  assert.equal(summarize({ enabled: false, workers: { vuller: worker } }, {}, now)[0].active, 0);
  assert.equal(summarize({ enabled: true, requestedAt: new Date(now + 1000).toISOString(), workers: { vuller: worker } }, {}, now)[0].active, 0);
  assert.equal(summarize({ unavailable: true, workers: { vuller: worker } }, {}, now)[0].active, null);
  assert.equal(summarize(null, {}, now)[0].active, null);
});

test('configured intelligence remains visible while workers are stopped', () => {
  const result = summarize({ enabled: false }, { vuller: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' } }, now);
  assert.deepEqual(result[0].models, ['Sol xhigh']);
});

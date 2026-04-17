const test = require('node:test');
const assert = require('node:assert/strict');

const { createSequentialDispatchCoordinator } = require('../../server/services/sequential-dispatch');

test('sequential dispatch coordinator pauses on an active call and resumes after webhook progress', async () => {
  const sequentialDispatchQueues = new Map();
  const sequentialDispatchQueueIdByCallId = new Map();
  const plannedResults = [
    {
      success: true,
      lead: { phone: '+31612345678' },
      call: { callId: 'call-1' },
    },
    {
      success: true,
      lead: { phone: '+31611111111' },
      call: { callId: 'call-2' },
    },
  ];
  let resultIndex = 0;
  let nextId = 1;

  const coordinator = createSequentialDispatchCoordinator({
    createQueueId: () => `seq-${nextId++}`,
    sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId,
    normalizeString: (value) => String(value || '').trim(),
    processColdcallingLead: async () => plannedResults[resultIndex++],
    logInfo: () => {},
    logError: () => {},
    schedule: () => 0,
  });

  const queue = coordinator.createSequentialDispatchQueue(
    { dispatchMode: 'sequential' },
    [{ phone: '0612345678' }, { phone: '0611111111' }]
  );

  await coordinator.advanceSequentialDispatchQueue(queue.id, 'start-request');
  assert.equal(queue.results.length, 1);
  assert.equal(queue.waitingForCallId, 'call-1');

  coordinator.handleSequentialDispatchQueueWebhookProgress({
    callId: 'call-1',
    status: 'ended',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(queue.results.length, 2);
  assert.equal(queue.waitingForCallId, 'call-2');
});

test('sequential dispatch coordinator recognizes terminal updates conservatively', () => {
  const coordinator = createSequentialDispatchCoordinator({
    normalizeString: (value) => String(value || '').trim(),
  });

  assert.equal(
    coordinator.isCallUpdateTerminalForSequentialDispatch({ status: 'completed' }),
    true
  );
  assert.equal(
    coordinator.isCallUpdateTerminalForSequentialDispatch({ endedReason: 'busy' }),
    true
  );
  assert.equal(
    coordinator.isCallUpdateTerminalForSequentialDispatch({ status: 'ringing' }),
    false
  );
});

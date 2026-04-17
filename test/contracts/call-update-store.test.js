const test = require('node:test');
const assert = require('node:assert/strict');

const { createCallUpdateStore } = require('../../server/services/call-update-store');

test('call update store merges existing rows and queues both persist channels', () => {
  const callUpdatesById = new Map([
    [
      'call-1',
      {
        callId: 'call-1',
        company: 'Softora',
        phone: '0612345678',
        status: 'ringing',
        updatedAt: '2026-04-16T10:00:00.000Z',
        updatedAtMs: Date.parse('2026-04-16T10:00:00.000Z'),
      },
    ],
  ]);
  const recentCallUpdates = [callUpdatesById.get('call-1')];
  const persistReasons = [];
  const persistedRows = [];
  const retellCallStatusRefreshByCallId = new Map([['call-1', Date.now()]]);

  const store = createCallUpdateStore({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLen) => String(value || '').slice(0, maxLen),
    resolveCallUpdateTimestamp: (update) => ({
      updatedAt: update.updatedAt || '2026-04-16T11:00:00.000Z',
      updatedAtMs: update.updatedAtMs || Date.parse('2026-04-16T11:00:00.000Z'),
    }),
    callUpdatesById,
    recentCallUpdates,
    isTerminalColdcallingStatus: (status) => status === 'ended',
    retellCallStatusRefreshByCallId,
    queueRuntimeStatePersist: (reason) => persistReasons.push(reason),
    queueCallUpdateRowPersist: (row, reason) => persistedRows.push({ row, reason }),
  });

  const merged = store.upsertRecentCallUpdate(
    {
      callId: 'call-1',
      status: 'ended',
      company: '',
      provider: 'retell',
      messageType: 'call.ended',
    },
    { persistReason: 'webhook_update' }
  );

  assert.equal(merged.company, 'Softora');
  assert.equal(merged.status, 'ended');
  assert.equal(recentCallUpdates[0].callId, 'call-1');
  assert.deepEqual(persistReasons, ['webhook_update']);
  assert.equal(persistedRows.length, 1);
  assert.equal(persistedRows[0].reason, 'webhook_update');
  assert.equal(retellCallStatusRefreshByCallId.has('call-1'), false);
});

test('call update store caps the in-memory list at 500 rows', () => {
  const callUpdatesById = new Map();
  const recentCallUpdates = [];
  for (let index = 0; index < 500; index += 1) {
    const item = {
      callId: `call-${index}`,
      updatedAt: '2026-04-16T10:00:00.000Z',
      updatedAtMs: index + 1,
    };
    callUpdatesById.set(item.callId, item);
    recentCallUpdates.push(item);
  }

  const store = createCallUpdateStore({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLen) => String(value || '').slice(0, maxLen),
    resolveCallUpdateTimestamp: (update) => ({
      updatedAt: update.updatedAt || '2026-04-16T12:00:00.000Z',
      updatedAtMs: update.updatedAtMs || Date.parse('2026-04-16T12:00:00.000Z'),
    }),
    callUpdatesById,
    recentCallUpdates,
  });

  store.upsertRecentCallUpdate({
    callId: 'call-500',
    updatedAt: '2026-04-16T12:00:00.000Z',
    updatedAtMs: Date.parse('2026-04-16T12:00:00.000Z'),
  });

  assert.equal(recentCallUpdates.length, 500);
  assert.equal(callUpdatesById.has('call-499'), false);
  assert.equal(callUpdatesById.has('call-0'), true);
  assert.equal(recentCallUpdates[0].callId, 'call-500');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeMemoryState } = require('../../server/services/runtime-memory');

test('runtime memory state exposes isolated collections and monotonic counters', () => {
  const state = createRuntimeMemoryState();

  assert.ok(Array.isArray(state.recentWebhookEvents));
  assert.ok(state.callUpdatesById instanceof Map);
  assert.ok(state.aiAnalysisInFlightCallIds instanceof Set);
  assert.ok(state.sequentialDispatchQueues instanceof Map);
  assert.equal(state.getNextGeneratedAgendaAppointmentId(), 100000);
  assert.equal(state.takeNextGeneratedAgendaAppointmentId(), 100000);
  assert.equal(state.getNextGeneratedAgendaAppointmentId(), 100001);
  assert.equal(state.createSequentialDispatchQueueId(), 'seq-1');
  assert.equal(state.createSequentialDispatchQueueId(), 'seq-2');
});

test('runtime memory sync state normalizes setter values', () => {
  const state = createRuntimeMemoryState();

  state.runtimeStateSyncState.supabaseStateHydrated = 1;
  state.runtimeStateSyncState.supabaseLastHydrateError = 'fetch failed';
  state.runtimeStateSyncState.nextLeadOwnerRotationIndex = '4';
  state.runtimeStateSyncState.nextGeneratedAgendaAppointmentId = '42';

  assert.equal(state.runtimeStateSyncState.supabaseStateHydrated, true);
  assert.equal(state.runtimeStateSyncState.supabaseLastHydrateError, 'fetch failed');
  assert.equal(state.getNextLeadOwnerRotationIndex(), 4);
  assert.equal(state.getNextGeneratedAgendaAppointmentId(), 42);
});

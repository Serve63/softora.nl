const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRuntimeStateSyncCallUpdateHelpers,
} = require('../../server/services/runtime-state-sync-call-updates');

test('runtime state sync call-update helpers build stable persist metadata and merge newer rows', async () => {
  const recentCallUpdates = [];
  const callUpdatesById = new Map();
  const runtimeState = {
    supabaseCallUpdatePersistChain: Promise.resolve(true),
    supabaseLastCallUpdatePersistError: '',
    supabaseCallUpdatesLastSyncCheckMs: 0,
    supabaseLastHydrateError: '',
  };

  const helpers = createRuntimeStateSyncCallUpdateHelpers({
    isSupabaseConfigured: () => true,
    fetchSupabaseCallUpdateRowsViaRest: async () => ({
      ok: true,
      status: 200,
      body: [
        {
          payload: {
            callUpdate: {
              callId: 'call-1',
              updatedAt: '2026-04-17T10:00:00.000Z',
              updatedAtMs: 1000,
              status: 'completed',
            },
          },
        },
      ],
    }),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    parseNumberSafe: (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    buildSupabaseCallUpdateStateKey: (callId) => `call_update:${callId}`,
    extractSupabaseCallUpdateFromRow: (row) => row?.payload?.callUpdate || null,
    buildSupabaseCallUpdatePayload: (callUpdate) => ({ callUpdate }),
    compactRuntimeSnapshotCallUpdate: (item) => item,
    upsertRecentCallUpdate: (callUpdate) => {
      const next = { ...callUpdate };
      callUpdatesById.set(callUpdate.callId, next);
      recentCallUpdates.splice(
        0,
        recentCallUpdates.length,
        ...Array.from(callUpdatesById.values())
      );
      return next;
    },
    getRuntimeSnapshotItemTimestampMs: (item) => Number(item?.updatedAtMs || 0),
    recentCallUpdates,
    callUpdatesById,
    runtimeState,
  });

  const meta = helpers.buildCallUpdateRowPersistMeta({
    callId: 'call-1',
    status: 'completed',
    provider: 'twilio',
    updatedAt: '2026-04-17T10:00:00.000Z',
  });
  assert.equal(meta.callId, 'call-1');
  assert.equal(meta.status, 'completed');
  assert.equal(meta.provider, 'twilio');

  const changed = await helpers.syncCallUpdatesFromSupabaseRows({ force: true, maxAgeMs: 0 });
  assert.equal(changed, true);
  assert.equal(recentCallUpdates.length, 1);
  assert.equal(callUpdatesById.get('call-1')?.status, 'completed');
});

test('runtime state sync call-update helpers fall back to REST persist when the client write fails', async () => {
  const persistedRows = [];
  const runtimeState = {
    supabaseCallUpdatePersistChain: Promise.resolve(true),
    supabaseLastCallUpdatePersistError: '',
    supabaseCallUpdatesLastSyncCheckMs: 0,
    supabaseLastHydrateError: '',
  };

  const helpers = createRuntimeStateSyncCallUpdateHelpers({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from() {
        return {
          upsert: async () => ({ error: new Error('client down') }),
        };
      },
    }),
    upsertSupabaseRowViaRest: async (row) => {
      persistedRows.push(row);
      return { ok: true, status: 200 };
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    buildSupabaseCallUpdateStateKey: (callId) => `call_update:${callId}`,
    buildSupabaseCallUpdatePayload: (callUpdate, reason) => ({ type: reason, callUpdate }),
    compactRuntimeSnapshotCallUpdate: (item) => item,
    recentCallUpdates: [],
    callUpdatesById: new Map(),
    runtimeState,
  });

  const ok = await helpers.persistSingleCallUpdateRowToSupabase(
    {
      callId: 'call-2',
      updatedAt: '2026-04-17T10:00:00.000Z',
      status: 'completed',
      provider: 'retell',
    },
    'call_update_row'
  );

  assert.equal(ok, true);
  assert.equal(persistedRows.length, 1);
  assert.equal(persistedRows[0].state_key, 'call_update:call-2');
});

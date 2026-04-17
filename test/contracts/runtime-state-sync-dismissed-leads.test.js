const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRuntimeStateSyncDismissedLeadHelpers,
} = require('../../server/services/runtime-state-sync-dismissed-leads');

test('runtime state sync dismissed-lead helpers parse remote rows and hydrate local state', async () => {
  const dismissedInterestedLeadCallIds = new Set();
  const dismissedInterestedLeadKeys = new Set();
  const dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map();
  const runtimeState = { dismissedLeadsLastHydrateAtMs: 0 };

  const helpers = createRuntimeStateSyncDismissedLeadHelpers({
    isSupabaseConfigured: () => true,
    supabaseDismissedLeadsStateKey: 'core:dismissed_leads',
    fetchSupabaseRowByKeyViaRest: async () => ({
      ok: true,
      body: {
        payload: {
          callIds: ['call-1'],
          leadKeys: ['lead-1'],
          leadKeyUpdatedAtMsByKey: { 'lead-1': 1234 },
          updatedAt: '2026-04-17T10:00:00.000Z',
        },
      },
    }),
    normalizeString: (value) => String(value || '').trim(),
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    runtimeState,
  });

  const ok = await helpers.hydrateDismissedLeadsFromSupabase();
  assert.equal(ok, true);
  assert.equal(dismissedInterestedLeadCallIds.has('call-1'), true);
  assert.equal(dismissedInterestedLeadKeys.has('lead-1'), true);
  assert.equal(dismissedInterestedLeadKeyUpdatedAtMsByKey.get('lead-1'), 1234);
});

test('runtime state sync dismissed-lead helpers persist a merged remote+local dismissed state', async () => {
  const persistedRows = [];
  const dismissedInterestedLeadCallIds = new Set(['call-local']);
  const dismissedInterestedLeadKeys = new Set(['lead-local']);
  const dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map([['lead-local', 2222]]);
  const runtimeState = { dismissedLeadsLastHydrateAtMs: 0 };
  let fetchCount = 0;

  const helpers = createRuntimeStateSyncDismissedLeadHelpers({
    isSupabaseConfigured: () => true,
    supabaseDismissedLeadsStateKey: 'core:dismissed_leads',
    fetchSupabaseRowByKeyViaRest: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: true,
          body: {
            payload: {
              callIds: ['call-remote'],
              leadKeys: ['lead-remote'],
              leadKeyUpdatedAtMsByKey: { 'lead-remote': 1111 },
            },
          },
        };
      }
      return {
        ok: true,
        body: {
          payload: {
            callIds: ['call-local', 'call-remote'],
            leadKeys: ['lead-local', 'lead-remote'],
            leadKeyUpdatedAtMsByKey: {
              'lead-local': 2222,
              'lead-remote': 1111,
            },
          },
        },
      };
    },
    upsertSupabaseRowViaRest: async (row) => {
      persistedRows.push(row);
      return { ok: true, status: 200 };
    },
    normalizeString: (value) => String(value || '').trim(),
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    runtimeState,
  });

  const ok = await helpers.persistDismissedLeadsToSupabase('dismissed_leads_persist');
  assert.equal(ok, true);
  assert.equal(persistedRows.length, 1);
  assert.deepEqual(persistedRows[0].payload.callIds.sort(), ['call-local', 'call-remote']);
  assert.deepEqual(persistedRows[0].payload.leadKeys.sort(), ['lead-local', 'lead-remote']);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeStateSyncCoordinator } = require('../../server/services/runtime-state-sync');

function createRuntimeState(overrides = {}) {
  return {
    supabaseStateHydrationPromise: null,
    supabaseStateHydrated: false,
    supabasePersistChain: Promise.resolve(true),
    supabaseCallUpdatePersistChain: Promise.resolve(true),
    supabaseHydrateRetryNotBeforeMs: 0,
    supabaseLastHydrateError: '',
    supabaseLastPersistError: '',
    supabaseLastCallUpdatePersistError: '',
    runtimeStateObservedAtMs: 0,
    runtimeStateLastSupabaseSyncCheckMs: 0,
    supabaseCallUpdatesLastSyncCheckMs: 0,
    nextLeadOwnerRotationIndex: 0,
    nextGeneratedAgendaAppointmentId: 100000,
    ...overrides,
  };
}

function createFixture(overrides = {}) {
  const recentWebhookEvents = overrides.recentWebhookEvents || [];
  const recentCallUpdates = overrides.recentCallUpdates || [];
  const callUpdatesById = overrides.callUpdatesById || new Map();
  const recentAiCallInsights = overrides.recentAiCallInsights || [];
  const aiCallInsightsByCallId = overrides.aiCallInsightsByCallId || new Map();
  const recentDashboardActivities = overrides.recentDashboardActivities || [];
  const recentSecurityAuditEvents = overrides.recentSecurityAuditEvents || [];
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];
  const agendaAppointmentIdByCallId = overrides.agendaAppointmentIdByCallId || new Map();
  const dismissedInterestedLeadCallIds = overrides.dismissedInterestedLeadCallIds || new Set();
  const dismissedInterestedLeadKeys = overrides.dismissedInterestedLeadKeys || new Set();
  const leadOwnerAssignmentsByCallId = overrides.leadOwnerAssignmentsByCallId || new Map();
  const runtimeState = overrides.runtimeState || createRuntimeState();
  const persistedRows = [];
  const logs = [];

  const coordinator = createRuntimeStateSyncCoordinator({
    isSupabaseConfigured: () =>
      overrides.isSupabaseConfigured === undefined ? true : Boolean(overrides.isSupabaseConfigured),
    getSupabaseClient:
      overrides.getSupabaseClient ||
      (() => ({
        from() {
          return {
            upsert: async (row) => {
              persistedRows.push(row);
              return { error: null };
            },
          };
        },
      })),
    fetchSupabaseStateRowViaRest:
      overrides.fetchSupabaseStateRowViaRest || (async () => ({ ok: false, status: 404, body: null })),
    upsertSupabaseStateRowViaRest:
      overrides.upsertSupabaseStateRowViaRest ||
      (async (row) => {
        persistedRows.push(row);
        return { ok: true, status: 200 };
      }),
    fetchSupabaseCallUpdateRowsViaRest:
      overrides.fetchSupabaseCallUpdateRowsViaRest ||
      (async () => ({ ok: true, status: 200, body: [] })),
    upsertSupabaseRowViaRest:
      overrides.upsertSupabaseRowViaRest ||
      (async (row) => {
        persistedRows.push(row);
        return { ok: true, status: 200 };
      }),
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    supabaseCallUpdateStateKeyPrefix: 'call_update:',
    supabaseCallUpdateRowsFetchLimit: 100,
    runtimeStateSupabaseSyncCooldownMs: 1000,
    runtimeStateRemoteNewerThresholdMs: 250,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    parseNumberSafe: (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    buildSupabaseCallUpdateStateKey: (callId) => `call_update:${callId}`,
    extractSupabaseCallUpdateFromRow:
      overrides.extractSupabaseCallUpdateFromRow ||
      ((row) => {
        if (!row?.payload?.callUpdate) return null;
        return row.payload.callUpdate;
      }),
    buildSupabaseCallUpdatePayload:
      overrides.buildSupabaseCallUpdatePayload ||
      ((callUpdate, reason) => ({
        type: 'call_update',
        reason,
        callUpdate,
      })),
    buildRuntimeStateSnapshotPayloadWithLimits:
      overrides.buildRuntimeStateSnapshotPayloadWithLimits ||
      (() => ({
        version: 5,
        savedAt: '2026-04-08T10:00:00.000Z',
        recentWebhookEvents: [],
        recentCallUpdates: [
          {
            callId: 'call-local',
            updatedAt: '2026-04-08T10:00:00.000Z',
            updatedAtMs: 1000,
          },
        ],
        recentAiCallInsights: [],
        recentDashboardActivities: [],
        recentSecurityAuditEvents: [],
        generatedAgendaAppointments: [],
        dismissedInterestedLeadCallIds: [],
        dismissedInterestedLeadKeys: [],
        leadOwnerAssignments: [],
        nextLeadOwnerRotationIndex: runtimeState.nextLeadOwnerRotationIndex,
        nextGeneratedAgendaAppointmentId: runtimeState.nextGeneratedAgendaAppointmentId,
      })),
    compactRuntimeSnapshotWebhookEvent: (item) => ({
      receivedAt: String(item?.receivedAt || ''),
      messageType: String(item?.messageType || ''),
      callId: String(item?.callId || ''),
      payload: null,
    }),
    compactRuntimeSnapshotCallUpdate: (item) => ({
      callId: String(item?.callId || ''),
      updatedAt: String(item?.updatedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
      company: String(item?.company || ''),
      status: String(item?.status || ''),
      provider: String(item?.provider || ''),
    }),
    compactRuntimeSnapshotAiInsight: (item) => ({
      callId: String(item?.callId || ''),
      analyzedAt: String(item?.analyzedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
    }),
    compactRuntimeSnapshotDashboardActivity: (item) => ({
      id: String(item?.id || ''),
      createdAt: String(item?.createdAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
      type: String(item?.type || ''),
    }),
    compactRuntimeSnapshotSecurityAuditEvent: (item) => ({
      id: String(item?.id || ''),
      createdAt: String(item?.createdAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
      type: String(item?.type || ''),
    }),
    compactRuntimeSnapshotGeneratedAgendaAppointment: (item) => ({
      id: Number(item?.id || 0) || 0,
      callId: String(item?.callId || ''),
      updatedAt: String(item?.updatedAt || item?.createdAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
      company: String(item?.company || ''),
    }),
    normalizeLeadOwnerRecord: (value) =>
      value && value.key ? { key: String(value.key), name: String(value.name || '') } : null,
    recentWebhookEvents,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    leadOwnerAssignmentsByCallId,
    upsertRecentCallUpdate:
      overrides.upsertRecentCallUpdate ||
      ((callUpdate) => {
        const normalized = {
          ...callUpdate,
          callId: String(callUpdate?.callId || ''),
          updatedAtMs: Number(callUpdate?.updatedAtMs || 0) || 0,
        };
        const existingIdx = recentCallUpdates.findIndex((item) => item.callId === normalized.callId);
        if (existingIdx >= 0) {
          recentCallUpdates.splice(existingIdx, 1);
        }
        recentCallUpdates.unshift(normalized);
        callUpdatesById.set(normalized.callId, normalized);
        return normalized;
      }),
    logger: {
      log: (...args) => logs.push(['log', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    runtimeState,
  });

  return {
    agendaAppointmentIdByCallId,
    aiCallInsightsByCallId,
    callUpdatesById,
    coordinator,
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    generatedAgendaAppointments,
    leadOwnerAssignmentsByCallId,
    logs,
    persistedRows,
    recentAiCallInsights,
    recentCallUpdates,
    recentDashboardActivities,
    recentSecurityAuditEvents,
    recentWebhookEvents,
    runtimeState,
  };
}

test('runtime state sync coordinator applies snapshot payloads into in-memory runtime state', () => {
  const fixture = createFixture();

  const applied = fixture.coordinator.applyRuntimeStateSnapshotPayload(
    {
      savedAt: '2026-04-08T11:00:00.000Z',
      recentWebhookEvents: [
        { receivedAt: '2026-04-08T11:00:00.000Z', messageType: 'call.ended', callId: 'call-1' },
      ],
      recentCallUpdates: [
        { callId: 'call-1', updatedAt: '2026-04-08T11:00:00.000Z', updatedAtMs: 1100 },
      ],
      recentAiCallInsights: [
        { callId: 'call-1', analyzedAt: '2026-04-08T11:05:00.000Z', updatedAtMs: 1105 },
      ],
      recentDashboardActivities: [{ id: 'act-1', type: 'created', createdAt: '2026-04-08T11:10:00.000Z' }],
      recentSecurityAuditEvents: [{ id: 'sec-1', type: 'login', createdAt: '2026-04-08T11:11:00.000Z' }],
      generatedAgendaAppointments: [{ id: 44, callId: 'call-1', company: 'Alpha BV' }],
      dismissedInterestedLeadCallIds: ['call-1'],
      dismissedInterestedLeadKeys: ['lead-1'],
      leadOwnerAssignments: [{ callId: 'call-1', owner: { key: 'owner-1', name: 'Servé' } }],
      nextLeadOwnerRotationIndex: 7,
      nextGeneratedAgendaAppointmentId: 120000,
    },
    { updatedAt: '2026-04-08T11:15:00.000Z' }
  );

  assert.equal(applied, true);
  assert.equal(fixture.recentWebhookEvents.length, 1);
  assert.equal(fixture.recentCallUpdates.length, 1);
  assert.equal(fixture.callUpdatesById.get('call-1').callId, 'call-1');
  assert.equal(fixture.aiCallInsightsByCallId.get('call-1').callId, 'call-1');
  assert.equal(fixture.generatedAgendaAppointments.length, 1);
  assert.equal(fixture.agendaAppointmentIdByCallId.get('call-1'), 44);
  assert.equal(fixture.dismissedInterestedLeadCallIds.has('call-1'), true);
  assert.equal(fixture.dismissedInterestedLeadKeys.has('lead-1'), true);
  assert.equal(fixture.leadOwnerAssignmentsByCallId.get('call-1').key, 'owner-1');
  assert.equal(fixture.runtimeState.nextLeadOwnerRotationIndex, 7);
  assert.equal(fixture.runtimeState.nextGeneratedAgendaAppointmentId, 120000);
  assert.ok(fixture.runtimeState.runtimeStateObservedAtMs > 0);
});

test('runtime state sync coordinator hydrates from REST fallback and clears hydrate errors', async () => {
  const runtimeState = createRuntimeState({
    supabaseLastHydrateError: 'oude fout',
  });
  const fixture = createFixture({
    runtimeState,
    getSupabaseClient: () => ({
      from() {
        return {
          select(columns) {
            if (columns === 'payload, updated_at') {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: null, error: new Error('client stuk') }),
                  };
                },
              };
            }
            return {
              like() {
                return {
                  order() {
                    return {
                      limit: async () => ({ data: null, error: new Error('call rows client stuk') }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    }),
    fetchSupabaseStateRowViaRest: async () => ({
      ok: true,
      status: 200,
      body: [
        {
          updated_at: '2026-04-08T12:00:00.000Z',
          payload: {
            savedAt: '2026-04-08T12:00:00.000Z',
            recentWebhookEvents: [{ receivedAt: '2026-04-08T11:59:00.000Z', messageType: 'call.ended', callId: 'call-2' }],
            recentCallUpdates: [],
            recentAiCallInsights: [],
            recentDashboardActivities: [],
            recentSecurityAuditEvents: [],
            generatedAgendaAppointments: [{ id: 55, callId: 'call-2', company: 'Beta BV' }],
            dismissedInterestedLeadCallIds: [],
            dismissedInterestedLeadKeys: [],
            leadOwnerAssignments: [],
            nextLeadOwnerRotationIndex: 1,
            nextGeneratedAgendaAppointmentId: 100001,
          },
        },
      ],
    }),
    fetchSupabaseCallUpdateRowsViaRest: async () => ({ ok: true, status: 200, body: [] }),
  });

  const ok = await fixture.coordinator.ensureRuntimeStateHydratedFromSupabase();

  assert.equal(ok, true);
  assert.equal(fixture.runtimeState.supabaseStateHydrated, true);
  assert.equal(fixture.runtimeState.supabaseLastHydrateError, '');
  assert.equal(fixture.generatedAgendaAppointments.length, 1);
  assert.equal(fixture.generatedAgendaAppointments[0].id, 55);
});

test('runtime state sync coordinator treats queued runtime snapshot await as a no-op when Supabase is disabled', async () => {
  const fixture = createFixture({
    isSupabaseConfigured: false,
    runtimeState: createRuntimeState({
      supabasePersistChain: Promise.resolve(false),
    }),
  });

  const persisted = await fixture.coordinator.waitForQueuedRuntimeSnapshotPersist();

  assert.equal(persisted, true);
});

test('runtime state sync coordinator persists merged runtime snapshots and updates sync markers', async () => {
  const fixture = createFixture({
    recentCallUpdates: [
      {
        callId: 'call-local',
        updatedAt: '2026-04-08T10:00:00.000Z',
        updatedAtMs: 1000,
        company: 'Local BV',
      },
    ],
    fetchSupabaseStateRowViaRest: async () => ({
      ok: true,
      status: 200,
      body: [
        {
          updated_at: '2026-04-08T09:00:00.000Z',
          payload: {
            version: 5,
            savedAt: '2026-04-08T09:00:00.000Z',
            recentWebhookEvents: [
              { receivedAt: '2026-04-08T08:59:00.000Z', messageType: 'call.ended', callId: 'call-remote' },
            ],
            recentCallUpdates: [
              {
                callId: 'call-remote',
                updatedAt: '2026-04-08T08:59:00.000Z',
                updatedAtMs: 900,
                company: 'Remote BV',
              },
            ],
            recentAiCallInsights: [],
            recentDashboardActivities: [],
            recentSecurityAuditEvents: [],
            generatedAgendaAppointments: [],
            dismissedInterestedLeadCallIds: [],
            dismissedInterestedLeadKeys: [],
            leadOwnerAssignments: [],
            nextLeadOwnerRotationIndex: 2,
            nextGeneratedAgendaAppointmentId: 100010,
          },
        },
      ],
    }),
  });

  const ok = await fixture.coordinator.persistRuntimeStateToSupabase('contract_test');

  assert.equal(ok, true);
  assert.equal(fixture.runtimeState.supabaseStateHydrated, true);
  assert.equal(fixture.runtimeState.supabaseLastPersistError, '');
  assert.equal(fixture.persistedRows.length, 1);
  assert.equal(fixture.persistedRows[0].state_key, 'runtime_state_main');
  assert.equal(fixture.persistedRows[0].meta.reason, 'contract_test');
  assert.equal(fixture.persistedRows[0].payload.recentCallUpdates.length, 2);
  assert.equal(fixture.persistedRows[0].payload.recentWebhookEvents.length, 1);
  assert.ok(fixture.runtimeState.runtimeStateObservedAtMs > 0);
});

test('runtime state sync coordinator syncs newer remote state and queues call update row persists safely', async () => {
  const runtimeState = createRuntimeState({
    supabaseStateHydrated: true,
    runtimeStateObservedAtMs: 0,
  });
  const fixture = createFixture({
    runtimeState,
    getSupabaseClient: () => null,
    fetchSupabaseStateRowViaRest: async () => ({
      ok: true,
      status: 200,
      body: [
        {
          updated_at: '2026-04-08T14:00:00.000Z',
          payload: {
            savedAt: '2026-04-08T14:00:00.000Z',
            recentWebhookEvents: [],
            recentCallUpdates: [
              {
                callId: 'call-remote',
                updatedAt: '2026-04-08T14:00:00.000Z',
                updatedAtMs: 1400,
              },
            ],
            recentAiCallInsights: [],
            recentDashboardActivities: [],
            recentSecurityAuditEvents: [],
            generatedAgendaAppointments: [],
            dismissedInterestedLeadCallIds: [],
            dismissedInterestedLeadKeys: [],
            leadOwnerAssignments: [],
            nextLeadOwnerRotationIndex: 0,
            nextGeneratedAgendaAppointmentId: 100100,
          },
        },
      ],
    }),
    fetchSupabaseCallUpdateRowsViaRest: async () => ({
      ok: true,
      status: 200,
      body: [
        {
          payload: {
            callUpdate: {
              callId: 'call-rest',
              updatedAt: '2026-04-08T14:10:00.000Z',
              updatedAtMs: 1410,
              company: 'Rest BV',
            },
          },
        },
      ],
    }),
  });

  const synced = await fixture.coordinator.syncRuntimeStateFromSupabaseIfNewer({ force: true });
  const demoPersist = await fixture.coordinator.queueCallUpdateRowPersist({ callId: 'demo-call-1' });
  const livePersist = await fixture.coordinator.queueCallUpdateRowPersist(
    {
      callId: 'call-live-1',
      updatedAt: '2026-04-08T14:20:00.000Z',
      provider: 'retell',
    },
    'contract_row'
  );
  await fixture.coordinator.waitForQueuedCallUpdateRowPersist();

  assert.equal(synced, true);
  assert.equal(fixture.recentCallUpdates.some((item) => item.callId === 'call-remote'), true);
  assert.equal(fixture.recentCallUpdates.some((item) => item.callId === 'call-rest'), true);
  assert.equal(demoPersist, false);
  assert.equal(await livePersist, true);
  assert.equal(
    fixture.persistedRows.some((row) => row.state_key === 'call_update:call-live-1'),
    true
  );
});

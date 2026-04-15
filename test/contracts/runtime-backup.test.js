const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRuntimeBackupEnvelope,
  createRuntimeBackupCoordinator,
} = require('../../server/services/runtime-backup');

test('runtime backup envelope keeps rollback metadata and route manifest stable', () => {
  const payload = buildRuntimeBackupEnvelope({
    appName: 'softora',
    appVersion: '1.2.3',
    featureFlags: { runtimeBackupRouteEnabled: true },
    routeManifest: {
      criticalFlowChecklist: ['premium login'],
      pageSmokeTargets: [{ path: '/premium-personeel-login' }],
      contractTargets: [{ path: '/healthz', method: 'GET' }],
    },
    snapshotPayload: { version: 5 },
    metadata: { source: 'contract-test' },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.app.name, 'softora');
  assert.equal(payload.app.version, '1.2.3');
  assert.equal(payload.rollback.backupScript, 'npm run backup:runtime');
  assert.equal(payload.routeManifest.criticalFlowChecklist.length, 1);
  assert.equal(payload.snapshot.version, 5);
  assert.equal(payload.metadata.source, 'contract-test');
});

test('runtime backup coordinator builds compact snapshot payloads with stable limits', () => {
  const leadOwnerAssignmentsByCallId = new Map([
    ['call-1', { key: 'owner-1', name: 'Servé' }],
  ]);
  const dismissedInterestedLeadKeyUpdatedAtMsByKey = new Map([
    ['lead-1', Date.parse('2026-04-15T15:00:00.000Z')],
  ]);
  const coordinator = createRuntimeBackupCoordinator({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    parseNumberSafe: (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    toBooleanSafe: (value, fallback = false) => {
      if (value === true || value === false) return value;
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return fallback;
      return /^(1|true|yes|ja|on)$/.test(raw);
    },
    normalizeDateYyyyMmDd: (value) => String(value || '').trim().slice(0, 10),
    normalizeTimeHhMm: (value) => String(value || '').trim().slice(0, 5),
    resolveCallDurationSeconds: (item) => Number(item?.durationSeconds || 0) || null,
    normalizeLeadOwnerRecord: (value) =>
      value && value.key
        ? { key: String(value.key), name: String(value.name || '') }
        : null,
    recentWebhookEvents: Array.from({ length: 10 }, (_, index) => ({
      receivedAt: `2026-04-07T12:0${index}:00.000Z`,
      messageType: `type-${index + 1}`,
      callId: `call-${index + 1}`,
      payload: { ignored: true },
    })),
    recentCallUpdates: [
      {
        callId: 'call-1',
        company: 'Alpha BV',
        summary: 'x'.repeat(3000),
        updatedAt: '2026-04-07T12:00:00.000Z',
      },
      {
        callId: '',
        company: 'Wordt weggefilterd',
      },
    ],
    recentAiCallInsights: [
      {
        callId: 'call-1',
        company: 'Alpha BV',
        estimatedValueEur: '1200',
      },
    ],
    recentDashboardActivities: [
      {
        id: 'act-1',
        type: 'info',
        title: 'Nieuwe activiteit',
      },
    ],
    recentSecurityAuditEvents: [
      {
        id: 'sec-1',
        type: 'login',
        success: true,
      },
    ],
    generatedAgendaAppointments: [
      {
        id: 44,
        type: 'meeting',
        company: 'Alpha BV',
        date: '2026-04-08',
        time: '13:30',
        durationSeconds: 95,
        callId: 'call-1',
      },
    ],
    dismissedInterestedLeadCallIds: new Set(['call-1']),
    dismissedInterestedLeadKeys: new Set(['lead-1']),
    dismissedInterestedLeadKeyUpdatedAtMsByKey,
    leadOwnerAssignmentsByCallId,
    getNextLeadOwnerRotationIndex: () => 3,
    getNextGeneratedAgendaAppointmentId: () => 120000,
    appName: 'softora',
    appVersion: '1.0.0',
    getPublicFeatureFlags: () => ({ runtimeBackupRouteEnabled: true }),
    routeManifest: {
      criticalFlowChecklist: ['premium login'],
      pageSmokeTargets: [],
      contractTargets: [],
    },
  });

  const snapshot = coordinator.buildRuntimeStateSnapshotPayloadWithLimits({
    maxWebhookEvents: 3,
    maxCallUpdates: 2,
  });
  const backup = coordinator.buildRuntimeBackupForOps({
    metadata: { source: 'runtime-test' },
  });

  assert.equal(snapshot.recentWebhookEvents.length, 10);
  assert.equal(snapshot.recentCallUpdates.length, 1);
  assert.equal(snapshot.recentCallUpdates[0].summary.length, 1400);
  assert.equal(snapshot.generatedAgendaAppointments[0].durationSeconds, 95);
  assert.equal(
    snapshot.dismissedInterestedLeadKeyUpdatedAtMsByKey['lead-1'],
    Date.parse('2026-04-15T15:00:00.000Z')
  );
  assert.equal(snapshot.leadOwnerAssignments[0].owner.key, 'owner-1');
  assert.equal(snapshot.nextLeadOwnerRotationIndex, 3);
  assert.equal(snapshot.nextGeneratedAgendaAppointmentId, 120000);
  assert.equal(backup.ok, true);
  assert.equal(backup.app.name, 'softora');
  assert.equal(backup.metadata.source, 'runtime-test');
});

test('runtime backup coordinator builds and extracts compact supabase call update rows', () => {
  const coordinator = createRuntimeBackupCoordinator({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
  });

  const payload = coordinator.buildSupabaseCallUpdatePayload(
    {
      callId: 'call-42',
      company: 'Softora',
      updatedAt: '2026-04-07T12:00:00.000Z',
    },
    'manual_test'
  );
  const restored = coordinator.extractSupabaseCallUpdateFromRow(
    {
      state_key: 'call_update:call-42',
      updated_at: '2026-04-07T12:00:00.000Z',
      payload,
    },
    {
      extractCallIdFromStateKey: (value) => value.split(':').at(-1),
    }
  );

  assert.equal(payload.type, 'call_update');
  assert.equal(payload.reason, 'manual_test');
  assert.equal(restored.callId, 'call-42');
  assert.equal(restored.company, 'Softora');
});

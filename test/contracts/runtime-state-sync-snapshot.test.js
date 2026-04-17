const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRuntimeStateSnapshotHelpers,
} = require('../../server/services/runtime-state-sync-snapshot');

function createHelpers() {
  return createRuntimeStateSnapshotHelpers({
    normalizeString: (value) => String(value || '').trim(),
    normalizeLeadOwnerRecord: (value) =>
      value && value.key ? { key: String(value.key), name: String(value.name || '') } : null,
    compactRuntimeSnapshotWebhookEvent: (item) => item,
    compactRuntimeSnapshotCallUpdate: (item) => item,
    compactRuntimeSnapshotAiInsight: (item) => item,
    compactRuntimeSnapshotDashboardActivity: (item) => item,
    compactRuntimeSnapshotSecurityAuditEvent: (item) => item,
    compactRuntimeSnapshotGeneratedAgendaAppointment: (item) => item,
  });
}

test('runtime state snapshot helpers prefer richer newer appointment data during payload merge', () => {
  const helpers = createHelpers();

  const payload = helpers.mergeRuntimeSnapshotPayloads(
    {
      version: 5,
      recentWebhookEvents: [],
      recentCallUpdates: [],
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [
        {
          id: 77,
          callId: 'call-77',
          createdAt: '2026-04-16T17:29:00.000Z',
          updatedAtMs: 0,
          date: '2026-04-10',
          time: '09:00',
          location: 'Utrecht',
          needsConfirmationEmail: true,
          confirmationResponseReceived: false,
          confirmationResponseReceivedAt: '',
        },
      ],
      dismissedInterestedLeadCallIds: [],
      dismissedInterestedLeadKeys: [],
      leadOwnerAssignments: [],
      nextLeadOwnerRotationIndex: 0,
      nextGeneratedAgendaAppointmentId: 100100,
    },
    {
      version: 5,
      recentWebhookEvents: [],
      recentCallUpdates: [],
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [
        {
          id: 77,
          callId: 'call-77',
          createdAt: '2026-04-16T17:29:00.000Z',
          updatedAtMs: 0,
          date: '2026-04-22',
          time: '22:22',
          location: 'Amsterdam',
          needsConfirmationEmail: false,
          confirmationResponseReceived: true,
          confirmationResponseReceivedAt: '2026-04-16T19:22:00.000Z',
        },
      ],
      dismissedInterestedLeadCallIds: [],
      dismissedInterestedLeadKeys: [],
      leadOwnerAssignments: [],
      nextLeadOwnerRotationIndex: 0,
      nextGeneratedAgendaAppointmentId: 100500,
    }
  );

  assert.equal(payload.generatedAgendaAppointments.length, 1);
  assert.equal(payload.generatedAgendaAppointments[0].date, '2026-04-22');
  assert.equal(payload.generatedAgendaAppointments[0].time, '22:22');
  assert.equal(payload.generatedAgendaAppointments[0].location, 'Amsterdam');
  assert.equal(payload.generatedAgendaAppointments[0].confirmationResponseReceived, true);
  assert.equal(payload.nextGeneratedAgendaAppointmentId, 100500);
});

test('runtime state snapshot helpers merge dismissed lead timestamps and dedupe ids', () => {
  const helpers = createHelpers();

  const payload = helpers.mergeRuntimeSnapshotPayloads(
    {
      version: 5,
      recentWebhookEvents: [],
      recentCallUpdates: [],
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [],
      dismissedInterestedLeadCallIds: ['call-local', 'call-shared'],
      dismissedInterestedLeadKeys: ['lead-local', 'lead-shared'],
      dismissedInterestedLeadKeyUpdatedAtMsByKey: {
        'lead-local': 200,
        'lead-shared': 300,
      },
      leadOwnerAssignments: [],
      nextLeadOwnerRotationIndex: 0,
      nextGeneratedAgendaAppointmentId: 100000,
    },
    {
      version: 5,
      recentWebhookEvents: [],
      recentCallUpdates: [],
      recentAiCallInsights: [],
      recentDashboardActivities: [],
      recentSecurityAuditEvents: [],
      generatedAgendaAppointments: [],
      dismissedInterestedLeadCallIds: ['call-remote', 'call-shared'],
      dismissedInterestedLeadKeys: ['lead-remote', 'lead-shared'],
      dismissedInterestedLeadKeyUpdatedAtMsByKey: {
        'lead-remote': 400,
        'lead-shared': 250,
      },
      leadOwnerAssignments: [],
      nextLeadOwnerRotationIndex: 0,
      nextGeneratedAgendaAppointmentId: 100000,
    }
  );

  assert.deepEqual(payload.dismissedInterestedLeadCallIds, [
    'call-remote',
    'call-shared',
    'call-local',
  ]);
  assert.deepEqual(payload.dismissedInterestedLeadKeys, [
    'lead-remote',
    'lead-shared',
    'lead-local',
  ]);
  assert.equal(payload.dismissedInterestedLeadKeyUpdatedAtMsByKey['lead-remote'], 400);
  assert.equal(payload.dismissedInterestedLeadKeyUpdatedAtMsByKey['lead-shared'], 300);
  assert.equal(payload.dismissedInterestedLeadKeyUpdatedAtMsByKey['lead-local'], 200);
});

test('runtime state snapshot helpers resolve version timestamps from row or payload metadata', () => {
  const helpers = createHelpers();

  assert.equal(
    helpers.resolveRuntimeStateVersionMs('2026-04-17T10:00:00.000Z', null),
    Date.parse('2026-04-17T10:00:00.000Z')
  );
  assert.equal(
    helpers.resolveRuntimeStateVersionMs('', { savedAt: '2026-04-17T10:05:00.000Z' }),
    Date.parse('2026-04-17T10:05:00.000Z')
  );
  assert.equal(helpers.resolveRuntimeStateVersionMs('', {}), 0);
});

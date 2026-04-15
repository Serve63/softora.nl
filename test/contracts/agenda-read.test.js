const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaReadCoordinator } = require('../../server/services/agenda-read');

function normalizeString(value) {
  return String(value || '').trim();
}

function compareConfirmationTasks(a, b) {
  const aTs = Date.parse(normalizeString(a?.createdAt || '')) || 0;
  const bTs = Date.parse(normalizeString(b?.createdAt || '')) || 0;
  return bTs - aTs;
}

test('agenda read coordinator filters dismissed confirmation tasks for the full lead identity', async () => {
  const appointments = [
    {
      id: 11,
      confirmationTaskType: 'send_confirmation_email',
      callId: 'call-dismissed',
      company: 'Softora',
      contact: 'Serve Creusen',
      phone: '0612345678',
      createdAt: '2026-04-10T10:00:00.000Z',
    },
    {
      id: 12,
      confirmationTaskType: 'lead_follow_up',
      callId: 'call-visible',
      company: 'Andere Lead',
      contact: 'Testpersoon',
      phone: '0611111111',
      createdAt: '2026-04-10T09:00:00.000Z',
    },
  ];

  const coordinator = createAgendaReadCoordinator({
    runtimeSyncCooldownMs: 1000,
    demoConfirmationTaskEnabled: false,
    isSupabaseConfigured: () => false,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async () => false,
    isImapMailConfigured: () => false,
    syncInboundConfirmationEmailsFromImap: async () => {},
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {},
    refreshAgendaAppointmentCallSourcesIfNeeded: async () => {},
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded: () => {},
    refreshGeneratedAgendaSummariesIfNeeded: async () => {},
    getGeneratedAgendaAppointments: () => appointments,
    isGeneratedAppointmentVisibleForAgenda: () => true,
    compareAgendaAppointments: () => 0,
    mapAppointmentToConfirmationTask: (appointment) => ({
      ...appointment,
      type: normalizeString(appointment?.confirmationTaskType || appointment?.type || ''),
      title: 'Test',
    }),
    ensureConfirmationEmailDraftAtIndex: () => {},
    compareConfirmationTasks,
    buildAllInterestedLeadRows: () => [],
    isInterestedLeadDismissedForRow: (_callId, rowLike) => normalizeString(rowLike?.phone || '') === '0612345678',
    normalizeString,
  });

  const result = await coordinator.listConfirmationTasks({ limit: 20 });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].callId, 'call-visible');
});

test('agenda read coordinator forces a fresh shared-state sync for leads when requested', async () => {
  const syncCalls = [];
  const coordinator = createAgendaReadCoordinator({
    runtimeSyncCooldownMs: 4000,
    demoConfirmationTaskEnabled: false,
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async (options = {}) => {
      syncCalls.push(options);
      return false;
    },
    isImapMailConfigured: () => false,
    syncInboundConfirmationEmailsFromImap: async () => {},
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {},
    refreshAgendaAppointmentCallSourcesIfNeeded: async () => {},
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded: () => {},
    refreshGeneratedAgendaSummariesIfNeeded: async () => {},
    getGeneratedAgendaAppointments: () => [],
    isGeneratedAppointmentVisibleForAgenda: () => true,
    compareAgendaAppointments: () => 0,
    mapAppointmentToConfirmationTask: (appointment) => appointment,
    ensureConfirmationEmailDraftAtIndex: () => {},
    compareConfirmationTasks,
    buildAllInterestedLeadRows: () => [],
    isInterestedLeadDismissedForRow: () => false,
    normalizeString,
  });

  await coordinator.listConfirmationTasks({ limit: 20, freshSharedState: true });
  await coordinator.listInterestedLeads({ limit: 20, freshSharedState: true });

  assert.equal(syncCalls.length, 2);
  assert.equal(syncCalls[0]?.maxAgeMs, 0);
  assert.equal(syncCalls[1]?.maxAgeMs, 0);
});

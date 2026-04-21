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

test('agenda read coordinator hydrate dedicated dismissed-leads bij ELKE lees (Vercel multi-instance regressietest)', async () => {
  // Repro: warme instance B heeft sinds zijn cold start nooit meer remote
  // dismisses gezien. Zonder per-read hydrate blijven dismisses van instance A
  // onzichtbaar voor B, en re-appearen leads bij elke refresh.
  const dismissedFreshCalls = [];
  const coordinator = createAgendaReadCoordinator({
    runtimeSyncCooldownMs: 4000,
    demoConfirmationTaskEnabled: false,
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async () => false,
    ensureDismissedLeadsFreshFromSupabase: async (options = {}) => {
      dismissedFreshCalls.push(options);
      return true;
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

  await coordinator.listConfirmationTasks({ limit: 20 });
  await coordinator.listInterestedLeads({ limit: 20 });
  await coordinator.listInterestedLeads({ limit: 20, freshSharedState: true });

  assert.equal(dismissedFreshCalls.length, 3,
    'Elke lees-pas moet de dedicated dismissed-leads-tabel bevragen (binnen TTL)');
  assert.equal(dismissedFreshCalls[0]?.maxAgeMs, 2000,
    'Warm pad gebruikt korte TTL-dedupe');
  assert.equal(dismissedFreshCalls[1]?.maxAgeMs, 2000,
    'Warm pad gebruikt korte TTL-dedupe');
  assert.equal(dismissedFreshCalls[2]?.maxAgeMs, 0,
    'freshSharedState forceert directe hydrate zonder TTL');
});

test('agenda read coordinator listAppointments forceert fresh shared-state sync wanneer freshSharedState gevraagd (Vercel multi-instance: direct-zichtbare afspraken)', async () => {
  // Repro: gebruiker heeft zojuist een afspraak ingepland via /premium-leads
  // (instance A), navigeert direct naar /premium-personeel-agenda. De GET
  // /api/agenda/appointments landt op instance B die zijn lokale state nog
  // niet heeft gesynct. Zonder freshSharedState mist B de zojuist geschreven
  // appointment tot de cooldown (4s) afloopt. Met fresh=1 omzeilen we de
  // cooldown (maxAgeMs: 0) en ziet de gebruiker de afspraak direct.
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
    getGeneratedAgendaAppointments: () => [{ id: 1, date: '2026-04-16', time: '18:30' }],
    isGeneratedAppointmentVisibleForAgenda: () => true,
    compareAgendaAppointments: () => 0,
    mapAppointmentToConfirmationTask: (appointment) => appointment,
    ensureConfirmationEmailDraftAtIndex: () => {},
    compareConfirmationTasks,
    buildAllInterestedLeadRows: () => [],
    isInterestedLeadDismissedForRow: () => false,
    normalizeString,
  });

  await coordinator.listAppointments({ limit: 250 });
  await coordinator.listAppointments({ limit: 250, freshSharedState: true });

  assert.equal(syncCalls.length, 2);
  assert.equal(syncCalls[0]?.maxAgeMs, 4000,
    'Standaardpad (achtergrond-poll) gebruikt de cooldown TTL');
  assert.equal(syncCalls[1]?.maxAgeMs, 0,
    'freshSharedState=true (bv. bij focus/pageshow) omzeilt de cooldown');
});

test('agenda read coordinator falls back to current in-memory rows when preparation times out', async () => {
  const loggerCalls = [];
  const appointments = [
    {
      id: 31,
      confirmationTaskType: 'send_confirmation_email',
      callId: 'call-timeout-safe',
      company: 'Softora',
      contact: 'Serve',
      phone: '0600000000',
      createdAt: '2026-04-22T10:00:00.000Z',
    },
  ];
  const coordinator = createAgendaReadCoordinator({
    logger: {
      error: (...args) => loggerCalls.push(args),
    },
    readPreparationTimeoutMs: 5,
    runtimeSyncCooldownMs: 4000,
    demoConfirmationTaskEnabled: false,
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async () => new Promise(() => {}),
    ensureDismissedLeadsFreshFromSupabase: async () => true,
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
      type: normalizeString(appointment?.confirmationTaskType || ''),
      title: 'Timeout safe task',
    }),
    ensureConfirmationEmailDraftAtIndex: () => {},
    compareConfirmationTasks,
    buildAllInterestedLeadRows: () => [{ id: 'lead-timeout-safe' }],
    isInterestedLeadDismissedForRow: () => false,
    normalizeString,
  });

  const tasks = await coordinator.listConfirmationTasks({ limit: 20 });
  const leads = await coordinator.listInterestedLeads({ limit: 20 });

  assert.equal(tasks.ok, true);
  assert.equal(tasks.count, 1);
  assert.equal(tasks.tasks[0].callId, 'call-timeout-safe');
  assert.equal(leads.ok, true);
  assert.equal(leads.count, 1);
  assert.equal(
    loggerCalls.some((args) => args[0] === '[Agenda Read][PreparationTimeout]'),
    true
  );
});

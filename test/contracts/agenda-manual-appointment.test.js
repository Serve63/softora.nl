const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaManualAppointmentCoordinator } = require('../../server/services/agenda-manual-appointment');

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFixture(overrides = {}) {
  const appointments = overrides.appointments || [];
  const activityCalls = [];
  const coordinator = createAgendaManualAppointmentCoordinator({
    isSupabaseConfigured: () => false,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => true,
    syncRuntimeStateFromSupabaseIfNewer: async () => false,
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {},
    getGeneratedAgendaAppointments: () => appointments,
    getGeneratedAppointmentIndexById: (id) => appointments.findIndex((item) => Number(item.id) === Number(id)),
    setGeneratedAgendaAppointmentAtIndex: (idx, appointment) => {
      appointments[idx] = appointment;
      return appointment;
    },
    upsertGeneratedAgendaAppointment: (appointment) => {
      const persisted = { ...appointment, id: appointments.length + 1 };
      appointments.push(persisted);
      return persisted;
    },
    appendDashboardActivity: (activity, reason) => {
      activityCalls.push({ activity, reason });
    },
    buildRuntimeStateSnapshotPayload: () => null,
    applyRuntimeStateSnapshotPayload: () => false,
    waitForQueuedRuntimeSnapshotPersist: async () => true,
    invalidateSupabaseSyncTimestamp: () => {},
    normalizeString: (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd: (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''),
    normalizeTimeHhMm: (value) => (/^\d{2}:\d{2}$/.test(String(value || '')) ? String(value) : ''),
    sanitizeAppointmentLocation: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    createGoogleCalendarEventForAppointment: async () => ({ ok: true, skipped: true }),
    logger: { warn: () => {}, error: () => {} },
    ...overrides,
  });
  return { activityCalls, appointments, coordinator };
}

test('agenda manual appointment stores legend choice and activity time', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'serve',
        time: '10:00',
        activityTime: '10:30',
        legendChoice: 'business',
        activity: 'Klantbespreking',
        availableAgain: '12:00',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.manualActivityTime, '10:30');
  assert.equal(res.body.appointment.manualLegendChoice, 'business');
  assert.match(res.body.appointment.summary, /Tijdstip activiteit: 10:30/);
  assert.match(res.body.appointment.summary, /Legenda: business/);
});

test('agenda manual appointment stores stepped modal details', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'overig',
        title: 'Interne planning',
        time: '18:30',
        legendChoice: 'manual-overig',
        location: 'Kantoor',
        notes: 'Voorbereiden voor klantgesprek.',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.company, 'Interne planning');
  assert.equal(res.body.appointment.time, '18:30');
  assert.equal(res.body.appointment.location, 'Kantoor');
  assert.equal(res.body.appointment.manualActivityTime, '18:30');
  assert.equal(res.body.appointment.manualLegendChoice, 'manual-overig');
  assert.equal(res.body.appointment.manualNotes, 'Voorbereiden voor klantgesprek.');
  assert.match(res.body.appointment.summary, /Locatie: Kantoor/);
  assert.match(res.body.appointment.summary, /Opmerkingen: Voorbereiden voor klantgesprek\./);
});

test('agenda manual appointment can be assigned to Serve and Martijn together', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'both',
        title: 'Gezamenlijke klantmeeting',
        time: '14:00',
        legendChoice: 'business',
        location: 'Teams',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.manualPlannerWho, 'both');
  assert.match(res.body.appointment.summary, /Wie: Servé en Martijn/);
});

test('agenda manual meeting stores the selected lead owner separately from planner visibility', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        appointmentKind: 'meeting',
        who: 'both',
        manualLeadOwner: 'martijn',
        title: 'Website intake',
        time: '11:00',
        legendChoice: 'website',
        location: 'Klantlocatie',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.manualPlannerWho, 'both');
  assert.equal(res.body.appointment.manualLeadOwnerKey, 'martijn');
  assert.equal(res.body.appointment.manualLeadOwnerName, 'Martijn van de Ven');
  assert.equal(res.body.appointment.leadOwnerKey, 'martijn');
  assert.equal(res.body.appointment.leadOwnerName, 'Martijn van de Ven');
  assert.match(res.body.appointment.summary, /Wie: Servé en Martijn/);
  assert.match(res.body.appointment.summary, /Lead geregeld door: Martijn van de Ven/);
});

test('agenda manual meeting no longer requires a lead owner in the meeting wizard flow', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        appointmentKind: 'meeting',
        who: 'both',
        title: 'Website intake zonder eigenaar',
        time: '11:00',
        legendChoice: 'website',
        location: 'Klantlocatie',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.manualPlannerWho, 'both');
  assert.equal(res.body.appointment.manualLeadOwnerKey, '');
  assert.equal(res.body.appointment.leadOwnerKey, '');
  assert.match(res.body.appointment.summary, /Wie: Servé en Martijn/);
  assert.doesNotMatch(res.body.appointment.summary, /Lead geregeld door/);
});

test('agenda manual appointment does not block on initial shared-state hydration', async () => {
  let hydrateCalls = 0;
  let syncCalls = 0;
  const { coordinator } = createFixture({
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => false,
    forceHydrateRuntimeStateWithRetries: async () => {
      hydrateCalls += 1;
      return new Promise(() => {});
    },
    syncRuntimeStateFromSupabaseIfNewer: async () => {
      syncCalls += 1;
      return new Promise(() => {});
    },
    waitForQueuedRuntimeSnapshotPersist: async () => true,
  });
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'both',
        title: 'Snel overleg',
        time: '14:00',
        legendChoice: 'business',
        location: 'Kantoor',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(hydrateCalls, 0);
  assert.equal(syncCalls, 0);
});

test('agenda manual appointment responds when shared persistence is locally verified but still pending', async () => {
  let syncCalls = 0;
  const { coordinator } = createFixture({
    isSupabaseConfigured: () => true,
    waitForQueuedRuntimeSnapshotPersist: async () => false,
    syncRuntimeStateFromSupabaseIfNewer: async () => {
      syncCalls += 1;
      return new Promise(() => {});
    },
  });
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'serve',
        title: 'Persist pending test',
        time: '15:00',
        legendChoice: 'business',
        location: 'Kantoor',
      },
    },
    res
  );

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.persistencePending, true);
  assert.equal(syncCalls, 0);
});

test('agenda manual appointment does not wait indefinitely for Google Calendar export', async () => {
  const { coordinator } = createFixture({
    manualGoogleCalendarSyncTimeoutMs: 1,
    createGoogleCalendarEventForAppointment: async () => new Promise(() => {}),
  });
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'serve',
        title: 'Calendar timeout test',
        time: '16:00',
        legendChoice: 'business',
        location: 'Kantoor',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.googleCalendarSync.timedOut, true);
  assert.equal(res.body.googleCalendarSync.reason, 'google_calendar_sync_timeout');
});

test('agenda manual appointment delete removes appointment after confirmation request', async () => {
  const { activityCalls, appointments, coordinator } = createFixture({
    appointments: [
      {
        id: 77,
        callId: 'manual_77',
        company: 'Klantbespreking',
        date: '2026-04-28',
        time: '11:00',
      },
    ],
  });
  const res = createResponseRecorder();

  await coordinator.deleteAgendaAppointmentResponse(
    { body: { actor: 'softora-ios-agenda' } },
    res,
    '77'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deletedAppointmentId, 77);
  assert.equal(appointments.length, 0);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_manual_agenda_appointment_deleted');
});

test('agenda manual appointment delete returns 404 for missing appointment', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.deleteAgendaAppointmentResponse({ body: {} }, res, '999');

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /niet gevonden/i);
});

test('agenda manual appointment delete blocks other planner private appointments', async () => {
  const { appointments, coordinator } = createFixture({
    appointments: [
      {
        id: 88,
        company: 'Martijn privé afspraak',
        manualPlannerWho: 'martijn',
        manualLegendChoice: 'manual-overig',
        appointmentType: 'private',
        date: '2026-05-12',
        time: '10:30',
      },
    ],
  });
  const res = createResponseRecorder();

  await coordinator.deleteAgendaAppointmentResponse(
    {
      body: { actor: 'softora-ios-agenda' },
      premiumAuth: { email: 'serve@softora.nl', displayName: 'Servé Creusen' },
    },
    res,
    '88'
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /privé-afspraak van de ander/i);
  assert.equal(appointments.length, 1);
});

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
  const appointments = [];
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
    appendDashboardActivity: () => {},
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
  return { appointments, coordinator };
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

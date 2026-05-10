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
        phone: '06 12 34 56 78',
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
  assert.equal(res.body.appointment.phone, '06 12 34 56 78');
  assert.equal(res.body.appointment.manualPhone, '06 12 34 56 78');
  assert.equal(res.body.appointment.contactPhone, '06 12 34 56 78');
  assert.equal(res.body.appointment.location, 'Kantoor');
  assert.equal(res.body.appointment.manualActivityTime, '18:30');
  assert.equal(res.body.appointment.manualLegendChoice, 'manual-overig');
  assert.equal(res.body.appointment.appointmentKind, 'overig');
  assert.equal(res.body.appointment.manualNotes, 'Voorbereiden voor klantgesprek.');
  assert.match(res.body.appointment.summary, /Locatie: Kantoor/);
  assert.match(res.body.appointment.summary, /Telefoonnummer: 06 12 34 56 78/);
  assert.match(res.body.appointment.summary, /Opmerkingen: Voorbereiden voor klantgesprek\./);
});

test('agenda manual appointment can be edited after creation', async () => {
  const { appointments, coordinator } = createFixture();
  const createRes = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        who: 'serve',
        title: 'Oude afspraak',
        time: '10:00',
        legendChoice: 'manual-serve',
        location: 'Kantoor',
      },
    },
    createRes
  );

  const updateRes = createResponseRecorder();
  await coordinator.updateManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-29',
        who: 'martijn',
        title: 'Nieuwe afspraak',
        time: '11:30',
        activityTime: '11:30',
        legendChoice: 'private-martijn',
        appointmentKind: 'overig',
        phone: '06 98 76 54 32',
        location: 'Klantlocatie',
        notes: 'Nieuwe opmerkingen.',
      },
      params: { id: '1' },
      query: {},
    },
    updateRes,
    '1'
  );

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.ok, true);
  assert.equal(appointments.length, 1);
  assert.equal(updateRes.body.appointment.id, 1);
  assert.equal(updateRes.body.appointment.company, 'Nieuwe afspraak');
  assert.equal(updateRes.body.appointment.date, '2026-04-29');
  assert.equal(updateRes.body.appointment.time, '11:30');
  assert.equal(updateRes.body.appointment.phone, '06 98 76 54 32');
  assert.equal(updateRes.body.appointment.manualPlannerWho, 'martijn');
  assert.equal(updateRes.body.appointment.manualLegendChoice, 'private-martijn');
  assert.equal(updateRes.body.appointment.appointmentKind, 'overig');
  assert.match(updateRes.body.appointment.summary, /Wie: Martijn/);
  assert.match(updateRes.body.appointment.summary, /Telefoonnummer: 06 98 76 54 32/);
  assert.match(updateRes.body.appointment.summary, /Opmerkingen: Nieuwe opmerkingen\./);
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
  assert.equal(res.body.appointment.appointmentKind, 'meeting');
  assert.equal(res.body.appointment.manualPlannerWho, 'both');
  assert.equal(res.body.appointment.manualLeadOwnerKey, 'martijn');
  assert.equal(res.body.appointment.manualLeadOwnerName, 'Martijn van de Ven');
  assert.equal(res.body.appointment.leadOwnerKey, 'martijn');
  assert.equal(res.body.appointment.leadOwnerName, 'Martijn van de Ven');
  assert.match(res.body.appointment.summary, /Wie: Servé en Martijn/);
  assert.match(res.body.appointment.summary, /Lead geregeld door: Martijn van de Ven/);
});

test('agenda manual meeting requires a lead owner only for the new meeting wizard flow', async () => {
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

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Kies wie deze lead heeft geregeld/);
});

test('agenda manual business appointment stores as customer appointment without lead owner requirement', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.createManualAgendaAppointmentResponse(
    {
      body: {
        date: '2026-04-28',
        appointmentKind: 'appointment',
        manualBusinessType: 'appointment',
        who: 'both',
        title: 'Klantafspraak',
        time: '15:00',
        legendChoice: 'manual-both',
        location: 'Klantlocatie',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.appointmentKind, 'appointment');
  assert.equal(res.body.appointment.manualPlannerWho, 'both');
  assert.equal(res.body.appointment.manualLegendChoice, 'manual-both');
  assert.equal(res.body.appointment.manualLeadOwnerKey, '');
  assert.match(res.body.appointment.summary, /Wie: Servé en Martijn/);
  assert.match(res.body.appointment.summary, /Legenda: manual-both/);
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

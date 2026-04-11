const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaInterestedLeadsCoordinator } = require('../../server/services/agenda-interested-leads');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeDateYyyyMmDd(value) {
  const input = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : '';
}

function normalizeTimeHhMm(value) {
  const input = normalizeString(value);
  return /^\d{2}:\d{2}$/.test(input) ? input : '';
}

function sanitizeAppointmentLocation(value) {
  return normalizeString(value);
}

function sanitizeAppointmentWhatsappInfo(value) {
  return normalizeString(value);
}

function toBooleanSafe(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function normalizeEmailAddress(value) {
  return normalizeString(value).toLowerCase();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

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
  const agendaAppointmentIdByCallId = new Map(overrides.agendaAppointmentIdByCallId || []);
  const aiCallInsightsByCallId = new Map(
    overrides.aiCallInsightsByCallId || [
      [
        'call-1',
        {
          summary: 'Lead wil graag een afspraak.',
          estimatedValueEur: 3500,
          contactEmail: 'klant@voorbeeld.nl',
        },
      ],
    ]
  );
  const activityCalls = [];
  const dismissCalls = [];
  const hydrateCalls = [];
  const upsertCalls = [];
  const cancelCalls = [];
  const persistWaitCalls = [];
  const snapshotCalls = [];
  const applySnapshotCalls = [];

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, _reason) {
    appointments[idx] = {
      ...nextValue,
    };
    return appointments[idx];
  }

  const coordinator = createAgendaInterestedLeadsCoordinator({
    isSupabaseConfigured: () => Boolean(overrides.supabaseConfigured),
    getSupabaseStateHydrated: () => !overrides.supabaseConfigured || Boolean(overrides.supabaseHydrated),
    forceHydrateRuntimeStateWithRetries: async (times) => {
      hydrateCalls.push(times);
    },
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {},
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    toBooleanSafe,
    agendaAppointmentIdByCallId,
    getGeneratedAppointmentIndexById: (raw) =>
      appointments.findIndex((item) => Number(item?.id || 0) === Number(raw)),
    getGeneratedAgendaAppointments: () => appointments,
    findInterestedLeadRowByCallId:
      overrides.findInterestedLeadRowByCallId ||
      ((callId) =>
        callId === 'call-1'
          ? {
              callId: 'call-1',
              company: 'Softora',
              contact: 'Serve Creusen',
              phone: '0612345678',
              source: 'AI Cold Calling',
              summary: 'Lead toonde interesse in een nieuwe website.',
              leadOwnerKey: 'owner-1',
            }
          : null),
    getLatestCallUpdateByCallId:
      overrides.getLatestCallUpdateByCallId ||
      ((callId) =>
        callId === 'call-1'
          ? {
              callId: 'call-1',
              company: 'Softora',
              name: 'Serve Creusen',
              phone: '0612345678',
              summary: 'Lead wil een afspraak inplannen.',
              provider: 'retell',
            }
          : null),
    aiCallInsightsByCallId,
    buildGeneratedLeadFollowUpFromCall:
      overrides.buildGeneratedLeadFollowUpFromCall ||
      ((callUpdate) =>
        callUpdate
          ? {
              company: callUpdate.company,
              contact: callUpdate.name,
              phone: callUpdate.phone,
              summary: callUpdate.summary,
              source: 'AI Cold Calling (Lead opvolging)',
              provider: callUpdate.provider,
            }
          : null),
    normalizeColdcallingStack: (value) => normalizeString(value),
    getColdcallingStackLabel: () => 'Retell',
    buildLeadOwnerFields: (_callId, owner) =>
      owner
        ? {
            leadOwnerKey: normalizeString(owner.key),
            leadOwnerName: normalizeString(owner.displayName),
          }
        : {},
    normalizeEmailAddress,
    formatEuroLabel: (value) => (Number(value) > 0 ? `EUR ${Number(value)}` : ''),
    truncateText,
    resolveAppointmentLocation: () => '',
    resolveCallDurationSeconds: () => 180,
    resolvePreferredRecordingUrl: () => '',
    resolveAgendaLocationValue: (...values) => values.map((value) => normalizeString(value)).find(Boolean) || '',
    upsertGeneratedAgendaAppointment: (appointment, callId) => {
      upsertCalls.push({ appointment, callId });
      const persisted = {
        id: 501,
        ...appointment,
      };
      appointments[0] = persisted;
      agendaAppointmentIdByCallId.set(callId, persisted.id);
      return persisted;
    },
    buildLeadToAgendaSummary: async (_summary, location) => `Lead ingepland op ${location}`,
    setGeneratedAgendaAppointmentAtIndex,
    dismissInterestedLeadIdentity: (callId, rowLike, reason) => {
      dismissCalls.push({ callId, rowLike, reason });
    },
    appendDashboardActivity: (payload, reason) => {
      activityCalls.push({ payload, reason });
    },
    cancelOpenLeadFollowUpTasksByIdentity: (callId, rowLike, actor, reason) => {
      cancelCalls.push({ callId, rowLike, actor, reason });
      return 2;
    },
    buildRuntimeStateSnapshotPayload: () => {
      const snapshot = {
        savedAt: '2026-04-01T10:00:00.000Z',
        generatedAgendaAppointments: appointments.map((item) => ({ ...item })),
      };
      snapshotCalls.push(snapshot);
      return snapshot;
    },
    applyRuntimeStateSnapshotPayload: (snapshot, options) => {
      applySnapshotCalls.push({ snapshot, options });
      return true;
    },
    waitForQueuedRuntimeSnapshotPersist: async () => {
      persistWaitCalls.push('waited');
      return overrides.persistWaitResult !== undefined ? Boolean(overrides.persistWaitResult) : true;
    },
  });

  return {
    activityCalls,
    applySnapshotCalls,
    appointments,
    cancelCalls,
    coordinator,
    dismissCalls,
    hydrateCalls,
    persistWaitCalls,
    snapshotCalls,
    upsertCalls,
  };
}

test('agenda interested leads coordinator materializes a lead into the agenda', async () => {
  const { activityCalls, appointments, coordinator, dismissCalls, persistWaitCalls, upsertCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route door',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.taskCompleted, true);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].callId, 'call-1');
  assert.equal(appointments[0].id, 501);
  assert.equal(appointments[0].date, '2026-04-10');
  assert.equal(appointments[0].time, '14:30');
  assert.equal(appointments[0].location, 'Amsterdam');
  assert.equal(appointments[0].summary, 'Lead ingepland op Amsterdam');
  assert.equal(appointments[0].confirmationResponseReceived, true);
  assert.equal(dismissCalls[0].reason, 'interested_lead_set_in_agenda_dismiss');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_interested_lead_set_in_agenda');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

test('agenda interested leads coordinator dismisses a lead and cancels open follow-up tasks', async () => {
  const { activityCalls, cancelCalls, coordinator, dismissCalls, persistWaitCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dismissed, true);
  assert.equal(res.body.cancelledTasks, 2);
  assert.equal(dismissCalls[0].reason, 'interested_lead_dismissed_manual');
  assert.equal(cancelCalls[0].reason, 'interested_lead_dismissed_manual_cancel');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_interested_lead_removed');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

test('agenda interested leads coordinator hydrates first when supabase runtime is configured but cold', async () => {
  const { coordinator, hydrateCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: false,
  });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(hydrateCalls, [3]);
});

test('agenda interested leads coordinator rejects dismissal when shared Supabase persist fails', async () => {
  const { activityCalls, applySnapshotCalls, cancelCalls, coordinator, dismissCalls, persistWaitCalls, snapshotCalls } =
    createFixture({
      supabaseConfigured: true,
      supabaseHydrated: true,
      persistWaitResult: false,
    });
  const res = createResponseRecorder();

  await coordinator.dismissInterestedLeadResponse(
    {
      body: {
        callId: 'call-1',
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /gedeelde opslag/);
  assert.equal(dismissCalls.length, 1);
  assert.equal(cancelCalls.length, 1);
  assert.equal(activityCalls.length, 1);
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.equal(snapshotCalls.length, 1);
  assert.equal(applySnapshotCalls.length, 1);
});

test('agenda interested leads coordinator rejects set-in-agenda when shared Supabase persist fails', async () => {
  const { applySnapshotCalls, coordinator, persistWaitCalls, snapshotCalls, upsertCalls } = createFixture({
    supabaseConfigured: true,
    supabaseHydrated: true,
    persistWaitResult: false,
  });
  const res = createResponseRecorder();

  await coordinator.setInterestedLeadInAgendaResponse(
    {
      body: {
        callId: 'call-1',
        appointmentDate: '2026-04-10',
        appointmentTime: '14:30',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route door',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /gedeelde opslag/);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(persistWaitCalls, ['waited']);
  assert.equal(snapshotCalls.length, 1);
  assert.equal(applySnapshotCalls.length, 1);
});

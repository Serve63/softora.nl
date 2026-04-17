const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createAgendaRetellCoordinator } = require('../../server/services/agenda-retell');

function signRetellBody(rawBody, apiKey = 'retell-key') {
  const timestamp = Date.now();
  const digest = crypto.createHmac('sha256', apiKey).update(`${rawBody}${timestamp}`).digest('hex');
  return `v=${timestamp},d=${digest}`;
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

function createHeaderReader(headers = {}) {
  const normalized = Object.create(null);
  Object.keys(headers).forEach((key) => {
    normalized[String(key).toLowerCase()] = headers[key];
  });
  return (name) => normalized[String(name).toLowerCase()] || '';
}

function createFixture(overrides = {}) {
  const appointments = Array.isArray(overrides.appointments) ? overrides.appointments : [];
  const idByCallId = new Map(
    appointments
      .filter((appointment) => appointment && appointment.callId)
      .map((appointment) => [String(appointment.callId), Number(appointment.id || 0)])
  );
  let nextId = appointments.reduce((max, appointment) => Math.max(max, Number(appointment?.id || 0)), 0) + 1;
  const activityEvents = [];

  function getGeneratedAppointmentIndexById(rawId) {
    const id = Number(rawId || 0);
    return appointments.findIndex((appointment) => Number(appointment?.id || 0) === id);
  }

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue) {
    appointments[idx] = { ...nextValue };
    if (appointments[idx]?.callId) {
      idByCallId.set(String(appointments[idx].callId), Number(appointments[idx].id || 0));
    }
    return appointments[idx];
  }

  function upsertGeneratedAgendaAppointment(appointment, callId) {
    const normalizedCallId = String(callId || '').trim();
    const existingId = idByCallId.get(normalizedCallId);
    if (existingId) {
      const idx = getGeneratedAppointmentIndexById(existingId);
      if (idx >= 0) {
        appointments[idx] = {
          ...appointments[idx],
          ...appointment,
          id: existingId,
        };
        return appointments[idx];
      }
    }

    const created = {
      id: nextId++,
      ...appointment,
      callId: normalizedCallId,
    };
    appointments.push(created);
    idByCallId.set(normalizedCallId, created.id);
    return created;
  }

  const coordinator = createAgendaRetellCoordinator({
    env: {
      RETELL_API_KEY: 'retell-key',
      ...overrides.env,
    },
    getGeneratedAgendaAppointments: () => appointments,
    isGeneratedAppointmentVisibleForAgenda: (appointment) => !appointment?.hidden,
    compareAgendaAppointments: (left, right) =>
      `${left?.date || ''}T${left?.time || ''}`.localeCompare(`${right?.date || ''}T${right?.time || ''}`),
    getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex,
    upsertGeneratedAgendaAppointment,
    buildLeadToAgendaSummary: async (summary, location, whatsappInfo, options = {}) =>
      [summary, location, whatsappInfo, options.whatsappConfirmed ? 'whatsapp bevestigd' : '']
        .filter(Boolean)
        .join(' | '),
    getLatestCallUpdateByCallId: (callId) =>
      overrides.callUpdatesById && overrides.callUpdatesById[callId]
        ? overrides.callUpdatesById[callId]
        : null,
    aiCallInsightsByCallId: new Map(Object.entries(overrides.aiInsightsByCallId || {})),
    normalizeString: (value) => String(value ?? '').trim(),
    normalizeDateYyyyMmDd: (value) => String(value ?? '').trim(),
    normalizeTimeHhMm: (value) => String(value ?? '').trim(),
    sanitizeAppointmentLocation: (value) => String(value ?? '').trim(),
    sanitizeAppointmentWhatsappInfo: (value) => String(value ?? '').trim(),
    normalizeEmailAddress: (value) => String(value ?? '').trim().toLowerCase(),
    toBooleanSafe: (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    normalizeColdcallingStack: (value) => String(value ?? '').trim().toLowerCase(),
    getColdcallingStackLabel: (value) => (String(value || '').trim() === 'retell_ai' ? 'Retell AI' : ''),
    buildLeadOwnerFields: () => ({
      leadOwnerKey: 'serve',
      leadOwnerName: 'Servé',
      leadOwnerFullName: 'Servé Creusen',
      leadOwnerUserId: 'user-1',
      leadOwnerEmail: 'serve@softora.nl',
    }),
    resolveAppointmentLocation: (...sources) =>
      sources
        .map((source) => String(source?.location || source?.appointmentLocation || source?.address || '').trim())
        .find(Boolean) || '',
    resolveCallDurationSeconds: () => 0,
    resolvePreferredRecordingUrl: () => '',
    formatEuroLabel: (value) => (value ? `EUR ${value}` : ''),
    appendDashboardActivity: (payload, reason) => activityEvents.push({ payload, reason }),
    buildRuntimeStateSnapshotPayload: () => ({ savedAt: '2099-04-18T09:00:00.000Z' }),
    applyRuntimeStateSnapshotPayload: () => true,
    waitForQueuedRuntimeSnapshotPersist: async () => true,
    invalidateSupabaseSyncTimestamp: () => {},
    ...overrides.coordinatorOverrides,
  });

  return {
    activityEvents,
    appointments,
    coordinator,
  };
}

test('agenda retell coordinator returns next free agenda slots after an occupied requested time', async () => {
  const { coordinator } = createFixture({
    appointments: [
      { id: 1, callId: 'call-a', date: '2099-04-20', time: '10:00' },
      { id: 2, callId: 'call-b', date: '2099-04-20', time: '11:00' },
    ],
  });

  const rawBody = JSON.stringify({
    args: {
      date: '2099-04-20',
      time: '10:00',
      slotMinutes: 60,
      businessHoursStart: '09:00',
      businessHoursEnd: '13:00',
      maxSuggestions: 1,
    },
  });
  const req = {
    rawBody,
    body: {
      retellFunctionName: 'check_softora_agenda',
      preferredDate: '2099-04-20',
      preferredTime: '10:00',
      slotMinutes: 60,
      businessHoursStart: '09:00',
      businessHoursEnd: '13:00',
      maxSuggestions: 1,
    },
    get: createHeaderReader({
      'x-retell-signature': signRetellBody(rawBody),
    }),
  };
  const res = createResponseRecorder();

  await coordinator.sendRetellAgendaAvailabilityResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.available, false);
  assert.deepEqual(res.body.occupiedSlotsOnRequestedDate, ['10:00', '11:00']);
  assert.deepEqual(
    res.body.availableSlots.map((slot) => slot.time),
    ['12:00']
  );
  assert.match(res.body.message, /niet beschikbaar/i);
});

test('agenda retell coordinator books an appointment and persists the normalized agenda state', async () => {
  const { activityEvents, appointments, coordinator } = createFixture({
    callUpdatesById: {
      call_123: {
        callId: 'call_123',
        company: 'Softora Prospect',
        name: 'Ruben Prospect',
        phone: '+31612345678',
        summary: 'Prospect wil een afspraak.',
      },
    },
  });

  const rawBody = JSON.stringify({
    name: 'book_softora_appointment',
    call: {
      call_id: 'call_123',
      direction: 'outbound',
      to_number: '+31612345678',
      metadata: {
        leadCompany: 'Softora Prospect',
        leadName: 'Ruben Prospect',
        contactEmail: 'prospect@example.com',
      },
    },
    args: {
      date: '2099-04-21',
      time: '14:30',
      location: 'Keizersgracht 12, Amsterdam',
      summary: 'Demo website en vervolgafspraak bevestigd.',
      whatsappInfo: 'Stuur route via WhatsApp',
      whatsappConfirmed: true,
    },
  });
  const req = {
    rawBody,
    body: {
      retellFunctionName: 'book_softora_appointment',
      retellCall: {
        call_id: 'call_123',
        direction: 'outbound',
        to_number: '+31612345678',
        metadata: {
          leadCompany: 'Softora Prospect',
          leadName: 'Ruben Prospect',
          contactEmail: 'prospect@example.com',
        },
      },
      callId: 'call_123',
      appointmentDate: '2099-04-21',
      appointmentTime: '14:30',
      date: '2099-04-21',
      time: '14:30',
      location: 'Keizersgracht 12, Amsterdam',
      summary: 'Demo website en vervolgafspraak bevestigd.',
      whatsappInfo: 'Stuur route via WhatsApp',
      whatsappConfirmed: true,
    },
    get: createHeaderReader({
      'x-retell-signature': signRetellBody(rawBody),
    }),
  };
  const res = createResponseRecorder();

  await coordinator.bookRetellAgendaAppointmentResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].callId, 'call_123');
  assert.equal(appointments[0].date, '2099-04-21');
  assert.equal(appointments[0].time, '14:30');
  assert.equal(appointments[0].location, 'Keizersgracht 12, Amsterdam');
  assert.equal(appointments[0].confirmationResponseReceived, true);
  assert.equal(appointments[0].confirmationEmailSent, true);
  assert.equal(appointments[0].contactEmail, 'prospect@example.com');
  assert.match(appointments[0].summary, /Keizersgracht 12, Amsterdam/);
  assert.equal(activityEvents.length, 1);
  assert.equal(activityEvents[0].payload.type, 'retell_appointment_booked');
});

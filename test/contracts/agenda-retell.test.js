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

  const coordinator = createAgendaRetellCoordinator({
    env: {
      RETELL_API_KEY: 'retell-key',
      ...overrides.env,
    },
    getGeneratedAgendaAppointments: () => appointments,
    isGeneratedAppointmentVisibleForAgenda: (appointment) => !appointment?.hidden,
    compareAgendaAppointments: (left, right) =>
      `${left?.date || ''}T${left?.time || ''}`.localeCompare(`${right?.date || ''}T${right?.time || ''}`),
    normalizeString: (value) => String(value ?? '').trim(),
    normalizeDateYyyyMmDd: (value) => String(value ?? '').trim(),
    normalizeTimeHhMm: (value) => String(value ?? '').trim(),
    ...overrides.coordinatorOverrides,
  });

  return {
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
  assert.equal(res.body.availabilityReason, 'occupied');
  assert.deepEqual(res.body.occupiedSlotsOnRequestedDate, ['10:00', '11:00']);
  assert.deepEqual(
    res.body.availableSlots.map((slot) => slot.time),
    ['12:00']
  );
  assert.match(res.body.message, /om 10:00 staat al een afspraak/i);
});

test('agenda retell coordinator keeps suggestions within monday to friday office hours', async () => {
  const { coordinator } = createFixture();

  const rawBody = JSON.stringify({
    args: {
      date: '2099-04-20',
      time: '18:15',
      slotMinutes: 60,
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      maxSuggestions: 2,
      windowDays: 5,
    },
  });
  const req = {
    rawBody,
    body: {
      retellFunctionName: 'check_softora_agenda',
      preferredDate: '2099-04-20',
      preferredTime: '18:15',
      slotMinutes: 60,
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      maxSuggestions: 2,
      windowDays: 5,
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
  assert.equal(res.body.availabilityReason, 'outside_business_hours');
  assert.deepEqual(res.body.constraints.businessDays, [
    'maandag',
    'dinsdag',
    'woensdag',
    'donderdag',
    'vrijdag',
  ]);
  assert.ok(res.body.availableSlots.every((slot) => ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'].includes(slot.time)));
  assert.ok(res.body.availableSlots.every((slot) => !/zaterdag|zondag/i.test(slot.label)));
  assert.match(res.body.message, /alleen tussen 09:00 en 17:00/i);
});

test('agenda retell coordinator explains weekend dates with weekday alternatives', async () => {
  const { coordinator } = createFixture();

  const rawBody = JSON.stringify({
    args: {
      date: '2099-04-18',
      slotMinutes: 60,
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      maxSuggestions: 2,
      windowDays: 5,
    },
  });
  const req = {
    rawBody,
    body: {
      retellFunctionName: 'check_softora_agenda',
      preferredDate: '2099-04-18',
      slotMinutes: 60,
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      maxSuggestions: 2,
      windowDays: 5,
    },
    get: createHeaderReader({
      'x-retell-signature': signRetellBody(rawBody),
    }),
  };
  const res = createResponseRecorder();

  await coordinator.sendRetellAgendaAvailabilityResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.available, true);
  assert.equal(res.body.availabilityReason, 'outside_business_days');
  assert.ok(res.body.availableSlots.length > 0);
  assert.ok(res.body.availableSlots.every((slot) => !/zaterdag|zondag/i.test(slot.label)));
  assert.match(res.body.message, /alleen van maandag t\/m vrijdag/i);
});

test('agenda retell coordinator refreshes shared state without waiting on persist queue', async () => {
  const syncCalls = [];
  const { coordinator } = createFixture({
    coordinatorOverrides: {
      isSupabaseConfigured: () => true,
      getSupabaseStateHydrated: () => true,
      syncRuntimeStateFromSupabaseIfNewer: async (options = {}) => {
        syncCalls.push(options);
        return false;
      },
    },
  });

  const rawBody = JSON.stringify({
    args: {
      date: '2099-04-20',
      time: '10:00',
    },
  });
  const req = {
    rawBody,
    body: {
      retellFunctionName: 'check_softora_agenda',
      preferredDate: '2099-04-20',
      preferredTime: '10:00',
    },
    get: createHeaderReader({
      'x-retell-signature': signRetellBody(rawBody),
    }),
  };
  const res = createResponseRecorder();

  await coordinator.sendRetellAgendaAvailabilityResponse(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(syncCalls.length, 1);
  assert.deepEqual(syncCalls[0], {
    force: false,
    maxAgeMs: 0,
    skipPendingPersistWait: true,
  });
});

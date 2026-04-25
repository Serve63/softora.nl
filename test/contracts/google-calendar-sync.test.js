const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createGoogleCalendarSyncService } = require('../../server/services/google-calendar-sync');

function createPrivateKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function createService(overrides = {}) {
  const appointments = [];
  const setCalls = [];
  const fetchCalls = [];
  const service = createGoogleCalendarSyncService({
    config: {
      enabled: true,
      clientEmail: 'calendar-sync@example.iam.gserviceaccount.com',
      privateKey: createPrivateKeyPem(),
      serveCalendarId: 'serve-calendar@example.com',
      martijnCalendarId: 'martijn-calendar@example.com',
      timezone: 'Europe/Amsterdam',
      syncCooldownMs: 10000,
      ...overrides.config,
    },
    fetchImpl: async (url, request = {}) => {
      fetchCalls.push({ url, request });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'google-token', expires_in: 3600 }),
        };
      }
      if (request.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'created-event-1',
            htmlLink: 'https://calendar.google.com/event?eid=created',
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: overrides.events || [
            {
              id: 'event-1',
              summary: 'Klantmeeting Google',
              location: 'Stationsplein 1, Utrecht',
              description: 'Bespreking vanuit Google Calendar',
              htmlLink: 'https://calendar.google.com/event?eid=event-1',
              start: { dateTime: '2026-04-28T10:30:00+02:00' },
              end: { dateTime: '2026-04-28T11:15:00+02:00' },
            },
          ],
        }),
      };
    },
    upsertGeneratedAgendaAppointment: (appointment) => {
      appointments.push(appointment);
      return appointment;
    },
    getGeneratedAppointmentIndexById: () => 0,
    setGeneratedAgendaAppointmentAtIndex: (idx, appointment, reason) => {
      setCalls.push({ idx, appointment, reason });
      return appointment;
    },
    normalizeString: (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd: (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''),
    normalizeTimeHhMm: (value) => (/^\d{2}:\d{2}$/.test(String(value || '')) ? String(value) : ''),
    sanitizeAppointmentLocation: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now: () => new Date('2026-04-24T12:00:00.000Z'),
  });
  return { appointments, fetchCalls, service, setCalls };
}

test('google calendar sync imports Serve and Martijn events as agenda appointments', async () => {
  const { appointments, service } = createService();

  const result = await service.syncGoogleCalendarEvents({ force: true });

  assert.equal(result.ok, true);
  assert.equal(result.imported, 2);
  assert.equal(appointments.length, 2);
  assert.equal(appointments[0].callId, 'google_calendar_serve_event-1');
  assert.equal(appointments[0].company, 'Klantmeeting Google');
  assert.equal(appointments[0].date, '2026-04-28');
  assert.equal(appointments[0].time, '10:30');
  assert.equal(appointments[0].manualPlannerWho, 'serve');
  assert.equal(appointments[1].manualPlannerWho, 'martijn');
});

test('google calendar sync exports manual appointments to the selected owner calendar', async () => {
  const { fetchCalls, service, setCalls } = createService();

  const result = await service.createGoogleCalendarEventForAppointment({
    id: 88,
    callId: 'manual_88',
    company: 'Werkblok Martijn',
    date: '2026-04-29',
    time: '13:00',
    manualAvailableAgain: '15:00',
    manualPlannerWho: 'martijn',
    location: 'Kantoor',
    summary: 'Werkblok Martijn\n\nWie: Martijn',
  });

  assert.equal(result.ok, true);
  const createCall = fetchCalls.find((call) => call.request.method === 'POST' && String(call.url).includes('/events'));
  assert.ok(createCall);
  assert.match(String(createCall.url), /martijn-calendar%40example\.com/);
  const body = JSON.parse(createCall.request.body);
  assert.equal(body.summary, 'Werkblok Martijn');
  assert.equal(body.start.dateTime, '2026-04-29T13:00:00');
  assert.equal(body.end.dateTime, '2026-04-29T15:00:00');
  assert.equal(setCalls[0].reason, 'google_calendar_manual_export');
  assert.equal(setCalls[0].appointment.googleCalendarEventId, 'created-event-1');
});

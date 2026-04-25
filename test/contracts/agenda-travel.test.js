const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaTravelService } = require('../../server/services/agenda-travel');

function createTravelService(overrides = {}) {
  return createAgendaTravelService({
    env: {
      GOOGLE_MAPS_SERVER_API_KEY: 'maps-key',
      ...overrides.env,
    },
    fetchJsonWithTimeout:
      overrides.fetchJsonWithTimeout ||
      (async (url) => {
        if (String(url).includes('computeRoutes')) {
          return {
            response: { ok: true },
            data: {
              routes: [{ duration: '4200s', staticDuration: '3600s', distanceMeters: 81000 }],
            },
          };
        }
        return {
          response: { ok: true },
          data: { results: [] },
        };
      }),
    normalizeString: (value) => String(value ?? '').trim(),
    normalizeDateYyyyMmDd: (value) => String(value ?? '').trim(),
    normalizeTimeHhMm: (value) => String(value ?? '').trim(),
    sanitizeAppointmentLocation: (value) => String(value ?? '').trim(),
  });
}

test('agenda travel service blocks a slot when travel from the previous appointment makes it impossible', async () => {
  const travelService = createTravelService();

  const result = await travelService.evaluateSlotTravelFeasibility({
    appointments: [
      {
        id: 1,
        date: '2099-04-20',
        time: '10:00',
        location: 'Oosterwijk',
        locationLat: 52.084,
        locationLng: 5.121,
        manualPlannerWho: 'serve',
        summary: 'Weer thuis, beschikbaar voor een reis naar prospect: 11:15',
      },
    ],
    requestedDate: '2099-04-20',
    requestedTime: '12:00',
    requestedLocation: {
      location: 'Amsterdam',
      locationLat: 52.3676,
      locationLng: 4.9041,
    },
    planner: 'serve',
    slotMinutes: 60,
    travelBufferMinutes: 15,
    timeZone: 'Europe/Amsterdam',
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'travel_from_previous');
  assert.equal(result.details?.appointment?.location, 'Oosterwijk');
  assert.equal(result.details?.departureTime, '11:15');
  assert.equal(result.details?.requiredArrivalTime, '12:40');
});

test('agenda travel service blocks a slot when it would make the next appointment unreachable', async () => {
  const travelService = createTravelService({
    fetchJsonWithTimeout: async (url) => {
      if (String(url).includes('computeRoutes')) {
        return {
          response: { ok: true },
          data: {
            routes: [{ duration: '4800s', staticDuration: '4200s', distanceMeters: 96000 }],
          },
        };
      }
      return {
        response: { ok: true },
        data: { results: [] },
      };
    },
  });

  const result = await travelService.evaluateSlotTravelFeasibility({
    appointments: [
      {
        id: 2,
        date: '2099-04-20',
        time: '12:00',
        location: 'Amsterdam',
        locationLat: 52.3676,
        locationLng: 4.9041,
        manualPlannerWho: 'serve',
      },
    ],
    requestedDate: '2099-04-20',
    requestedTime: '10:00',
    requestedLocation: {
      location: 'Oosterwijk',
      locationLat: 52.084,
      locationLng: 5.121,
    },
    planner: 'serve',
    slotMinutes: 60,
    travelBufferMinutes: 15,
    timeZone: 'Europe/Amsterdam',
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'travel_to_next');
  assert.equal(result.details?.appointment?.time, '12:00');
  assert.equal(result.details?.requiredArrivalTime, '12:35');
});

test('agenda travel service treats shared appointments as blocking Serve and Martijn', async () => {
  const travelService = createTravelService();

  const result = await travelService.evaluateSlotTravelFeasibility({
    appointments: [
      {
        id: 3,
        date: '2099-04-20',
        time: '10:00',
        location: 'Oosterwijk',
        locationLat: 52.084,
        locationLng: 5.121,
        manualPlannerWho: 'both',
        summary: 'Weer thuis, beschikbaar voor een reis naar prospect: 11:15',
      },
    ],
    requestedDate: '2099-04-20',
    requestedTime: '12:00',
    requestedLocation: {
      location: 'Amsterdam',
      locationLat: 52.3676,
      locationLng: 4.9041,
    },
    planner: 'martijn',
    slotMinutes: 60,
    travelBufferMinutes: 15,
    timeZone: 'Europe/Amsterdam',
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'travel_from_previous');
});

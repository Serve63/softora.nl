const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaPageBootstrapService } = require('../../server/services/agenda-page-bootstrap');

test('agenda page bootstrap service returns visible sorted appointments and hydrates when needed', async () => {
  let hydrateCalls = 0;

  const service = createAgendaPageBootstrapService({
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => false,
    forceHydrateRuntimeStateWithRetries: async (attempts) => {
      hydrateCalls += attempts;
    },
    getGeneratedAgendaAppointments: () => [
      { id: 3, date: '2026-04-12', time: '14:00', hidden: false },
      { id: 1, date: '2026-04-10', time: '09:00', hidden: false },
      { id: 2, date: '2026-04-11', time: '11:30', hidden: true },
    ],
    isGeneratedAppointmentVisibleForAgenda: (appointment) => appointment?.hidden !== true,
    compareAgendaAppointments: (a, b) =>
      `${a?.date || ''}T${a?.time || ''}`.localeCompare(`${b?.date || ''}T${b?.time || ''}`),
  });

  const payload = await service.buildAgendaBootstrapPayload({ limit: 2 });

  assert.equal(hydrateCalls, 3);
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.appointments), true);
  assert.equal(payload.appointments.length, 2);
  assert.deepEqual(
    payload.appointments.map((item) => item.id),
    [1, 3]
  );
  assert.match(String(payload.loadedAt || ''), /^\d{4}-\d{2}-\d{2}T/);
});

test('agenda page bootstrap voegt googleMapsPlacesKey toe wanneer geconfigureerd', async () => {
  const service = createAgendaPageBootstrapService({
    isSupabaseConfigured: () => false,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async () => false,
    getGeneratedAgendaAppointments: () => [],
    isGeneratedAppointmentVisibleForAgenda: () => true,
    compareAgendaAppointments: () => 0,
    getGoogleMapsPlacesBrowserKey: () => 'test-browser-key',
  });

  const payload = await service.buildAgendaBootstrapPayload({ limit: 5 });

  assert.equal(payload.googleMapsPlacesKey, 'test-browser-key');
});

test('agenda page bootstrap service skips hydration when supabase state is already warm', async () => {
  let hydrated = false;

  const service = createAgendaPageBootstrapService({
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {
      hydrated = true;
    },
    getGeneratedAgendaAppointments: () => [{ id: 11, date: '2026-04-08', time: '10:00' }],
    isGeneratedAppointmentVisibleForAgenda: () => true,
    compareAgendaAppointments: () => 0,
  });

  const payload = await service.buildAgendaBootstrapPayload();

  assert.equal(hydrated, false);
  assert.equal(payload.appointments.length, 1);
  assert.equal(payload.appointments[0].id, 11);
});

test('agenda page bootstrap service forceert altijd een verse runtime-state sync vóór de bootstrap (Vercel multi-instance regressietest voor direct-zichtbare afspraken)', async () => {
  // Repro: instance A heeft zojuist een appointment geschreven, gebruiker
  // navigeert direct naar /premium-personeel-agenda → bootstrap-request
  // landt op instance B die nog niet weet van de nieuwe appointment. Zonder
  // forced sync ziet de gebruiker een lege agenda. Met forced sync (maxAgeMs: 0)
  // haalt B de laatste Supabase-state op en toont hij de afspraak direct.
  const syncCalls = [];
  const service = createAgendaPageBootstrapService({
    isSupabaseConfigured: () => true,
    getSupabaseStateHydrated: () => true,
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async (options) => {
      syncCalls.push(options);
      return true;
    },
    getGeneratedAgendaAppointments: () => [{ id: 42, date: '2026-04-16', time: '18:30' }],
    isGeneratedAppointmentVisibleForAgenda: () => true,
    compareAgendaAppointments: () => 0,
  });

  const payload = await service.buildAgendaBootstrapPayload();

  assert.equal(syncCalls.length, 1,
    'bootstrap moet altijd een sync forceren, ook als de instance warm is');
  assert.equal(syncCalls[0]?.maxAgeMs, 0,
    'bootstrap moet cooldown omzeilen (maxAgeMs: 0), anders ziet gebruiker stale data');
  assert.equal(payload.appointments.length, 1);
});

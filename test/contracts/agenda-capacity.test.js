const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaCapacityService } = require('../../server/services/agenda-capacity');

function createService(nowIso = '2026-05-06T06:30:00.000Z') {
  return createAgendaCapacityService({
    normalizeString: (value) => String(value ?? '').trim(),
    normalizeDateYyyyMmDd: (value) => String(value ?? '').trim(),
    normalizeTimeHhMm: (value) => String(value ?? '').trim(),
    now: () => new Date(nowIso),
  });
}

test('agenda capacity reports full when all upcoming 10 workdays are unavailable', () => {
  const service = createService();
  const appointments = [
    '2026-05-06',
    '2026-05-07',
    '2026-05-08',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-18',
    '2026-05-19',
  ].map((date, id) => ({
    id,
    date,
    time: '09:00',
    manualAllDayUnavailable: true,
  }));

  const capacity = service.assessUpcomingWorkdayCapacity({
    appointments,
    isAppointmentVisible: () => true,
    workdayCount: 10,
    slotMinutes: 60,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timeZone: 'Europe/Amsterdam',
  });

  assert.equal(capacity.full, true);
  assert.equal(capacity.workdayCount, 10);
  assert.equal(capacity.availableSlots, 0);
  assert.equal(capacity.totalSlots, 80);
});

test('agenda capacity keeps coldcalling available when one slot is still open', () => {
  const service = createService();
  const appointments = [
    { date: '2026-05-06', time: '09:00', manualAvailableAgain: '16:00' },
    { date: '2026-05-07', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-08', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-11', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-12', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-13', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-14', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-15', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-18', time: '09:00', manualAllDayUnavailable: true },
    { date: '2026-05-19', time: '09:00', manualAllDayUnavailable: true },
  ];

  const capacity = service.assessUpcomingWorkdayCapacity({
    appointments,
    isAppointmentVisible: () => true,
  });

  assert.equal(capacity.full, false);
  assert.equal(capacity.availableSlots, 1);
  assert.deepEqual(capacity.firstAvailableSlot, { date: '2026-05-06', time: '16:00' });
});

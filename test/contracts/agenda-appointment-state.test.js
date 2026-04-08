const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaAppointmentStateService } = require('../../server/services/agenda-appointment-state');

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

function createFixture(overrides = {}) {
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];
  const agendaAppointmentIdByCallId = new Map(overrides.agendaAppointmentIdByCallId || []);
  const recentDashboardActivities = overrides.recentDashboardActivities || [];
  const clearedCallIds = [];
  const persistReasons = [];

  const service = createAgendaAppointmentStateService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    getRecentDashboardActivities: () => recentDashboardActivities,
    mapAppointmentToConfirmationTask: (appointment) => {
      const taskType = normalizeString(appointment?.confirmationTaskType || appointment?.type || '').toLowerCase();
      return taskType === 'lead_follow_up' ? appointment : null;
    },
    clearDismissedInterestedLeadCallId: (callId) => {
      clearedCallIds.push(normalizeString(callId));
      return true;
    },
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation: (value) => normalizeString(value),
  });

  return {
    agendaAppointmentIdByCallId,
    clearedCallIds,
    generatedAgendaAppointments,
    persistReasons,
    recentDashboardActivities,
    service,
  };
}

test('agenda appointment state service resolves indexes and updates mappings when appointments change', () => {
  const { agendaAppointmentIdByCallId, clearedCallIds, generatedAgendaAppointments, persistReasons, service } =
    createFixture({
      generatedAgendaAppointments: [
        {
          id: 11,
          callId: 'call-old',
          confirmationTaskType: 'lead_follow_up',
          company: 'Softora',
        },
      ],
      agendaAppointmentIdByCallId: [['call-old', 11]],
    });

  assert.equal(service.getGeneratedAppointmentIndexById(11), 0);
  assert.equal(service.getGeneratedAppointmentIndexById('999'), -1);

  const updated = service.setGeneratedAgendaAppointmentAtIndex(
    0,
    {
      id: 11,
      callId: 'call-new',
      confirmationTaskType: 'lead_follow_up',
      company: 'Softora Pro',
    },
    'agenda_appointment_update'
  );

  assert.equal(updated.company, 'Softora Pro');
  assert.equal(agendaAppointmentIdByCallId.has('call-old'), false);
  assert.equal(agendaAppointmentIdByCallId.get('call-new'), 11);
  assert.deepEqual(clearedCallIds, ['call-new']);
  assert.deepEqual(persistReasons, ['agenda_appointment_update']);
  assert.equal(generatedAgendaAppointments[0].callId, 'call-new');
});

test('agenda appointment state service parses dashboard activity schedule details safely', () => {
  const { service } = createFixture();

  assert.deepEqual(
    service.extractAgendaScheduleFromDashboardActivity({
      type: 'lead_set_in_agenda',
      detail: 'Lead ingepland op 2026-04-15 om 14:30 (Amsterdam).',
    }),
    {
      date: '2026-04-15',
      time: '14:30',
      location: 'Amsterdam',
    }
  );

  assert.equal(
    service.extractAgendaScheduleFromDashboardActivity({
      type: 'other',
      detail: 'Geen match',
    }),
    null
  );
});

test('agenda appointment state service repairs agenda schedules from recent dashboard activity log', () => {
  const { generatedAgendaAppointments, persistReasons, service } = createFixture({
    generatedAgendaAppointments: [
      {
        id: 21,
        callId: 'call-21',
        type: 'meeting',
        date: '2026-04-10',
        time: '09:00',
        location: 'Utrecht',
        appointmentLocation: 'Utrecht',
      },
    ],
    agendaAppointmentIdByCallId: [['call-21', 21]],
    recentDashboardActivities: [
      {
        type: 'lead_set_in_agenda',
        taskId: 21,
        callId: 'call-21',
        detail: 'Lead ingepland op 2026-04-12 om 15:45 (Amsterdam).',
        createdAt: '2026-04-08T12:00:00.000Z',
      },
    ],
  });

  const touched = service.repairAgendaAppointmentsFromDashboardActivities();

  assert.equal(touched, 1);
  assert.equal(generatedAgendaAppointments[0].date, '2026-04-12');
  assert.equal(generatedAgendaAppointments[0].time, '15:45');
  assert.equal(generatedAgendaAppointments[0].location, 'Amsterdam');
  assert.equal(generatedAgendaAppointments[0].appointmentLocation, 'Amsterdam');
  assert.deepEqual(persistReasons, ['agenda_schedule_repaired_from_activity_log']);
});

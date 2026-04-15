const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaAppointmentStateService } = require('../../server/services/agenda-appointment-state');
const { createAgendaAppointmentUpsertService } = require('../../server/services/agenda-appointment-upsert');

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

function toBooleanSafe(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function createFixture(overrides = {}) {
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];
  const agendaAppointmentIdByCallId = new Map(overrides.agendaAppointmentIdByCallId || []);
  const persistReasons = [];
  let nextGeneratedAgendaAppointmentId = Number(overrides.nextGeneratedAgendaAppointmentId || 9000);

  const appointmentStateService = createAgendaAppointmentStateService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    getRecentDashboardActivities: () => [],
    mapAppointmentToConfirmationTask: (appointment) => {
      const taskType = normalizeString(
        appointment?.confirmationTaskType || appointment?.taskType || appointment?.type || ''
      ).toLowerCase();
      const needsConfirmation = toBooleanSafe(
        appointment?.needsConfirmationEmail,
        toBooleanSafe(appointment?.aiGenerated, false)
      );
      const alreadyDone = Boolean(
        appointment?.confirmationResponseReceived ||
          appointment?.confirmationResponseReceivedAt ||
          appointment?.confirmationAppointmentCancelled ||
          appointment?.confirmationAppointmentCancelledAt
      );
      if ((!needsConfirmation && taskType !== 'lead_follow_up') || alreadyDone) return null;
      return appointment;
    },
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation: (value) => normalizeString(value),
  });

  const service = createAgendaAppointmentUpsertService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    getGeneratedAppointmentIndexById: appointmentStateService.getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex: appointmentStateService.setGeneratedAgendaAppointmentAtIndex,
    findReusableLeadFollowUpAppointmentIndex: overrides.findReusableLeadFollowUpAppointmentIndex || (() => -1),
    buildConfirmationEmailDraftFallback: (appointment) =>
      `Draft voor ${normalizeString(appointment?.company || 'Onbekende lead')}`,
    takeNextGeneratedAgendaAppointmentId: () => nextGeneratedAgendaAppointmentId++,
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation: (value) => normalizeString(value),
    sanitizeAppointmentWhatsappInfo: (value) => normalizeString(value),
    toBooleanSafe,
    normalizeEmailAddress: (value) => normalizeString(value).toLowerCase(),
  });

  return {
    agendaAppointmentIdByCallId,
    generatedAgendaAppointments,
    persistReasons,
    service,
  };
}

test('agenda appointment upsert service preserves committed schedule data on mapped updates', () => {
  const { agendaAppointmentIdByCallId, generatedAgendaAppointments, persistReasons, service } =
    createFixture({
      generatedAgendaAppointments: [
        {
          id: 11,
          callId: 'call-11',
          company: 'Softora',
          date: '2026-04-15',
          time: '10:30',
          location: 'Amsterdam',
          appointmentLocation: 'Amsterdam',
          whatsappInfo: 'Bel via WhatsApp',
          whatsappConfirmed: true,
          summary: 'Bestaande agenda samenvatting',
          summaryFormatVersion: 2,
          needsConfirmationEmail: false,
          confirmationEmailSent: true,
          confirmationEmailDraft: 'Oude draft',
          confirmationTaskCreatedAt: '2026-04-01T10:00:00.000Z',
          contactEmail: 'oud@example.com',
        },
      ],
      agendaAppointmentIdByCallId: [['call-11', 11]],
    });

  const updated = service.upsertGeneratedAgendaAppointment(
    {
      company: 'Softora Updated',
      date: '2026-04-22',
      time: '15:45',
      location: 'Rotterdam',
      appointmentLocation: 'Rotterdam',
      whatsappInfo: 'Nieuwe notitie',
      summary: 'Nieuwe summary',
      contactEmail: 'NIEUW@EXAMPLE.COM',
      aiGenerated: true,
    },
    'call-11'
  );

  assert.equal(updated.company, 'Softora Updated');
  assert.equal(updated.date, '2026-04-15');
  assert.equal(updated.time, '10:30');
  assert.equal(updated.location, 'Amsterdam');
  assert.equal(updated.appointmentLocation, 'Amsterdam');
  assert.equal(updated.whatsappInfo, 'Bel via WhatsApp');
  assert.equal(updated.summary, 'Bestaande agenda samenvatting');
  assert.equal(updated.summaryFormatVersion, 2);
  assert.equal(updated.contactEmail, 'nieuw@example.com');
  assert.equal(updated.confirmationEmailDraft, 'Oude draft');
  assert.equal(agendaAppointmentIdByCallId.get('call-11'), 11);
  assert.deepEqual(persistReasons, ['agenda_appointment_upsert']);
  assert.equal(generatedAgendaAppointments[0].company, 'Softora Updated');
});

test('agenda appointment upsert service reuses matching lead follow-up appointments safely', () => {
  const { agendaAppointmentIdByCallId, persistReasons, service } = createFixture({
    generatedAgendaAppointments: [
      {
        id: 22,
        callId: 'old-call',
        company: 'Lead Oud',
        confirmationTaskType: 'lead_follow_up',
        createdAt: '2026-04-02T09:00:00.000Z',
        confirmationTaskCreatedAt: '2026-04-02T09:00:00.000Z',
        confirmationEmailDraft: null,
      },
    ],
    agendaAppointmentIdByCallId: [['old-call', 22]],
    findReusableLeadFollowUpAppointmentIndex: () => 0,
  });

  const reused = service.upsertGeneratedAgendaAppointment(
    {
      company: 'Lead Nieuw',
      createdAt: '2026-04-08T11:00:00.000Z',
      contactEmail: 'lead@example.com',
      aiGenerated: true,
      summary: 'Nieuwe follow-up',
      confirmationTaskType: 'lead_follow_up',
    },
    'new-call'
  );

  assert.equal(reused.id, 22);
  assert.equal(reused.callId, 'new-call');
  assert.equal(reused.company, 'Lead Nieuw');
  assert.equal(reused.contactEmail, 'lead@example.com');
  assert.equal(reused.createdAt, '2026-04-08T11:00:00.000Z');
  assert.equal(reused.confirmationTaskCreatedAt, '2026-04-08T11:00:00.000Z');
  assert.equal(reused.confirmationEmailDraft, 'Draft voor Lead Nieuw');
  assert.equal(reused.confirmationEmailDraftSource, 'template-auto');
  assert.equal(agendaAppointmentIdByCallId.has('old-call'), false);
  assert.equal(agendaAppointmentIdByCallId.get('new-call'), 22);
  assert.deepEqual(persistReasons, ['agenda_appointment_reuse_upsert']);
});

test('agenda appointment upsert service inserts new appointments with stable defaults', () => {
  const { agendaAppointmentIdByCallId, generatedAgendaAppointments, persistReasons, service } =
    createFixture({
      nextGeneratedAgendaAppointmentId: 501,
    });

  const inserted = service.upsertGeneratedAgendaAppointment(
    {
      company: 'Nieuwe afspraak',
      contactEmail: 'TEST@EXAMPLE.COM',
      aiGenerated: true,
      postCallStatus: 'completed',
    },
    'call-new'
  );

  assert.equal(inserted.id, 501);
  assert.equal(inserted.contactEmail, 'test@example.com');
  assert.equal(inserted.needsConfirmationEmail, true);
  assert.equal(inserted.confirmationEmailSent, false);
  assert.equal(inserted.confirmationResponseReceived, false);
  assert.equal(inserted.confirmationAppointmentCancelled, false);
  assert.equal(inserted.confirmationEmailDraft, 'Draft voor Nieuwe afspraak');
  assert.equal(inserted.confirmationEmailDraftGeneratedAt, inserted.createdAt);
  assert.equal(inserted.confirmationEmailDraftSource, 'template-auto');
  assert.equal(inserted.confirmationTaskCreatedAt, inserted.createdAt);
  assert.equal(inserted.postCallStatus, 'completed');
  assert.equal(generatedAgendaAppointments.length, 1);
  assert.equal(agendaAppointmentIdByCallId.get('call-new'), 501);
  assert.deepEqual(persistReasons, ['agenda_appointment_insert']);
});

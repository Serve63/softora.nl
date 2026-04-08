const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaLeadFollowUpService } = require('../../server/services/agenda-lead-follow-up');

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
  const clearedDismissedCallIds = [];
  const persistReasons = [];

  function buildLeadFollowUpCandidateKey(item) {
    const phoneDigits = normalizeString(item?.phone || '').replace(/\D/g, '');
    if (phoneDigits) return `phone:${phoneDigits}`;
    const company = normalizeString(item?.company || '').toLowerCase();
    const contact = normalizeString(item?.contact || '').toLowerCase();
    return company || contact ? `name:${company}|${contact}` : '';
  }

  const service = createAgendaLeadFollowUpService({
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    agendaAppointmentIdByCallId,
    mapAppointmentToConfirmationTask: (appointment) => {
      const taskType = normalizeString(appointment?.confirmationTaskType || appointment?.type || '').toLowerCase();
      return taskType === 'lead_follow_up' ? appointment : null;
    },
    normalizeString,
    buildLeadFollowUpCandidateKey,
    getLeadLikeRecencyTimestamp: (value) => Date.parse(normalizeString(value?.createdAt || '')) || 0,
    buildLatestInterestedLeadRowsByKey:
      overrides.buildLatestInterestedLeadRowsByKey ||
      (() =>
        new Map(
          (overrides.latestRows || []).map((row) => [buildLeadFollowUpCandidateKey(row), row])
        )),
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText: (value, maxLength = 500) => normalizeString(value).slice(0, maxLength),
    resolveAppointmentLocation: (...values) =>
      values.map((value) => normalizeString(value?.location || value || '')).find(Boolean) || '',
    resolveCallDurationSeconds: (...values) => {
      for (const value of values) {
        const seconds = Number(value?.durationSeconds || 0);
        if (Number.isFinite(seconds) && seconds > 0) return seconds;
      }
      return 0;
    },
    sanitizeAppointmentWhatsappInfo: (value) => normalizeString(value),
    resolvePreferredRecordingUrl: (...values) =>
      values.map((value) => normalizeString(value?.recordingUrl || '')).find(Boolean) || '',
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    clearDismissedInterestedLeadCallId: (callId) => {
      clearedDismissedCallIds.push(normalizeString(callId));
      return true;
    },
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
  });

  return {
    agendaAppointmentIdByCallId,
    clearedDismissedCallIds,
    generatedAgendaAppointments,
    persistReasons,
    service,
  };
}

test('agenda lead follow-up service identifies open lead follow-up appointments and chooses reusable latest match', () => {
  const { service } = createFixture({
    generatedAgendaAppointments: [
      {
        id: 11,
        confirmationTaskType: 'lead_follow_up',
        callId: 'call-oldest',
        company: 'Softora',
        contact: 'Serve',
        phone: '0612345678',
        createdAt: '2026-04-08T09:00:00.000Z',
      },
      {
        id: 12,
        confirmationTaskType: 'lead_follow_up',
        callId: 'call-newest',
        company: 'Softora',
        contact: 'Serve',
        phone: '0612345678',
        createdAt: '2026-04-08T11:00:00.000Z',
      },
      {
        id: 13,
        confirmationTaskType: 'meeting',
        callId: 'call-ignore',
        company: 'Other',
        createdAt: '2026-04-08T12:00:00.000Z',
      },
    ],
  });

  assert.equal(
    service.findReusableLeadFollowUpAppointmentIndex(
      { company: 'Softora', contact: 'Serve', phone: '0612345678' },
      'call-fresh'
    ),
    1
  );
  assert.equal(
    service.findReusableLeadFollowUpAppointmentIndex(
      { company: 'Softora', contact: 'Serve', phone: '0612345678' },
      'call-newest'
    ),
    0
  );
});

test('agenda lead follow-up service backfills open lead follow-up appointments from newer interested-lead rows', () => {
  const { agendaAppointmentIdByCallId, clearedDismissedCallIds, generatedAgendaAppointments, persistReasons, service } =
    createFixture({
      generatedAgendaAppointments: [
        {
          id: 41,
          confirmationTaskType: 'lead_follow_up',
          type: 'lead_follow_up',
          callId: 'call-old',
          company: 'Softora',
          contact: 'Serve',
          phone: '0612345678',
          summary: 'Oude samenvatting',
          createdAt: '2026-04-08T09:00:00.000Z',
          coldcallingStack: 'retell',
        },
      ],
      agendaAppointmentIdByCallId: [['call-old', 41]],
      latestRows: [
        {
          callId: 'call-new',
          company: 'Softora',
          contact: 'Serve',
          phone: '0612345678',
          summary: 'Nieuwere lead-samenvatting',
          createdAt: '2026-04-08T12:00:00.000Z',
          date: '2026-04-12',
          time: '13:30',
          coldcallingStack: 'retell',
          whatsappInfo: 'Stuur later een appje',
          leadOwnerKey: 'owner-1',
          leadOwnerName: 'Serve',
        },
      ],
    });

  const touched = service.backfillOpenLeadFollowUpAppointmentsFromLatestCalls();

  assert.equal(touched, 1);
  assert.equal(generatedAgendaAppointments[0].callId, 'call-new');
  assert.equal(generatedAgendaAppointments[0].summary, 'Nieuwere lead-samenvatting');
  assert.equal(generatedAgendaAppointments[0].date, '2026-04-12');
  assert.equal(generatedAgendaAppointments[0].time, '13:30');
  assert.equal(agendaAppointmentIdByCallId.has('call-old'), false);
  assert.equal(agendaAppointmentIdByCallId.get('call-new'), 41);
  assert.deepEqual(clearedDismissedCallIds, ['call-new']);
  assert.deepEqual(persistReasons, ['lead_follow_up_latest_call_backfill']);
});

test('agenda lead follow-up service skips backfill when rows are not newer', () => {
  const { generatedAgendaAppointments, persistReasons, service } = createFixture({
    generatedAgendaAppointments: [
      {
        id: 51,
        confirmationTaskType: 'lead_follow_up',
        type: 'lead_follow_up',
        callId: 'call-current',
        company: 'Softora',
        contact: 'Serve',
        phone: '0612345678',
        summary: 'Actuele samenvatting',
        createdAt: '2026-04-08T12:00:00.000Z',
      },
    ],
      latestRows: [
        {
          callId: 'call-current',
          company: 'Softora',
          contact: 'Serve',
          phone: '0612345678',
          summary: 'Oudere samenvatting',
          createdAt: '2026-04-08T09:00:00.000Z',
        },
      ],
  });

  assert.equal(service.backfillOpenLeadFollowUpAppointmentsFromLatestCalls(), 0);
  assert.equal(generatedAgendaAppointments[0].summary, 'Actuele samenvatting');
  assert.deepEqual(persistReasons, []);
});

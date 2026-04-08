const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaTaskHelpers } = require('../../server/services/agenda-task-helpers');

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

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function toBooleanSafe(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function createFixture(overrides = {}) {
  const callUpdatesByCallId = new Map(overrides.callUpdatesByCallId || []);

  const service = createAgendaTaskHelpers({
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe,
    normalizeEmailAddress: (value) => normalizeString(String(value || '').trim().toLowerCase()),
    getLatestCallUpdateByCallId: (callId) => callUpdatesByCallId.get(normalizeString(callId)) || null,
    resolveAppointmentCallId: (appointment) => normalizeString(appointment?.callId || ''),
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    getColdcallingStackLabel: (value) =>
      value === 'openai_realtime_1_5' ? 'OpenAI Realtime 1.5' : normalizeString(value),
    resolveAgendaLocationValue: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    resolveCallDurationSeconds: (...sources) => {
      for (const source of sources) {
        const parsed = Number(source?.durationSeconds || 0);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
      return null;
    },
    buildLeadOwnerFields: (callId, owner = null) => ({
      leadOwnerKey: normalizeString(owner?.key || callId ? `owner-${callId}` : ''),
      leadOwnerName: normalizeString(owner?.displayName || 'Servé'),
    }),
  });

  return {
    service,
  };
}

test('agenda task helpers sort confirmation tasks newest first and format datetime labels', () => {
  const { service } = createFixture();

  const tasks = [
    { id: 1, createdAt: '2026-04-01T09:00:00.000Z' },
    { id: 2, createdAt: '2026-04-03T09:00:00.000Z' },
    { id: 3, createdAt: '2026-04-03T09:00:00.000Z' },
  ].sort(service.compareConfirmationTasks);

  assert.deepEqual(
    tasks.map((item) => item.id),
    [2, 3, 1]
  );
  assert.match(service.formatDateTimeLabelNl('2026-04-09', '09:30'), /09:30/);
  assert.equal(service.sanitizeAppointmentLocation('  Amsterdam  '), 'Amsterdam');
  assert.equal(service.sanitizeAppointmentWhatsappInfo('  hallo  '), 'hallo');
});

test('agenda task helpers materialize confirmation task payloads with stable provider labels', () => {
  const { service } = createFixture({
    callUpdatesByCallId: [
      [
        'call-42',
        {
          callId: 'call-42',
          provider: 'retell',
          stack: 'openai_realtime_1_5',
          stackLabel: 'OpenAI Realtime 1.5',
          durationSeconds: 91,
        },
      ],
    ],
  });

  const task = service.mapAppointmentToConfirmationTask({
    id: 42,
    company: 'Softora',
    contact: 'Servé Creusen',
    phone: '0612345678',
    date: '2026-04-09',
    time: '10:30',
    source: 'AI Cold Calling',
    summary: 'Afspraak staat klaar.',
    callId: 'call-42',
    aiGenerated: true,
    needsConfirmationEmail: true,
    confirmationTaskType: 'send_confirmation_email',
    confirmationEmailDraft: 'Concept',
    confirmationEmailSent: true,
    confirmationEmailSentAt: '2026-04-08T12:00:00.000Z',
    confirmationResponseReceived: false,
    confirmationAppointmentCancelled: false,
    location: 'Rotterdam',
    whatsappInfo: 'App vooraf even',
    contactEmail: 'TEST@EXAMPLE.COM',
  });

  assert.equal(task.id, 42);
  assert.equal(task.type, 'send_confirmation_email');
  assert.equal(task.provider, 'retell');
  assert.equal(task.providerLabel, 'OpenAI Realtime 1.5');
  assert.equal(task.location, 'Rotterdam');
  assert.equal(task.whatsappInfo, 'App vooraf even');
  assert.equal(task.contactEmail, 'test@example.com');
  assert.equal(task.mailDraftAvailable, true);
  assert.equal(task.mailSent, true);
  assert.equal(task.durationSeconds, 91);
  assert.equal(task.leadOwnerName, 'Servé');
});

test('agenda task helpers skip closed tasks but keep lead follow-up tasks available', () => {
  const { service } = createFixture();

  assert.equal(
    service.mapAppointmentToConfirmationTask({
      id: 1,
      callId: 'call-1',
      aiGenerated: true,
      needsConfirmationEmail: true,
      confirmationResponseReceived: true,
    }),
    null
  );

  const leadFollowUpTask = service.mapAppointmentToConfirmationTask({
    id: 2,
    callId: 'call-2',
    confirmationTaskType: 'lead_follow_up',
    needsConfirmationEmail: false,
    aiGenerated: false,
    company: 'Lead BV',
    contact: 'Jan',
    date: '2026-04-10',
    time: '09:00',
  });

  assert.equal(leadFollowUpTask.type, 'lead_follow_up');
  assert.equal(leadFollowUpTask.title, 'Lead opvolgen');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaInterestedLeadReadService } = require('../../server/services/agenda-interested-lead-read');

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

function compareConfirmationTasks(a, b) {
  const aTs = Date.parse(normalizeString(a?.createdAt || '')) || 0;
  const bTs = Date.parse(normalizeString(b?.createdAt || '')) || 0;
  return bTs - aTs;
}

function createServiceFixture(overrides = {}) {
  const recentCallUpdates = overrides.recentCallUpdates || [];
  const recentAiCallInsights = overrides.recentAiCallInsights || [];
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];

  return createAgendaInterestedLeadReadService({
    getRecentCallUpdates: () => recentCallUpdates,
    getRecentAiCallInsights: () => recentAiCallInsights,
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    mapAppointmentToConfirmationTask:
      overrides.mapAppointmentToConfirmationTask ||
      ((appointment) => {
        const taskType = normalizeString(appointment?.confirmationTaskType || appointment?.type || '').toLowerCase();
        if (taskType !== 'lead_follow_up') return null;
        return {
          ...appointment,
          id: Number(appointment?.id || 0) || 0,
          appointmentId: Number(appointment?.id || 0) || 0,
        };
      }),
    compareConfirmationTasks,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe: (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    normalizeColdcallingStack: (value) => normalizeString(value).toLowerCase(),
    getColdcallingStackLabel: (value) => (normalizeString(value) ? 'Retell' : ''),
    buildGeneratedLeadFollowUpFromCall:
      overrides.buildGeneratedLeadFollowUpFromCall ||
      ((callUpdate) => {
        if (!callUpdate) return null;
        return {
          company: normalizeString(callUpdate.company || '') || 'Onbekende lead',
          contact: normalizeString(callUpdate.name || ''),
          phone: normalizeString(callUpdate.phone || ''),
          date: '2026-04-10',
          time: '14:00',
          source: 'Coldcalling interesse',
          summary: normalizeString(callUpdate.summary || ''),
          provider: normalizeString(callUpdate.provider || ''),
          createdAt: normalizeString(callUpdate.updatedAt || callUpdate.endedAt || '') || new Date().toISOString(),
        };
      }),
    buildLeadOwnerFields: (callId) => ({
      leadOwnerKey: callId ? `owner-${callId}` : '',
    }),
    resolveAppointmentLocation: (...values) =>
      values.map((value) => normalizeString(value?.location || value || '')).find(Boolean) || '',
    resolveCallDurationSeconds: (...values) => {
      for (const value of values) {
        const seconds = Number(value?.durationSeconds || 0);
        if (Number.isFinite(seconds) && seconds > 0) return seconds;
      }
      return 0;
    },
    resolvePreferredRecordingUrl: (...values) =>
      values.map((value) => normalizeString(value?.recordingUrl || '')).find(Boolean) || '',
    sanitizeAppointmentLocation: (value) => normalizeString(value),
    sanitizeAppointmentWhatsappInfo: (value) => normalizeString(value),
    resolveAgendaLocationValue: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    isInterestedLeadDismissedForRow: overrides.isInterestedLeadDismissedForRow || (() => false),
    hasNegativeInterestSignal: (value) => /geen interesse|niet interessant/i.test(normalizeString(value)),
    hasPositiveInterestSignal: (value) => /interesse|terugbellen|afspraak/i.test(normalizeString(value)),
  });
}

test('agenda interested lead read service normalizes Dutch phone keys consistently', () => {
  const service = createServiceFixture();

  assert.equal(service.normalizeLeadLikePhoneKey('06 12 34 56 78'), '31612345678');
  assert.equal(service.normalizeLeadLikePhoneKey('+31 6 12 34 56 78'), '31612345678');
  assert.equal(service.normalizeLeadLikePhoneKey('00316-12345678'), '31612345678');
});

test('agenda interested lead read service merges newer call-driven rows onto existing follow-up tasks', () => {
  const service = createServiceFixture({
    generatedAgendaAppointments: [
      {
        id: 11,
        confirmationTaskType: 'lead_follow_up',
        type: 'lead_follow_up',
        callId: 'call-old',
        company: 'Softora',
        contact: 'Serve Creusen',
        phone: '0612345678',
        summary: 'Oude notitie',
        createdAt: '2026-04-08T09:00:00.000Z',
      },
    ],
    recentCallUpdates: [
      {
        callId: 'call-new',
        company: 'Softora',
        name: 'Serve Creusen',
        phone: '0612345678',
        summary: 'Nieuw gesprek met duidelijke interesse',
        updatedAt: '2026-04-08T11:00:00.000Z',
        provider: 'retell',
      },
    ],
  });

  const rows = service.buildAllInterestedLeadRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 11);
  assert.equal(rows[0].appointmentId, 11);
  assert.equal(rows[0].callId, 'call-new');
  assert.equal(rows[0].summary, 'Nieuw gesprek met duidelijke interesse');

  const found = service.findInterestedLeadRowByCallId('call-new');
  assert.ok(found);
  assert.equal(found.id, 11);
});

test('agenda interested lead read service filters dismissed rows from both materialized and generated sources', () => {
  const service = createServiceFixture({
    generatedAgendaAppointments: [
      {
        id: 21,
        confirmationTaskType: 'lead_follow_up',
        type: 'lead_follow_up',
        callId: 'call-dismissed',
        company: 'Dismissed BV',
        phone: '0611111111',
        createdAt: '2026-04-08T09:00:00.000Z',
      },
    ],
    recentCallUpdates: [
      {
        callId: 'call-dismissed',
        company: 'Dismissed BV',
        name: 'Lead',
        phone: '0611111111',
        summary: 'Lead toonde interesse',
        updatedAt: '2026-04-08T12:00:00.000Z',
      },
    ],
    isInterestedLeadDismissedForRow: (callId) => normalizeString(callId) === 'call-dismissed',
  });

  assert.deepEqual(service.buildAllInterestedLeadRows(), []);
  assert.equal(service.findInterestedLeadRowByCallId('call-dismissed'), null);
});

test('agenda interested lead read service does not recreate a cancelled lead follow-up from call updates', () => {
  const service = createServiceFixture({
    generatedAgendaAppointments: [
      {
        id: 31,
        confirmationTaskType: 'lead_follow_up',
        type: 'lead_follow_up',
        callId: 'call-cancelled',
        company: 'Cancelled BV',
        contact: 'Lead',
        phone: '0612222222',
        createdAt: '2026-04-08T09:00:00.000Z',
        confirmationAppointmentCancelled: true,
        confirmationAppointmentCancelledAt: '2026-04-08T09:05:00.000Z',
      },
    ],
    recentCallUpdates: [
      {
        callId: 'call-cancelled',
        company: 'Cancelled BV',
        name: 'Lead',
        phone: '0612222222',
        summary: 'Lead toonde interesse',
        updatedAt: '2026-04-08T12:00:00.000Z',
      },
    ],
    mapAppointmentToConfirmationTask: (appointment) => {
      if (appointment?.confirmationAppointmentCancelled || appointment?.confirmationAppointmentCancelledAt) {
        return null;
      }
      return {
        ...appointment,
        id: Number(appointment?.id || 0) || 0,
        appointmentId: Number(appointment?.id || 0) || 0,
      };
    },
  });

  assert.deepEqual(service.buildAllInterestedLeadRows(), []);
  assert.equal(service.findInterestedLeadRowByCallId('call-cancelled'), null);
});

test('agenda interested lead read service still shows a newer call when only an older reusable key was dismissed', () => {
  const service = createServiceFixture({
    recentCallUpdates: [
      {
        callId: 'call-fresh',
        company: 'Softora',
        name: 'Serve Creusen',
        phone: '0612345678',
        summary: 'Nieuwe testcall met interesse',
        updatedAt: '2026-04-08T12:00:00.000Z',
      },
    ],
    isInterestedLeadDismissedForRow: (callId, rowLike) => {
      if (normalizeString(callId) === 'call-old') return true;
      if (!normalizeString(callId)) {
        return normalizeString(rowLike?.company).toLowerCase() === 'softora';
      }
      return false;
    },
  });

  const rows = service.buildAllInterestedLeadRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].callId, 'call-fresh');
});

test('agenda interested lead read service collects all related call ids for one reusable lead identity', () => {
  const service = createServiceFixture({
    generatedAgendaAppointments: [
      {
        id: 41,
        confirmationTaskType: 'lead_follow_up',
        callId: 'call-appointment',
        company: 'Softora',
        contact: 'Serve Creusen',
        phone: '0612345678',
      },
    ],
    recentCallUpdates: [
      {
        callId: 'call-update',
        company: 'Softora',
        name: 'Serve Creusen',
        phone: '0612345678',
        updatedAt: '2026-04-08T12:00:00.000Z',
      },
      {
        callId: 'call-other',
        company: 'Andere Lead',
        name: 'Test',
        phone: '0611111111',
        updatedAt: '2026-04-08T12:05:00.000Z',
      },
    ],
    recentAiCallInsights: [
      {
        callId: 'call-insight',
        company: 'Softora',
        contactName: 'Serve Creusen',
        phone: '0612345678',
        analyzedAt: '2026-04-08T12:10:00.000Z',
      },
    ],
  });

  const callIds = service.collectInterestedLeadCallIdsByIdentity('call-primary', {
    company: 'Softora',
    contact: 'Serve Creusen',
    phone: '0612345678',
  });

  assert.deepEqual(callIds, ['call-primary', 'call-appointment', 'call-update', 'call-insight']);
});

test('agenda interested lead read service tracks the latest row per reusable lead key', () => {
  const service = createServiceFixture({
    recentCallUpdates: [
      {
        callId: 'call-latest',
        company: 'Softora',
        name: 'Serve Creusen',
        phone: '0612345678',
        summary: 'Laatste follow-up',
        updatedAt: '2026-04-08T12:30:00.000Z',
      },
      {
        callId: 'call-earlier',
        company: 'Softora',
        name: 'Serve Creusen',
        phone: '0612345678',
        summary: 'Eerdere follow-up',
        updatedAt: '2026-04-08T10:30:00.000Z',
      },
    ],
  });

  const byKey = service.buildLatestInterestedLeadRowsByKey();
  assert.equal(byKey.size, 1);
  const onlyRow = Array.from(byKey.values())[0];
  assert.equal(onlyRow.callId, 'call-latest');
  assert.equal(onlyRow.summary, 'Laatste follow-up');
});

test('agenda interested lead read service does not expose follow-up instructions as the lead summary', () => {
  const service = createServiceFixture({
    recentCallUpdates: [
      {
        callId: 'call-summary',
        company: 'Softora',
        name: 'Serve Creusen',
        phone: '0612345678',
        summary: '',
        transcriptSnippet: 'Prospect wil de website vernieuwen en staat open voor een afspraak.',
        updatedAt: '2026-04-08T12:30:00.000Z',
      },
    ],
    recentAiCallInsights: [
      {
        callId: 'call-summary',
        company: 'Softora',
        contactName: 'Serve Creusen',
        phone: '0612345678',
        summary: '',
        followUpReason: 'Bevestigingsmail sturen op basis van gedetecteerde afspraak in gesprekstranscriptie.',
        analyzedAt: '2026-04-08T12:35:00.000Z',
      },
    ],
  });

  const rows = service.buildAllInterestedLeadRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, 'Prospect wil de website vernieuwen en staat open voor een afspraak.');
  assert.equal(
    rows[0].whatsappInfo,
    'Bevestigingsmail sturen op basis van gedetecteerde afspraak in gesprekstranscriptie.'
  );
});

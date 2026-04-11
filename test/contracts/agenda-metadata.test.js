const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaMetadataService } = require('../../server/services/agenda-metadata');

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

function extractAddressLikeLocationFromText(value) {
  const text = normalizeString(value).replace(/\s+/g, ' ');
  const match = text.match(/([A-Za-z]+straat\s+\d+(?:,\s*[A-Za-z]+)?)/i);
  return match ? truncateText(match[1], 220) : '';
}

function summaryContainsEnglishMarkers(value) {
  return /\b(meeting|follow-up|appointment|other info from whatsapp)\b/i.test(normalizeString(value));
}

function createFixture(overrides = {}) {
  const appointments = overrides.appointments || [];
  const agendaAppointmentIdByCallId = new Map(overrides.agendaAppointmentIdByCallId || []);
  const aiCallInsightsByCallId = new Map(overrides.aiCallInsightsByCallId || []);
  const callUpdatesByCallId = new Map(overrides.callUpdatesByCallId || []);
  const persistReasons = [];
  const setCalls = [];
  const twilioCalls = [];
  const retellCalls = [];

  function sanitizeAppointmentLocation(value) {
    return truncateText(value, 220);
  }

  function sanitizeAppointmentWhatsappInfo(value) {
    return truncateText(value, 6000);
  }

  function resolveAppointmentLocation(...sources) {
    for (const source of sources) {
      const value = normalizeString(
        source?.location || source?.appointmentLocation || source?.address || ''
      );
      if (value) return value;
    }
    return '';
  }

  function resolvePreferredRecordingUrl(...sources) {
    for (const source of sources) {
      const value = normalizeString(source?.recordingUrl || '');
      if (value) return value;
    }
    return '';
  }

  function resolveCallDurationSeconds(...sources) {
    for (const source of sources) {
      const parsed = Number(source?.durationSeconds || source?.duration_seconds || 0);
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
    return null;
  }

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, reason) {
    appointments[idx] = {
      ...nextValue,
    };
    setCalls.push({ idx, reason, nextValue: appointments[idx] });
    return appointments[idx];
  }

  const service = createAgendaMetadataService({
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
    toBooleanSafe,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
    isWeakAppointmentLocationText: (value) =>
      /^(onbekend|nog niet ingevuld|nvt|n\/a|null|undefined|-)?$/i.test(normalizeString(value)),
    extractAddressLikeLocationFromText,
    summaryContainsEnglishMarkers,
    getOpenAiApiKey: () => normalizeString(overrides.openAiApiKey || ''),
    generateTextSummaryWithAi:
      overrides.generateTextSummaryWithAi ||
      (async () => ({
        summary: 'AI samenvatting in het Nederlands.',
      })),
    getGeneratedAgendaAppointments: () => appointments,
    setGeneratedAgendaAppointmentAtIndex,
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
    agendaAppointmentIdByCallId,
    getLatestCallUpdateByCallId: (callId) => callUpdatesByCallId.get(normalizeString(callId)) || null,
    aiCallInsightsByCallId,
    resolveAppointmentLocation,
    resolvePreferredRecordingUrl,
    resolveCallDurationSeconds,
    refreshCallUpdateFromTwilioStatusApi: async (callId, options) => {
      twilioCalls.push({ callId, options });
      return { ok: true };
    },
    refreshCallUpdateFromRetellStatusApi: async (callId) => {
      retellCalls.push({ callId });
      return { ok: true };
    },
  });

  return {
    agendaAppointmentIdByCallId,
    appointments,
    persistReasons,
    retellCalls,
    service,
    setCalls,
    twilioCalls,
  };
}

test('agenda metadata service sorts visible appointments and resolves location fallbacks', () => {
  const { service } = createFixture();

  const sorted = [
    { id: 9, date: '2026-04-11', time: '12:00' },
    { id: 2, date: '2026-04-10', time: '09:00' },
    { id: 1, date: '2026-04-10', time: '09:00' },
  ].sort(service.compareAgendaAppointments);

  assert.deepEqual(
    sorted.map((item) => item.id),
    [1, 2, 9]
  );
  assert.equal(service.isGeneratedAppointmentVisibleForAgenda({ date: '2026-04-10' }), true);
  assert.equal(
    service.isGeneratedAppointmentPendingAgendaPlacement({
      date: '2026-04-10',
      confirmationTaskType: 'lead_follow_up',
      needsConfirmationEmail: true,
    }),
    true
  );
  assert.equal(
    service.isGeneratedAppointmentVisibleForAgenda({
      date: '2026-04-10',
      confirmationTaskType: 'lead_follow_up',
      needsConfirmationEmail: true,
    }),
    false
  );
  assert.equal(
    service.isGeneratedAppointmentVisibleForAgenda({
      date: '2026-04-10',
      confirmationTaskType: 'send_confirmation_email',
      needsConfirmationEmail: true,
    }),
    false
  );
  assert.equal(
    service.isGeneratedAppointmentVisibleForAgenda({
      date: '2026-04-10',
      confirmationTaskType: 'lead_follow_up',
      needsConfirmationEmail: false,
      confirmationResponseReceived: true,
    }),
    true
  );
  assert.equal(
    service.isGeneratedAppointmentVisibleForAgenda({
      date: '2026-04-10',
      confirmationAppointmentCancelled: true,
    }),
    false
  );
  assert.equal(
    service.resolveAgendaLocationValue(
      'Nog niet ingevuld',
      'Afspraak op Kerkstraat 12, Amsterdam met de lead.'
    ),
    'Kerkstraat 12, Amsterdam'
  );
});

test('agenda metadata service refreshes outdated summaries without loading jumps', async () => {
  const { appointments, service, setCalls } = createFixture({
    appointments: [
      {
        id: 11,
        date: '2026-04-10',
        time: '09:00',
        location: 'Kerkstraat 12, Amsterdam',
        summary: 'We sturen nog een bevestigingsmail. Locatie is 2 km.',
        whatsappInfo: 'Bel bij aankomst even.',
        whatsappConfirmed: true,
        summaryFormatVersion: 1,
        createdAt: '2026-04-08T11:00:00.000Z',
      },
    ],
  });

  const refreshed = await service.refreshGeneratedAgendaSummariesIfNeeded(5);

  assert.equal(refreshed, 1);
  assert.equal(appointments[0].summaryFormatVersion, 4);
  assert.match(appointments[0].summary, /Kerkstraat 12, Amsterdam/);
  assert.doesNotMatch(appointments[0].summary, /bevestigingsmail/i);
  assert.match(appointments[0].summary, /bevestigd via WhatsApp/i);
  assert.equal(setCalls[0].reason, 'agenda_summary_autorefresh');
});

test('agenda metadata service backfills agenda appointment metadata from call sources', () => {
  const { agendaAppointmentIdByCallId, appointments, persistReasons, service } = createFixture({
    appointments: [
      {
        id: 42,
        callId: 'call-42',
        date: '2026-04-10',
        time: '09:00',
        summary: '',
        location: '',
        recordingUrl: '',
        durationSeconds: 0,
      },
    ],
    callUpdatesByCallId: [
      [
        'call-42',
        {
          callId: 'call-42',
          location: 'Havenstraat 9, Utrecht',
          recordingUrl: 'https://cdn.softora.nl/recordings/call-42.mp3',
          durationSeconds: 93,
          summary: 'Lead wil door met een websitegesprek.',
        },
      ],
    ],
  });

  const touched = service.backfillGeneratedAgendaAppointmentsMetadataIfNeeded();

  assert.equal(touched, true);
  assert.equal(appointments[0].location, 'Havenstraat 9, Utrecht');
  assert.equal(appointments[0].recordingUrl, 'https://cdn.softora.nl/recordings/call-42.mp3');
  assert.equal(appointments[0].durationSeconds, 93);
  assert.equal(appointments[0].summary, 'Lead wil door met een websitegesprek.');
  assert.equal(agendaAppointmentIdByCallId.get('call-42'), 42);
  assert.deepEqual(persistReasons, ['agenda_appointment_metadata_backfill']);
});

test('agenda metadata service refreshes missing call sources once per unique call id', async () => {
  const { retellCalls, service, twilioCalls } = createFixture({
    appointments: [
      {
        id: 1,
        callId: 'CA123',
        provider: 'twilio',
        date: '2026-04-10',
        time: '09:00',
        location: '',
        recordingUrl: '',
      },
      {
        id: 2,
        callId: 'CA123',
        provider: 'twilio',
        date: '2026-04-11',
        time: '09:00',
        location: '',
        recordingUrl: '',
      },
      {
        id: 3,
        callId: 'ret-1',
        provider: 'retell',
        date: '2026-04-12',
        time: '09:00',
        location: 'Rotterdam',
        recordingUrl: '',
      },
      {
        id: 4,
        callId: 'hidden',
        provider: 'retell',
        date: '',
        time: '09:00',
        location: '',
        recordingUrl: '',
      },
    ],
  });

  const refreshed = await service.refreshAgendaAppointmentCallSourcesIfNeeded(8);

  assert.equal(refreshed, 2);
  assert.deepEqual(twilioCalls, [
    {
      callId: 'CA123',
      options: { direction: 'outbound' },
    },
  ]);
  assert.deepEqual(retellCalls, [{ callId: 'ret-1' }]);
});

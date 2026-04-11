const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaConfirmationCoordinator } = require('../../server/services/agenda-confirmation');

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

function normalizeEmailAddress(value) {
  return normalizeString(value).toLowerCase();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function toBooleanSafe(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFixture(overrides = {}) {
  const appointments =
    overrides.appointments ||
    [
      {
        id: 101,
        company: 'Softora',
        contact: 'Serve Creusen',
        phone: '0612345678',
        date: '2026-04-09',
        time: '10:30',
        source: 'AI Cold Calling',
        summary: 'Afspraak over de nieuwe website.',
        callId: 'call-1',
        provider: 'retell',
        aiGenerated: true,
        needsConfirmationEmail: true,
        confirmationTaskType: 'send_confirmation_email',
        confirmationEmailDraft: '',
        confirmationEmailSent: false,
        confirmationResponseReceived: false,
        confirmationAppointmentCancelled: false,
        whatsappInfo: '',
      },
    ];

  const setCalls = [];
  const activityCalls = [];
  const smtpCalls = [];
  const dismissCalls = [];
  const persistWaitCalls = [];
  const callUpdatesByCallId = new Map([
    [
      'call-1',
      {
        callId: 'call-1',
        summary: 'Klant wil een website en staat open voor een afspraak.',
        transcriptSnippet: 'We plannen donderdag een afspraak.',
        status: 'completed',
      },
    ],
  ]);
  const aiCallInsightsByCallId = new Map([
    [
      'call-1',
      {
        summary: 'AI-inschatting: warme lead.',
      },
    ],
  ]);

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, reason) {
    appointments[idx] = {
      ...nextValue,
    };
    setCalls.push({ idx, nextValue: appointments[idx], reason });
    return appointments[idx];
  }

  const coordinator = createAgendaConfirmationCoordinator({
    openAiApiBaseUrl: 'https://api.openai.com/v1',
    openAiModel: 'gpt-4o-mini',
    runtimeSyncCooldownMs: 1000,
    aiCallInsightsByCallId,
    getGeneratedAgendaAppointments: () => appointments,
    getGeneratedAppointmentIndexById: (raw) => {
      const id = Number(raw);
      return appointments.findIndex((item) => Number(item?.id || 0) === id);
    },
    setGeneratedAgendaAppointmentAtIndex,
    mapAppointmentToConfirmationTask:
      overrides.mapAppointmentToConfirmationTask ||
      ((appointment) => {
        if (!appointment || appointment.confirmationResponseReceived || appointment.confirmationAppointmentCancelled) {
          return null;
        }
        return {
          id: Number(appointment.id) || 0,
          appointmentId: Number(appointment.id) || 0,
          company: normalizeString(appointment.company || ''),
          contact: normalizeString(appointment.contact || ''),
          phone: normalizeString(appointment.phone || ''),
          date: normalizeDateYyyyMmDd(appointment.date || ''),
          time: normalizeTimeHhMm(appointment.time || ''),
          summary: normalizeString(appointment.summary || ''),
          callId: normalizeString(appointment.callId || ''),
          provider: normalizeString(appointment.provider || ''),
          source: normalizeString(appointment.source || ''),
        };
      }),
    getLatestCallUpdateByCallId: (callId) => callUpdatesByCallId.get(callId) || null,
    pickReadableConversationSummaryForLeadDetail: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    getAppointmentTranscriptText: () => normalizeString(overrides.transcript || ''),
    resolvePreferredRecordingUrl: () => normalizeString(overrides.recordingUrl || ''),
    sanitizeAppointmentLocation: (value) => normalizeString(value),
    resolveAgendaLocationValue: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    sanitizeAppointmentWhatsappInfo: (value) => normalizeString(value),
    resolveCallDurationSeconds: () => 180,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    normalizeEmailAddress,
    truncateText,
    toBooleanSafe,
    resolveAppointmentCallId: (appointment) => normalizeString(appointment?.callId || ''),
    inferCallProvider: (_callId, provider) => normalizeString(provider || '').toLowerCase(),
    refreshCallUpdateFromTwilioStatusApi: async () => null,
    refreshCallUpdateFromRetellStatusApi: async () => null,
    buildCallBackedLeadDetail: async () => null,
    buildConversationSummaryForLeadDetail: async () => '',
    buildConfirmationEmailDraftFallback: (appointment) =>
      [
        `Onderwerp: Bevestiging afspraak met ${normalizeString(appointment?.company || 'uw bedrijf')}`,
        '',
        `Beste ${normalizeString(appointment?.contact || 'heer/mevrouw')},`,
        '',
        `Hierbij bevestigen we onze afspraak op ${normalizeDateYyyyMmDd(appointment?.date)} om ${normalizeTimeHhMm(appointment?.time) || '09:00'}.`,
      ].join('\n'),
    getOpenAiApiKey: () => normalizeString(overrides.openAiApiKey || ''),
    fetchJsonWithTimeout:
      overrides.fetchJsonWithTimeout ||
      (async () => ({
        response: { ok: true, status: 200 },
        data: {
          choices: [
            {
              message: {
                content: 'Onderwerp: AI concept\n\nBeste klant,\n\nTot donderdag.',
              },
            },
          ],
        },
      })),
    extractOpenAiTextContent: (value) => normalizeString(value),
    isSupabaseConfigured: () => Boolean(overrides.supabaseConfigured),
    getSupabaseStateHydrated: () => !overrides.supabaseConfigured || Boolean(overrides.supabaseHydrated),
    forceHydrateRuntimeStateWithRetries: async () => {},
    syncRuntimeStateFromSupabaseIfNewer: async () => {},
    isImapMailConfigured: () => false,
    syncInboundConfirmationEmailsFromImap: async () => ({ ok: true }),
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {},
    isLikelyValidEmail: (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeString(value)),
    isSmtpMailConfigured: () => overrides.smtpConfigured !== false,
    getMissingSmtpMailEnv: () => ['MAIL_SMTP_HOST'],
    sendConfirmationEmailViaSmtp: async ({ appointment, recipientEmail, draftText }) => {
      smtpCalls.push({ appointment, recipientEmail, draftText });
      return {
        ok: true,
        messageId: '<message-1@softora.nl>',
      };
    },
    appendDashboardActivity: (payload, reason) => {
      activityCalls.push({ payload, reason });
    },
    buildLeadToAgendaSummary: async (_summary, location) => `Lead ingepland op ${location}`,
    dismissInterestedLeadIdentity: (callId, appointment, reason) => {
      dismissCalls.push({ callId, appointment, reason });
    },
    extractTwilioRecordingSidFromUrl: () => '',
    isTwilioStatusApiConfigured: () => false,
    fetchTwilioRecordingsByCallId: async () => ({ recordings: [] }),
    choosePreferredTwilioRecording: () => null,
    buildTwilioRecordingMediaUrl: () => '',
    fetchBinaryWithTimeout: async () => ({
      response: { ok: true, status: 200, headers: { get: () => 'audio/mpeg' } },
      bytes: Buffer.from('audio'),
    }),
    getTwilioBasicAuthorizationHeader: () => 'Basic abc',
    buildRecordingFileNameForTranscription: () => 'call-1.mp3',
    getEffectivePublicBaseUrl: () => 'https://www.softora.nl',
    normalizeAbsoluteHttpUrl: (value) => normalizeString(value),
    getOpenAiTranscriptionModelCandidates: () => ['gpt-4o-mini-transcribe'],
    parseJsonLoose: (value) => {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return null;
      }
    },
    waitForQueuedRuntimeStatePersist: async () => {
      persistWaitCalls.push('waited');
      return true;
    },
    logger: {
      error() {},
    },
  });

  return {
    activityCalls,
    appointments,
    coordinator,
    dismissCalls,
    persistWaitCalls,
    setCalls,
    smtpCalls,
  };
}

test('agenda confirmation coordinator materializes task detail and auto-generates a fallback draft', async () => {
  const { appointments, coordinator, setCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.sendConfirmationTaskDetailResponse({ body: {} }, res, '101');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.task.id, 101);
  assert.match(res.body.task.confirmationEmailDraft, /Onderwerp:/);
  assert.match(appointments[0].confirmationEmailDraft, /Onderwerp:/);
  assert.equal(setCalls[0].reason, 'confirmation_task_detail_auto_draft');
});

test('agenda confirmation coordinator sends SMTP confirmation mail and persists task state', async () => {
  const { activityCalls, appointments, coordinator, smtpCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.sendConfirmationTaskEmailResponse(
    {
      body: {
        recipientEmail: 'klant@voorbeeld.nl',
        actor: 'Serve',
      },
    },
    res,
    '101'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sent, true);
  assert.equal(smtpCalls.length, 1);
  assert.equal(smtpCalls[0].recipientEmail, 'klant@voorbeeld.nl');
  assert.match(smtpCalls[0].draftText, /Onderwerp:/);
  assert.equal(appointments[0].confirmationEmailSent, true);
  assert.equal(appointments[0].confirmationEmailLastSentMessageId, '<message-1@softora.nl>');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_send_email');
});

test('agenda confirmation coordinator can set a lead task into the agenda and close the task', async () => {
  const { activityCalls, appointments, coordinator, dismissCalls, persistWaitCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.setLeadTaskInAgendaById(
    {
      body: {
        appointmentDate: '2026-04-10',
        appointmentTime: '11:45',
        location: 'Amsterdam',
        whatsappInfo: 'Stuur route via WhatsApp',
        whatsappConfirmed: true,
        actor: 'Serve',
      },
    },
    res,
    '101'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.taskCompleted, true);
  assert.equal(appointments[0].date, '2026-04-10');
  assert.equal(appointments[0].time, '11:45');
  assert.equal(appointments[0].location, 'Amsterdam');
  assert.equal(appointments[0].summary, 'Lead ingepland op Amsterdam');
  assert.equal(appointments[0].needsConfirmationEmail, false);
  assert.equal(appointments[0].confirmationResponseReceived, true);
  assert.equal(dismissCalls[0].reason, 'confirmation_task_set_in_agenda_dismiss');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_lead_set_in_agenda');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

test('agenda confirmation coordinator waits for queued persist before removing a lead task', async () => {
  const { activityCalls, appointments, coordinator, dismissCalls, persistWaitCalls } = createFixture({
    appointments: [
      {
        id: 202,
        company: 'Softora',
        contact: 'Serve Creusen',
        phone: '0612345678',
        date: '2026-04-09',
        time: '10:30',
        source: 'AI Cold Calling',
        summary: 'Lead opvolgen na interesse.',
        callId: 'call-1',
        provider: 'retell',
        aiGenerated: true,
        needsConfirmationEmail: true,
        confirmationTaskType: 'lead_follow_up',
        confirmationEmailSent: false,
        confirmationResponseReceived: false,
        confirmationAppointmentCancelled: false,
      },
    ],
  });
  const res = createResponseRecorder();

  await coordinator.markLeadTaskCancelledById(
    {
      body: {
        actor: 'Serve',
      },
    },
    res,
    '202'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.cancelled, true);
  assert.equal(appointments[0].confirmationAppointmentCancelled, true);
  assert.equal(dismissCalls[0].reason, 'confirmation_task_mark_cancelled_dismiss');
  assert.equal(activityCalls[0].reason, 'dashboard_activity_mark_cancelled');
  assert.deepEqual(persistWaitCalls, ['waited']);
});

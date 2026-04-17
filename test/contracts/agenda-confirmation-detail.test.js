const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaConfirmationDetailHelpers } = require('../../server/services/agenda-confirmation-detail');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeEmailAddress(value) {
  return normalizeString(value).toLowerCase();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

test('agenda confirmation detail helpers build stable task detail payloads from appointment, call and AI data', () => {
  const aiCallInsightsByCallId = new Map([['call-1', { summary: 'AI inschatting: warme lead.' }]]);
  const helpers = createAgendaConfirmationDetailHelpers({
    aiCallInsightsByCallId,
    mapAppointmentToConfirmationTask: (appointment) => ({
      id: Number(appointment.id) || 0,
      appointmentId: Number(appointment.id) || 0,
      company: normalizeString(appointment.company || ''),
      callId: normalizeString(appointment.callId || ''),
      provider: normalizeString(appointment.provider || ''),
      summary: normalizeString(appointment.summary || ''),
    }),
    getLatestCallUpdateByCallId: () => ({
      summary: 'Klant wil een nieuwe website.',
      transcriptSnippet: 'We plannen donderdag om half elf.',
      status: 'completed',
      messageType: 'call_ended',
      endedReason: 'completed',
    }),
    pickReadableConversationSummaryForLeadDetail: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    getAppointmentTranscriptText: () => 'Volledig transcript',
    resolvePreferredRecordingUrl: () => 'https://media.softora.nl/call-1.mp3',
    sanitizeAppointmentLocation: (value) => normalizeString(value),
    resolveAgendaLocationValue: (...values) => values.map((value) => normalizeString(value)).find(Boolean) || '',
    sanitizeAppointmentWhatsappInfo: (value) => normalizeString(value),
    resolveCallDurationSeconds: () => 180,
    normalizeString,
    normalizeEmailAddress,
    truncateText,
  });

  const detail = helpers.buildConfirmationTaskDetail({
    id: 101,
    company: 'Softora',
    callId: 'call-1',
    provider: 'retell',
    summary: 'Afspraak over de nieuwe website.',
    location: 'Amsterdam',
    contactEmail: 'Klant@Voorbeeld.NL',
    whatsappInfo: 'Stuur route via WhatsApp',
    confirmationEmailDraft: 'Onderwerp: Bevestiging',
  });

  assert.equal(detail.id, 101);
  assert.equal(detail.location, 'Amsterdam');
  assert.equal(detail.contactEmail, 'klant@voorbeeld.nl');
  assert.equal(detail.durationSeconds, 180);
  assert.equal(detail.transcript, 'Volledig transcript');
  assert.equal(detail.recordingUrl, 'https://media.softora.nl/call-1.mp3');
  assert.equal(detail.aiSummary, 'AI inschatting: warme lead.');
  assert.equal(detail.rawStatus.callStatus, 'completed');
});

test('agenda confirmation detail helpers prefer Twilio media urls when the recording sid is available', async () => {
  const fetchCalls = [];
  const helpers = createAgendaConfirmationDetailHelpers({
    normalizeString,
    normalizeEmailAddress,
    truncateText,
    resolvePreferredRecordingUrl: () => 'https://www.softora.nl/api/coldcalling/recording-proxy/call-1',
    extractTwilioRecordingSidFromUrl: () => 'RE123',
    isTwilioStatusApiConfigured: () => true,
    buildTwilioRecordingMediaUrl: () => 'https://api.twilio.com/recordings/RE123.mp3',
    fetchBinaryWithTimeout: async (url, options, timeoutMs) => {
      fetchCalls.push({ url: String(url), options, timeoutMs });
      return {
        response: {
          ok: true,
          status: 200,
          headers: { get: () => 'audio/mp3' },
        },
        bytes: Buffer.from('audio'),
      };
    },
    getTwilioBasicAuthorizationHeader: () => 'Basic abc',
    buildRecordingFileNameForTranscription: (id) => `${id}.mp3`,
  });

  const recording = await helpers.fetchRecordingForConfirmationTaskDetail(
    { headers: {} },
    { id: 101, callId: 'call-1', provider: 'twilio' },
    { id: 101, callId: 'call-1', provider: 'twilio', recordingSid: 'RE123' }
  );

  assert.equal(recording.sourceUrl, 'https://api.twilio.com/recordings/RE123.mp3');
  assert.equal(recording.fileName, 'call-1.mp3');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Basic abc');
});

test('agenda confirmation detail helpers transcribe fetched recordings through OpenAI when an API key is configured', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text: ' Hallo wereld ' }),
  });

  try {
    const helpers = createAgendaConfirmationDetailHelpers({
      openAiApiBaseUrl: 'https://api.openai.com/v1',
      normalizeString,
      normalizeEmailAddress,
      truncateText,
      getOpenAiApiKey: () => 'sk-test',
      resolvePreferredRecordingUrl: () => 'https://media.softora.nl/call-1.mp3',
      fetchBinaryWithTimeout: async () => ({
        response: {
          ok: true,
          status: 200,
          headers: { get: () => 'audio/mpeg' },
        },
        bytes: Buffer.from('audio'),
      }),
      buildRecordingFileNameForTranscription: () => 'call-1.mp3',
      normalizeAbsoluteHttpUrl: (value) => normalizeString(value),
      getOpenAiTranscriptionModelCandidates: () => ['gpt-4o-mini-transcribe'],
      parseJsonLoose: (value) => {
        try {
          return JSON.parse(value);
        } catch (_error) {
          return null;
        }
      },
    });

    const transcript = await helpers.transcribeConfirmationTaskRecording(
      { headers: {} },
      { id: 101, callId: 'call-1' },
      { id: 101, callId: 'call-1' }
    );

    assert.equal(transcript, 'Hallo wereld');
  } finally {
    global.fetch = originalFetch;
  }
});

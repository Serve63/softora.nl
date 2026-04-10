const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaLeadDetailService } = require('../../server/services/agenda-lead-detail');

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

function extractTranscriptFull(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return normalizeString(
    payload.transcriptFull || payload.transcript || payload.data?.transcriptFull || ''
  );
}

function createFixture(overrides = {}) {
  const recentWebhookEvents = overrides.recentWebhookEvents || [];
  const recentCallUpdates = overrides.recentCallUpdates || [];
  const aiCallInsightsByCallId = new Map(overrides.aiCallInsightsByCallId || []);
  const transcriptionPromiseByCallId = new Map();
  const upsertCalls = [];
  const aiAnalyzeCalls = [];

  const service = createAgendaLeadDetailService({
    openAiApiBaseUrl: 'https://api.openai.com/v1',
    openAiTranscriptionModel: overrides.openAiTranscriptionModel || '',
    openAiAudioTranscriptionModel: overrides.openAiAudioTranscriptionModel || '',
    publicBaseUrl: 'https://www.softora.nl',
    recentWebhookEvents,
    recentCallUpdates,
    transcriptionPromiseByCallId,
    aiCallInsightsByCallId,
    normalizeString,
    truncateText,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation: (value) => truncateText(value, 220),
    sanitizeAppointmentWhatsappInfo: (value) => truncateText(value, 6000),
    resolveAppointmentCallId: (appointment) => normalizeString(appointment?.callId || ''),
    getLatestCallUpdateByCallId: (callId) =>
      recentCallUpdates.find((item) => normalizeString(item?.callId || '') === normalizeString(callId)) ||
      null,
    resolvePreferredRecordingUrl: (...sources) => {
      for (const source of sources) {
        const value = normalizeString(source?.recordingUrl || '');
        if (value) return value;
      }
      return '';
    },
    normalizeAbsoluteHttpUrl: (value) => normalizeString(value),
    inferCallProvider: (_callId, fallbackProvider = 'retell') => normalizeString(fallbackProvider || 'retell'),
    isTwilioStatusApiConfigured: () => false,
    fetchTwilioRecordingsByCallId: async () => ({ recordings: [] }),
    choosePreferredTwilioRecording: () => null,
    buildTwilioRecordingMediaUrl: () => '',
    fetchBinaryWithTimeout: async () => ({
      response: { ok: true, status: 200, headers: { get: () => 'audio/mpeg' } },
      bytes: Buffer.from('audio'),
    }),
    getTwilioBasicAuthorizationHeader: () => 'Basic abc',
    parseJsonLoose: (value) => {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return null;
      }
    },
    getOpenAiApiKey: () => normalizeString(overrides.openAiApiKey || ''),
    fetchImpl:
      overrides.fetchImpl ||
      (async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: 'Volledige transcriptie van het gesprek.' }),
      })),
    upsertRecentCallUpdate: (update) => {
      upsertCalls.push(update);
      return update;
    },
    ensureRuleBasedInsightAndAppointment:
      overrides.ensureRuleBasedInsightAndAppointment ||
      ((callUpdate) => ({
        callId: normalizeString(callUpdate?.callId || ''),
        summary: 'Rule insight',
      })),
    maybeAnalyzeCallUpdateWithAi:
      overrides.maybeAnalyzeCallUpdateWithAi ||
      (async (callUpdate) => {
        aiAnalyzeCalls.push(callUpdate);
        return null;
      }),
    summaryContainsEnglishMarkers: (value) =>
      /\b(meeting|follow-up|appointment|other info from whatsapp)\b/i.test(normalizeString(value)),
    generateTextSummaryWithAi:
      overrides.generateTextSummaryWithAi ||
      (async () => ({
        summary: 'Korte Nederlandse belnotitie.',
      })),
    resolveCallDurationSeconds: (...sources) => {
      for (const source of sources) {
        const parsed = Number(source?.durationSeconds || 0);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
      return null;
    },
    findInterestedLeadRowByCallId:
      overrides.findInterestedLeadRowByCallId ||
      ((callId) => {
        const rows = overrides.interestedLeads || [];
        return rows.find((item) => normalizeString(item?.callId || '') === normalizeString(callId)) || null;
      }),
    getRuntimeSnapshotItemTimestampMs: (value) =>
      Date.parse(normalizeString(value?.updatedAt || value?.createdAt || '')) || 0,
    normalizeLeadLikePhoneKey: (value) => normalizeString(value).replace(/\D+/g, ''),
    extractTranscriptFull,
    extractTwilioRecordingSidFromUrl: (value) => {
      const match = normalizeString(value).match(/\/Recordings\/(RE[0-9a-f]{32})/i);
      return normalizeString(match?.[1] || '');
    },
    logger: {
      warn() {},
    },
  });

  return {
    aiAnalyzeCalls,
    service,
    transcriptionPromiseByCallId,
    upsertCalls,
  };
}

test('agenda lead detail service resolves transcript fallbacks from appointment, call update and webhook events', () => {
  const fixture = createFixture({
    recentWebhookEvents: [
      {
        callId: 'call-webhook',
        payload: {
          transcriptFull: 'Transcript uit webhook.',
        },
      },
    ],
    recentCallUpdates: [
      {
        callId: 'call-update',
        transcriptSnippet: 'Transcript uit call update.',
      },
    ],
  });

  assert.equal(
    fixture.service.getAppointmentTranscriptText({
      callId: 'call-direct',
      leadConversationTranscript: 'Direct opgeslagen transcript.',
    }),
    'Direct opgeslagen transcript.'
  );
  assert.equal(
    fixture.service.getAppointmentTranscriptText({
      callId: 'call-update',
    }),
    'Transcript uit call update.'
  );
  assert.equal(
    fixture.service.getAppointmentTranscriptText({
      callId: 'call-webhook',
    }),
    'Transcript uit webhook.'
  );
});

test('agenda lead detail service filters noisy summaries and keeps readable Dutch conversation notes', async () => {
  const fixture = createFixture();

  assert.equal(
    fixture.service.pickReadableConversationSummaryForLeadDetail(
      'Nog geen gesprekssamenvatting beschikbaar.',
      'Appointment booked with client.',
      'Klant wil een nieuwe website en staat open voor vervolgstap.'
    ),
    'Klant wil een nieuwe website en staat open voor vervolgstap.'
  );

  const summary = await fixture.service.buildConversationSummaryForLeadDetail(
    {
      summary: 'Afspraak ingepland voor morgen.',
      transcriptSnippet: 'klant: we willen snel door met de nieuwe website.',
    },
    {
      summary: 'Appointment follow-up needed.',
    },
    {
      summary: 'Nog geen gesprekssamenvatting beschikbaar.',
      whatsappInfo: 'Stuur later een mail.',
    },
    ''
  );

  assert.equal(summary, 'we willen snel door met de nieuwe website.');
});

test('agenda lead detail service rewrites direct speech into a proper Dutch call note', async () => {
  let summaryPayload = null;
  const fixture = createFixture({
    openAiApiKey: 'test-key',
    generateTextSummaryWithAi: async (payload) => {
      summaryPayload = payload;
      return {
        summary:
          'De prospect gaf al snel aan geïnteresseerd te zijn in een vervolgafspraak over de website. Er is besproken dat Softora in een volgende stap de mogelijkheden toelicht.',
      };
    },
  });

  assert.equal(
    fixture.service.pickReadableConversationSummaryForLeadDetail(
      'Hallo, met Eric Boonaan. Hey, goedemiddag, je spreekt met Ruben Nijhuis van Softora, ik bel je even omdat...',
      'De prospect gaf aan open te staan voor een vervolgafspraak.'
    ),
    'De prospect gaf aan open te staan voor een vervolgafspraak.'
  );

  const summary = await fixture.service.buildConversationSummaryForLeadDetail(
    {
      summary:
        'Hallo, met Eric Boonaan. Hey, goedemiddag, je spreekt met Ruben Nijhuis van Softora, ik bel je even omdat...',
      transcriptSnippet:
        'Hallo, met Eric Boonaan. Hey, goedemiddag, je spreekt met Ruben Nijhuis van Softora, ik bel je even omdat de website verouderd oogt.',
    },
    {
      summary: '',
      followUpReason: 'Plan een afspraak.',
    },
    null,
    'Hallo, met Eric Boonaan. Hey, goedemiddag, je spreekt met Ruben Nijhuis van Softora. De prospect geeft aan interesse te hebben in een afspraak.'
  );

  assert.match(summary, /prospect gaf al snel aan geïnteresseerd te zijn/i);
  assert.match(summaryPayload?.extraInstructions || '', /Schrijf in de derde persoon/i);
  assert.match(summaryPayload?.extraInstructions || '', /nooit met ellips of afgebroken tekst/i);
});

test('agenda lead detail service builds stable call-backed detail payloads', async () => {
  const fixture = createFixture({
    recentCallUpdates: [
      {
        callId: 'call-42',
        company: 'Softora',
        name: 'Servé Creusen',
        phone: '0612345678',
        provider: 'retell',
        summary: 'Prospect wil een nieuwe website en staat open voor overleg.',
        transcriptFull: 'We hebben besproken dat de site deze maand vernieuwd moet worden.',
        transcriptSnippet: 'Nieuwe website deze maand.',
        recordingUrl: 'https://cdn.softora.nl/recordings/call-42.mp3',
        durationSeconds: 187,
        updatedAt: '2026-04-08T12:00:00.000Z',
      },
    ],
    aiCallInsightsByCallId: [
      [
        'call-42',
        {
          callId: 'call-42',
          summary: 'Warme lead met concrete websitevraag.',
          followUpReason: 'Plan een intake.',
          analyzedAt: '2026-04-08T12:05:00.000Z',
        },
      ],
    ],
    interestedLeads: [
      {
        callId: 'call-42',
        company: 'Softora',
        contact: 'Servé Creusen',
        phone: '0612345678',
        date: '2026-04-10',
        time: '09:30',
        location: 'Keizersgracht 1, Amsterdam',
        whatsappInfo: 'App vooraf even voor parkeren.',
        createdAt: '2026-04-08T11:00:00.000Z',
      },
    ],
  });

  const detail = await fixture.service.buildCallBackedLeadDetail('call-42');

  assert.equal(detail.callId, 'call-42');
  assert.equal(detail.company, 'Softora');
  assert.equal(detail.contact, 'Servé Creusen');
  assert.equal(detail.date, '2026-04-10');
  assert.equal(detail.time, '09:30');
  assert.equal(detail.location, 'Keizersgracht 1, Amsterdam');
  assert.equal(detail.whatsappInfo, 'App vooraf even voor parkeren.');
  assert.equal(detail.recordingUrlAvailable, true);
  assert.equal(detail.durationSeconds, 187);
  assert.match(detail.summary, /website/i);
});

test('agenda lead detail service exposes recording filename and transcription model helpers', () => {
  const fixture = createFixture({
    openAiTranscriptionModel: 'gpt-4o-mini-transcribe',
  });

  assert.equal(
    fixture.service.buildRecordingFileNameForTranscription(
      'call 42',
      'audio/mpeg',
      'https://cdn.softora.nl/audio/test.mp3'
    ),
    'call-42.mp3'
  );
  assert.deepEqual(fixture.service.getOpenAiTranscriptionModelCandidates(), [
    'gpt-4o-mini-transcribe',
    'gpt-4o-transcribe',
    'whisper-1',
  ]);
});

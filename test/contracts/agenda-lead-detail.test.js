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
  const aiInsightUpserts = [];
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
    upsertAiCallInsight: (insight) => {
      aiInsightUpserts.push(insight);
      aiCallInsightsByCallId.set(normalizeString(insight?.callId || ''), insight);
      return insight;
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
    aiInsightUpserts,
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
      'Bevestigingsmail sturen op basis van gedetecteerde afspraak in gesprekstranscriptie.',
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
          'De agent gaf al snel aan dat Softora een vervolgafspraak kan plannen over de website. De prospect stond open voor de volgende stap.',
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

  assert.match(summary, /De prospect stond open voor de volgende stap/i);
  assert.match(summary, /Ruben Nijhuis gaf al snel aan/i);
  assert.doesNotMatch(summary, /\bagent\b/i);
  assert.match(summaryPayload?.text || '', /Gebruik de transcriptie hieronder als bron van waarheid/i);
  assert.doesNotMatch(summaryPayload?.text || '', /Plan een afspraak/i);
  assert.match(summaryPayload?.extraInstructions || '', /Schrijf in de derde persoon/i);
  assert.match(summaryPayload?.extraInstructions || '', /Ruben Nijhuis/i);
  assert.match(summaryPayload?.extraInstructions || '', /Gebruik nooit het woord "agent"/i);
  assert.match(summaryPayload?.extraInstructions || '', /nooit met ellips of afgebroken tekst/i);
});

test('agenda lead detail service builds a transcript-based fallback summary when AI rewrite is unavailable', async () => {
  const fixture = createFixture({
    openAiApiKey: '',
  });

  const summary = await fixture.service.buildConversationSummaryForLeadDetail(
    {
      name: 'Eric Boonaan',
      company: 'Servé Creusen',
      summary: '',
      transcriptSnippet:
        'Hallo, met Eric Boonaan. Je spreekt met Ruben Nijhuis van Softora. Ik bel omdat de website verouderd oogt. Ik wil graag meteen een afspraak inplannen voor morgen om twaalf uur bij mij op kantoor.',
    },
    {
      summary: '',
      followUpReason: '',
    },
    {
      date: '2026-04-11',
      time: '12:00',
      location: 'Medialaan 65 6087DE Amersfoort',
    },
    'Hallo, met Eric Boonaan. Je spreekt met Ruben Nijhuis van Softora. Ik bel omdat de website verouderd oogt qua design en technische opbouw. Ik wil graag meteen een afspraak inplannen voor morgen om twaalf uur bij mij op kantoor.'
  );

  assert.match(summary, /Ruben Nijhuis gaf aan dat de website van Servé Creusen verouderd oogt/i);
  assert.match(summary, /Eric Boonaan reageerde positief en wilde een afspraak inplannen op 2026-04-11 om 12:00 bij Medialaan 65 6087DE Amersfoort/i);
  assert.doesNotMatch(summary, /De logische vervolgstap is om de afspraak te bevestigen en intern op te volgen/i);
  assert.doesNotMatch(summary, /\bagent\b/i);
});

test('agenda lead detail service persists transcript-based summaries back into call state', async () => {
  const fixture = createFixture({
    openAiApiKey: 'test-key',
    recentCallUpdates: [
      {
        callId: 'call-persist',
        company: 'Servé Creusen',
        phone: '+31629917185',
        summary:
          'Hallo, met Eric Boonaan. Hey, goedemiddag, je spreekt met Ruben Nijhuis van Softora...',
        transcriptFull:
          'Hallo, met Eric Boonaan. Hey, goedemiddag, je spreekt met Ruben Nijhuis van Softora. De prospect geeft aan open te staan voor een afspraak over de website.',
        transcriptSnippet:
          'Hallo, met Eric Boonaan. De prospect geeft aan open te staan voor een afspraak over de website.',
        recordingUrl: 'https://www.softora.nl/audio/test.mp3',
        updatedAt: '2026-04-10T14:48:00.000Z',
      },
    ],
    aiCallInsightsByCallId: [
      [
        'call-persist',
        {
          callId: 'call-persist',
          summary: 'Rule insight',
          analyzedAt: '2026-04-10T14:48:10.000Z',
        },
      ],
    ],
    generateTextSummaryWithAi: async () => ({
      summary:
        'De prospect gaf tijdens het gesprek aan geïnteresseerd te zijn in een afspraak over de website. Softora kan in een vervolgstap de mogelijkheden toelichten.',
    }),
  });

  const detail = await fixture.service.buildCallBackedLeadDetail('call-persist');

  assert.match(detail?.summary || '', /prospect gaf tijdens het gesprek aan geïnteresseerd te zijn/i);
  assert.match(detail?.transcript || '', /je spreekt met Ruben Nijhuis van Softora/i);
  assert.ok(
    fixture.upsertCalls.some(
      (update) =>
        normalizeString(update?.callId) === 'call-persist' &&
        /prospect gaf tijdens het gesprek aan geïnteresseerd te zijn/i.test(
          normalizeString(update?.summary || '')
        )
    )
  );
  assert.ok(
    fixture.aiInsightUpserts.some(
      (insight) =>
        normalizeString(insight?.callId) === 'call-persist' &&
        /prospect gaf tijdens het gesprek aan geïnteresseerd te zijn/i.test(
          normalizeString(insight?.summary || '')
        )
    )
  );
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

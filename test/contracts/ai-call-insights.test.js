const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiCallInsightRuntime } = require('../../server/services/ai-call-insights');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function normalizeDateYyyyMmDd(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return '';
}

function normalizeTimeHhMm(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function normalizeColdcallingStack(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw.includes('openai')) return 'openai_realtime_1_5';
  return raw;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBooleanSafe(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function createRuntime(overrides = {}) {
  const recentCallUpdates = overrides.recentCallUpdates || [];
  const callUpdatesById = overrides.callUpdatesById || new Map();
  const recentAiCallInsights = overrides.recentAiCallInsights || [];
  const aiCallInsightsByCallId = overrides.aiCallInsightsByCallId || new Map();
  const aiAnalysisFingerprintByCallId = overrides.aiAnalysisFingerprintByCallId || new Map();
  const aiAnalysisInFlightCallIds = overrides.aiAnalysisInFlightCallIds || new Set();
  const agendaAppointmentIdByCallId = overrides.agendaAppointmentIdByCallId || new Map();
  const savedAppointments = [];
  const updatedCallSummaries = [];

  const runtime = createAiCallInsightRuntime({
    normalizeString,
    truncateText,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    normalizeColdcallingStack,
    normalizeEmailAddress: (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe,
    toBooleanSafe,
    formatEuroLabel: (value) => (value ? `EUR ${value}` : ''),
    getColdcallingStackLabel: (value) =>
      value === 'openai_realtime_1_5' ? 'OpenAI Realtime 1.5' : normalizeString(value),
    resolvePreferredRecordingUrl: (callUpdate) => normalizeString(callUpdate?.recordingUrl || ''),
    getOpenAiApiKey: () => overrides.openAiApiKey || '',
    fetchJsonWithTimeout:
      overrides.fetchJsonWithTimeout ||
      (async () => {
        throw new Error('OpenAI tijdelijk niet bereikbaar');
      }),
    extractOpenAiTextContent: (content) => normalizeString(content),
    parseJsonLoose: (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-4o-mini',
    buildLeadOwnerFields: () => ({ leadOwnerName: 'Servé Creusen' }),
    queueRuntimeStatePersist: () => {},
    upsertRecentCallUpdate: (update) => {
      updatedCallSummaries.push(update);
      const current = callUpdatesById.get(update.callId) || {};
      const merged = { ...current, ...update };
      callUpdatesById.set(update.callId, merged);
      return merged;
    },
    upsertGeneratedAgendaAppointment: (appointment, callId) => {
      const saved = { ...appointment, id: savedAppointments.length + 1 };
      savedAppointments.push(saved);
      agendaAppointmentIdByCallId.set(callId, saved.id);
      return saved;
    },
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls: () => 0,
    repairAgendaAppointmentsFromDashboardActivities: () => 0,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    aiAnalysisFingerprintByCallId,
    aiAnalysisInFlightCallIds,
    agendaAppointmentIdByCallId,
    logger: { log() {}, error() {} },
  });

  return {
    runtime,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    aiCallInsightsByCallId,
    agendaAppointmentIdByCallId,
    savedAppointments,
    updatedCallSummaries,
  };
}

test('ai call insight runtime materializes rule-based appointments from transcript cues', () => {
  const context = createRuntime();
  const callUpdate = {
    callId: 'call_rule',
    company: 'Softora',
    name: 'Serve',
    phone: '+31612345678',
    transcriptFull:
      'We plannen morgen om 14 uur een afspraak en sturen daarna een bevestiging.',
    updatedAt: '2026-04-16T10:00:00Z',
    status: 'completed',
    provider: 'retell',
    stack: 'openai',
    recordingUrl: 'https://cdn.softora.test/call_rule.mp3',
  };

  context.recentCallUpdates.push(callUpdate);
  context.callUpdatesById.set(callUpdate.callId, callUpdate);

  const insight = context.runtime.ensureRuleBasedInsightAndAppointment(callUpdate);

  assert.equal(insight?.appointmentBooked, true);
  assert.ok(insight?.agendaAppointmentId);
  assert.equal(context.savedAppointments.length, 1);
  assert.equal(context.savedAppointments[0].time, '14:00');
});

test('ai call insight runtime falls back to rule-based insight when OpenAI analysis fails', async () => {
  const context = createRuntime({ openAiApiKey: 'sk-test' });
  const callUpdate = {
    callId: 'call_fallback',
    company: 'Softora',
    name: 'Serve',
    phone: '+31612345678',
    summary: '',
    transcriptSnippet: 'Klant wil graag een demo en morgen om 09:30 teruggebeld worden.',
    transcriptFull:
      'Klant wil graag een demo en morgen om 09:30 teruggebeld worden. We plannen een afspraak in.',
    updatedAt: '2026-04-16T10:00:00Z',
    status: 'completed',
    provider: 'retell',
    stack: 'openai',
  };

  context.callUpdatesById.set(callUpdate.callId, callUpdate);

  const insight = await context.runtime.maybeAnalyzeCallUpdateWithAi(callUpdate);

  assert.equal(insight?.source, 'rule');
  assert.equal(insight?.appointmentBooked, true);
  assert.equal(context.recentAiCallInsights[0]?.callId, 'call_fallback');
  assert.equal(context.updatedCallSummaries.length, 1);
  assert.match(context.updatedCallSummaries[0].summary, /demo|afspraak/i);
  assert.equal(context.savedAppointments.length, 1);
});

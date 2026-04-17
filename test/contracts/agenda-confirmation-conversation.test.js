const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgendaConfirmationConversationHelpers,
} = require('../../server/services/agenda-confirmation-conversation');

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

test('agenda confirmation conversation helpers reuse existing readable conversation state without extra fetches', async () => {
  let buildCallBackedLeadDetailCalls = 0;
  const helpers = createAgendaConfirmationConversationHelpers({
    resolveAppointmentCallId: (appointment) => normalizeString(appointment?.callId || ''),
    normalizeString,
    truncateText,
    pickReadableConversationSummaryForLeadDetail: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    buildCallBackedLeadDetail: async () => {
      buildCallBackedLeadDetailCalls += 1;
      return null;
    },
  });

  const detail = await helpers.enrichConfirmationTaskDetailWithConversationSummary(
    { body: {} },
    0,
    { id: 101, callId: 'call-1', leadConversationSummary: 'Bestaande samenvatting' },
    {
      id: 101,
      callId: 'call-1',
      conversationSummary: 'Bestaande samenvatting',
      transcript: 'Bestaand transcript',
      recordingUrlAvailable: true,
    }
  );

  assert.equal(detail.summary, 'Bestaande samenvatting');
  assert.equal(detail.transcriptAvailable, true);
  assert.equal(buildCallBackedLeadDetailCalls, 0);
});

test('agenda confirmation conversation helpers materialize call-backed details and persist them on the appointment row', async () => {
  const appointments = [{ id: 101, callId: 'call-1', whatsappInfo: 'Stuur route' }];
  const setCalls = [];
  const helpers = createAgendaConfirmationConversationHelpers({
    getGeneratedAgendaAppointments: () => appointments,
    setGeneratedAgendaAppointmentAtIndex: (idx, nextValue, reason) => {
      appointments[idx] = { ...nextValue };
      setCalls.push({ idx, nextValue: appointments[idx], reason });
      return appointments[idx];
    },
    resolveAppointmentCallId: (appointment) => normalizeString(appointment?.callId || ''),
    normalizeString,
    truncateText,
    pickReadableConversationSummaryForLeadDetail: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    buildCallBackedLeadDetail: async () => ({
      callId: 'call-1',
      callSummary: '',
      aiSummary: '',
      transcriptSnippet: 'We spreken donderdag af.',
      followUpReason: 'Route via WhatsApp sturen',
      recordingUrl: 'https://media.softora.nl/call-1.mp3',
    }),
    buildConversationSummaryForLeadDetail: async () => 'Klant bevestigt interesse in een nieuwe website.',
    transcribeConfirmationTaskRecording: async () => '',
  });

  const detail = await helpers.enrichConfirmationTaskDetailWithConversationSummary(
    { body: {} },
    0,
    appointments[0],
    {
      id: 101,
      callId: 'call-1',
      summary: '',
      callSummary: '',
      aiSummary: '',
      transcriptSnippet: '',
      whatsappInfo: 'Stuur route',
      recordingUrl: '',
    }
  );

  assert.equal(detail.summary, 'Klant bevestigt interesse in een nieuwe website.');
  assert.equal(detail.transcript, '');
  assert.equal(detail.recordingUrl, 'https://media.softora.nl/call-1.mp3');
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].reason, 'confirmation_task_conversation_materialized');
  assert.equal(appointments[0].leadConversationSummary, 'Klant bevestigt interesse in een nieuwe website.');
});

test('agenda confirmation conversation helpers de-duplicate concurrent enrich calls for the same task', async () => {
  let buildCalls = 0;
  const pending = new Promise((resolve) => setTimeout(() => resolve({
    callId: 'call-1',
    callSummary: 'Samenvatting',
    aiSummary: '',
    transcriptSnippet: 'Snippet',
    followUpReason: '',
    recordingUrl: '',
  }), 20));
  const helpers = createAgendaConfirmationConversationHelpers({
    resolveAppointmentCallId: (appointment) => normalizeString(appointment?.callId || ''),
    normalizeString,
    truncateText,
    pickReadableConversationSummaryForLeadDetail: (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    buildCallBackedLeadDetail: async () => {
      buildCalls += 1;
      return await pending;
    },
    buildConversationSummaryForLeadDetail: async () => 'Samenvatting',
    transcribeConfirmationTaskRecording: async () => '',
  });

  const appointment = { id: 101, callId: 'call-1' };
  const detail = { id: 101, callId: 'call-1', summary: '' };
  const [first, second] = await Promise.all([
    helpers.enrichConfirmationTaskDetailWithConversationSummary({ body: {} }, 0, appointment, detail),
    helpers.enrichConfirmationTaskDetailWithConversationSummary({ body: {} }, 0, appointment, detail),
  ]);

  assert.equal(first.summary, 'Samenvatting');
  assert.equal(second.summary, 'Samenvatting');
  assert.equal(buildCalls, 1);
});

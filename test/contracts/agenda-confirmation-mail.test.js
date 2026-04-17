const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaConfirmationMailHelpers } = require('../../server/services/agenda-confirmation-mail');

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

test('agenda confirmation mail helpers materialize a fallback draft only when missing', () => {
  const appointments = [{ id: 101, company: 'Softora', confirmationEmailDraft: '' }];
  const setCalls = [];
  const helpers = createAgendaConfirmationMailHelpers({
    getGeneratedAgendaAppointments: () => appointments,
    setGeneratedAgendaAppointmentAtIndex: (idx, nextValue, reason) => {
      appointments[idx] = { ...nextValue };
      setCalls.push({ idx, nextValue: appointments[idx], reason });
      return appointments[idx];
    },
    buildConfirmationTaskDetail: () => ({ summary: 'Afspraakdetail' }),
    buildConfirmationEmailDraftFallback: (appointment) =>
      `Onderwerp: Bevestiging afspraak met ${normalizeString(appointment?.company || 'uw bedrijf')}`,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
  });

  const updated = helpers.ensureConfirmationEmailDraftAtIndex(0, { reason: 'confirmation_task_detail_auto_draft' });

  assert.match(updated.confirmationEmailDraft, /Onderwerp:/);
  assert.equal(updated.confirmationEmailDraftSource, 'template-auto');
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].reason, 'confirmation_task_detail_auto_draft');
});

test('agenda confirmation mail helpers fall back to the template when no OpenAI key is configured', async () => {
  const helpers = createAgendaConfirmationMailHelpers({
    buildConfirmationEmailDraftFallback: () => 'Onderwerp: Template fallback',
    getOpenAiApiKey: () => '',
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
  });

  const result = await helpers.generateConfirmationEmailDraftWithAi({ company: 'Softora' }, {});

  assert.equal(result.source, 'template');
  assert.equal(result.draft, 'Onderwerp: Template fallback');
});

test('agenda confirmation mail helpers use the generated OpenAI draft when the API returns content', async () => {
  const helpers = createAgendaConfirmationMailHelpers({
    openAiApiBaseUrl: 'https://api.openai.com/v1',
    openAiModel: 'gpt-4o-mini',
    buildConfirmationEmailDraftFallback: () => 'Onderwerp: Template fallback',
    getOpenAiApiKey: () => 'sk-test',
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: {
        choices: [
          {
            message: {
              content: ' Onderwerp: AI concept\n\nBeste klant,\n\nTot donderdag. ',
            },
          },
        ],
      },
    }),
    extractOpenAiTextContent: (value) => normalizeString(value),
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    truncateText,
  });

  const result = await helpers.generateConfirmationEmailDraftWithAi(
    {
      company: 'Softora',
      contact: 'Serve',
      phone: '0612345678',
      date: '2026-04-10',
      time: '11:45',
    },
    {
      callSummary: 'Klant wil de afspraak graag bevestigd krijgen.',
      transcriptSnippet: 'Tot donderdag om kwart voor twaalf.',
    }
  );

  assert.equal(result.source, 'openai');
  assert.equal(result.model, 'gpt-4o-mini');
  assert.match(result.draft, /Onderwerp: AI concept/);
});

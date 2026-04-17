function createAgendaConfirmationMailHelpers(deps = {}) {
  const {
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiModel = 'gpt-4o-mini',
    getGeneratedAgendaAppointments = () => [],
    setGeneratedAgendaAppointmentAtIndex = () => null,
    buildConfirmationTaskDetail = () => ({}),
    buildConfirmationEmailDraftFallback = () => '',
    getOpenAiApiKey = () => '',
    fetchJsonWithTimeout = async () => ({
      response: { ok: false, status: 500 },
      data: null,
    }),
    extractOpenAiTextContent = (value) => String(value || ''),
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  function ensureConfirmationEmailDraftAtIndex(idx, options = {}) {
    const appointments = getGeneratedAgendaAppointments();
    if (!Number.isInteger(idx) || idx < 0 || idx >= appointments.length) return null;
    const appointment = appointments[idx];
    if (!appointment || typeof appointment !== 'object') return null;
    if (normalizeString(appointment?.confirmationEmailDraft || '')) return appointment;

    const detail = buildConfirmationTaskDetail(appointment) || {};
    const fallbackDraft = buildConfirmationEmailDraftFallback(appointment, detail);
    const nowIso = new Date().toISOString();
    return setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        confirmationEmailDraft: fallbackDraft,
        confirmationEmailDraftGeneratedAt:
          normalizeString(appointment?.confirmationEmailDraftGeneratedAt || '') || nowIso,
        confirmationEmailDraftSource:
          normalizeString(appointment?.confirmationEmailDraftSource || '') || 'template-auto',
      },
      normalizeString(options.reason || 'confirmation_task_auto_draft')
    );
  }

  async function generateConfirmationEmailDraftWithAi(appointment, detail = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      return {
        draft: buildConfirmationEmailDraftFallback(appointment, detail),
        source: 'template',
        model: null,
      };
    }

    const payload = {
      timezone: 'Europe/Amsterdam',
      appointment: {
        company: normalizeString(appointment?.company || ''),
        contact: normalizeString(appointment?.contact || ''),
        phone: normalizeString(appointment?.phone || ''),
        date: normalizeDateYyyyMmDd(appointment?.date),
        time: normalizeTimeHhMm(appointment?.time),
        source: normalizeString(appointment?.source || ''),
        branche: normalizeString(appointment?.branche || ''),
        value: normalizeString(appointment?.value || ''),
      },
      context: {
        aiSummary: truncateText(normalizeString(detail?.aiSummary || ''), 1000),
        callSummary: truncateText(normalizeString(detail?.callSummary || ''), 1000),
        transcriptSnippet: truncateText(normalizeString(detail?.transcriptSnippet || ''), 1200),
        transcript: truncateText(normalizeString(detail?.transcript || ''), 4000),
      },
    };

    const systemPrompt = [
      'Je bent een Nederlandse sales assistent.',
      'Schrijf een professionele maar korte bevestigingsmail na een telefonisch gesprek.',
      'Doel: afspraak bevestigen en de klant vragen om per mail te bevestigen dat tijd/datum klopt.',
      'Gebruik Nederlands.',
      'Geef alleen de emailtekst terug (met onderwerpregel bovenaan), geen markdown.',
      'Wees concreet over datum/tijd als aanwezig.',
      'Maximaal ongeveer 220 woorden.',
    ].join('\n');

    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      25000
    );

    if (!response.ok) {
      const err = new Error(`OpenAI bevestigingsmail generatie mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = extractOpenAiTextContent(content);
    const draft = normalizeString(text);
    if (!draft) {
      return {
        draft: buildConfirmationEmailDraftFallback(appointment, detail),
        source: 'template-fallback-empty',
        model: null,
      };
    }

    return {
      draft: truncateText(draft, 5000),
      source: 'openai',
      model: openAiModel,
    };
  }

  return {
    ensureConfirmationEmailDraftAtIndex,
    generateConfirmationEmailDraftWithAi,
  };
}

module.exports = {
  createAgendaConfirmationMailHelpers,
};

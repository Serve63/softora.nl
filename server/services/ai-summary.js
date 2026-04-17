function createAiSummaryService(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    fetchJsonWithTimeout = async () => ({
      response: { ok: true, status: 200 },
      data: {},
    }),
    getOpenAiApiKey = () => '',
    extractOpenAiTextContent = () => '',
    openAiApiBaseUrl = '',
    openAiModel = '',
  } = deps;

  function normalizeAiSummaryStyle(value) {
    const raw = normalizeString(value).toLowerCase();
    if (!raw) return 'medium';
    if (['short', 'medium', 'long', 'bullets'].includes(raw)) return raw;
    return '';
  }

  function isDutchLanguageRequest(value) {
    const raw = normalizeString(value).toLowerCase();
    return raw === 'nl' || raw.startsWith('nl-');
  }

  function countRegexMatches(value, regex) {
    const matches = String(value || '').match(regex);
    return Array.isArray(matches) ? matches.length : 0;
  }

  function summaryContainsEnglishMarkers(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return false;
    const strongMatches = countRegexMatches(
      normalized,
      /\b(the|call|conversation|agent|user|brief|outbound|inbound|ended|shortly|mentioned|during|standards|expectations|activities|interaction|follow-up|meeting|appointment|summary|details)\b/g
    );
    const mildMatches = countRegexMatches(
      normalized,
      /\b(was|were|is|are|had|with|after|before|where|for)\b/g
    );
    return strongMatches >= 2 || (strongMatches >= 1 && mildMatches >= 3) || mildMatches >= 6;
  }

  async function generateTextSummaryWithAi(options = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const sourceText = truncateText(normalizeString(options.text || ''), 20000);
    const style = normalizeAiSummaryStyle(options.style) || 'medium';
    const language = normalizeString(options.language || 'nl') || 'nl';
    const maxSentences = Math.max(
      1,
      Math.min(12, parseIntSafe(options.maxSentences, style === 'short' ? 2 : 4))
    );
    const forceDutchOnly = isDutchLanguageRequest(language);
    const skipLanguageRewrite = Boolean(options.skipLanguageRewrite);

    const systemPrompt = [
      'Je bent een nauwkeurige tekstassistent.',
      'Vat de input samen op basis van de gevraagde stijl.',
      'Gebruik de gevraagde taal.',
      forceDutchOnly
        ? 'Schrijf uitsluitend in natuurlijk Nederlands. Gebruik geen Engels, behalve onvermijdelijke eigennamen, merknamen, productnamen, URLs of exacte onvertaalbare termen.'
        : '',
      'Verzin geen feiten die niet in de bron staan.',
      'Geef alleen de samenvatting terug (geen markdown-uitleg of extra labels).',
    ]
      .filter(Boolean)
      .join('\n');

    const userPayload = {
      task: 'summarize',
      style,
      language,
      maxSentences,
      extraInstructions: normalizeString(options.extraInstructions || ''),
      text: sourceText,
    };

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
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                `Maak een samenvatting in taal: ${language}.`,
                `Stijl: ${style}.`,
                style === 'bullets'
                  ? `Geef maximaal ${Math.max(3, maxSentences)} bullets, elke regel start met "- ".`
                  : `Geef maximaal ${maxSentences} zinnen.`,
                normalizeString(options.extraInstructions || '')
                  ? `Extra instructies: ${normalizeString(options.extraInstructions || '')}`
                  : '',
                '',
                'Brontekst:',
                sourceText,
                '',
                'JSON context (ter controle):',
                JSON.stringify(userPayload),
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        }),
      },
      60000
    );

    if (!response.ok) {
      const err = new Error(`OpenAI samenvatting mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = normalizeString(extractOpenAiTextContent(content));
    if (!text) {
      const err = new Error('OpenAI gaf een lege samenvatting terug.');
      err.status = 502;
      err.data = data;
      throw err;
    }

    if (forceDutchOnly && !skipLanguageRewrite && summaryContainsEnglishMarkers(text)) {
      const rewritten = await generateTextSummaryWithAi({
        text,
        style,
        language,
        maxSentences,
        extraInstructions: [
          normalizeString(options.extraInstructions || ''),
          'Herschrijf deze samenvatting volledig in natuurlijk Nederlands.',
          'Behoud alle feiten en details.',
          'Gebruik geen Engels behalve onvermijdelijke eigennamen, merknamen, productnamen, URLs of exacte onvertaalbare termen.',
          style === 'bullets'
            ? `Behoud bullet-stijl met maximaal ${Math.max(3, maxSentences)} bullets.`
            : `Behoud doorlopende tekst met maximaal ${maxSentences} zinnen.`,
        ]
          .filter(Boolean)
          .join(' '),
        skipLanguageRewrite: true,
      });

      return {
        ...rewritten,
        summary: truncateText(normalizeString(rewritten.summary || text), 5000),
      };
    }

    return {
      summary: truncateText(text, 5000),
      style,
      language,
      maxSentences,
      source: 'openai',
      model: openAiModel,
      usage: data?.usage || null,
    };
  }

  return {
    countRegexMatches,
    generateTextSummaryWithAi,
    isDutchLanguageRequest,
    normalizeAiSummaryStyle,
    summaryContainsEnglishMarkers,
  };
}

module.exports = {
  createAiSummaryService,
};

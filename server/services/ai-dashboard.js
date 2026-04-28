function createAiDashboardCoordinator(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    parseJsonLoose = () => null,
    parseNumberSafe = (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    toBooleanSafe = (value, fallback = false) => {
      if (value === true || value === false) return value;
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return fallback;
      return /^(1|true|yes|ja|on)$/.test(raw);
    },
    resolvePreferredRecordingUrl = () => '',
    getUiStateValues = async () => null,
    premiumActiveOrdersScope = '',
    premiumCustomersScope = '',
    premiumActiveCustomOrdersKey = '',
    premiumActiveRuntimeKey = '',
    premiumCustomersKey = '',
    parseCustomOrdersFromUiState = () => [],
    recentCallUpdates = [],
    generatedAgendaAppointments = [],
    recentAiCallInsights = [],
    recentDashboardActivities = [],
    getOpenAiApiKey = () => '',
    getAnthropicApiKey = () => '',
    fetchJsonWithTimeout = async () => ({
      response: { ok: false, status: 500 },
      data: null,
    }),
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiModel = '',
    anthropicApiBaseUrl = 'https://api.anthropic.com/v1',
    anthropicModel = 'claude-sonnet-4-6',
    extractOpenAiTextContent = (content) => String(content || ''),
    ensureDashboardChatRuntimeReady = async () => {},
    normalizeAiSummaryStyle = () => '',
    generateTextSummaryWithAi = async () => ({
      summary: '',
      style: 'medium',
      language: 'nl',
      maxSentences: 4,
      source: '',
      model: '',
      usage: null,
    }),
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    rubenAssistant = null,
  } = deps;

  function extractAnthropicTextContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (item.type === 'text' || Object.prototype.hasOwnProperty.call(item, 'text')) {
          return normalizeString(item.text || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  function normalizeDashboardChatHistory(historyRaw) {
    if (!Array.isArray(historyRaw)) return [];
    return historyRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const roleRaw = normalizeString(item.role || '').toLowerCase();
        const role = roleRaw === 'assistant' ? 'assistant' : 'user';
        const content = truncateText(normalizeString(item.content || ''), 3000);
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean)
      .slice(-12);
  }

  function parseDashboardChatRuntimeByOrderId(rawValue) {
    const parsed = parseJsonLoose(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out = {};
    for (const [rawId, rawRuntime] of Object.entries(parsed)) {
      const id = Number(rawId);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!rawRuntime || typeof rawRuntime !== 'object' || Array.isArray(rawRuntime)) continue;
      out[String(id)] = {
        statusKey: normalizeString(rawRuntime.statusKey || ''),
        progressPct: parseNumberSafe(rawRuntime.progressPct, null),
        paidAt: normalizeString(rawRuntime.paidAt || ''),
        updatedAt: parseNumberSafe(rawRuntime.updatedAt, 0),
      };
    }
    return out;
  }

  function parseDashboardChatCustomers(rawValue) {
    const parsed = parseJsonLoose(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;

        const legacyAmount = parseNumberSafe(item.bedrag, null);
        const type = truncateText(normalizeString(item.type || 'Website'), 80) || 'Website';
        const websiteRaw = parseNumberSafe(item.websiteBedrag, null);
        const maintenanceRaw = parseNumberSafe(item.onderhoudPerMaand, null);

        const websiteBedrag = Number.isFinite(websiteRaw)
          ? Math.max(0, Math.round(websiteRaw))
          : ((type === 'Website' || type === 'Website + onderhoud') && Number.isFinite(legacyAmount)
              ? Math.max(0, Math.round(legacyAmount))
              : null);

        const onderhoudPerMaand = Number.isFinite(maintenanceRaw)
          ? Math.max(0, Math.round(maintenanceRaw))
          : (type === 'Onderhoud' && Number.isFinite(legacyAmount)
              ? Math.max(0, Math.round(legacyAmount))
              : null);

        const statusRaw = normalizeString(item.status || '').toLowerCase();
        const status = statusRaw === 'open' ? 'Open' : 'Betaald';

        return {
          id: normalizeString(item.id || '') || `dashboard-customer-${index + 1}`,
          naam: truncateText(normalizeString(item.naam || ''), 160) || 'Onbekend',
          bedrijf: truncateText(normalizeString(item.bedrijf || ''), 160) || '-',
          telefoon: truncateText(normalizeString(item.telefoon || ''), 80) || '-',
          website: truncateText(normalizeString(item.website || ''), 220) || '-',
          type,
          status,
          datum: normalizeDateYyyyMmDd(item.datum || ''),
          websiteBedrag,
          onderhoudPerMaand,
        };
      })
      .filter(Boolean);
  }

  function buildDashboardChatStatusCounts(rows, fieldName, fallback = 'Onbekend') {
    const counts = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = truncateText(normalizeString(row?.[fieldName] || ''), 80) || fallback;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function trimDashboardChatContextForModel(rawContext, maxChars = 52000) {
    const context = rawContext && typeof rawContext === 'object' ? rawContext : {};
    const cloned = JSON.parse(JSON.stringify(context));

    const listTargets = [
      ['orders', 'items', 24],
      ['customers', 'items', 30],
      ['calls', 'items', 24],
      ['agenda', 'items', 24],
      ['aiCallInsights', 'items', 24],
      ['recentActivities', null, 24],
    ];

    const safeStringify = () => {
      try {
        return JSON.stringify(cloned);
      } catch {
        return '{}';
      }
    };

    let serialized = safeStringify();
    if (serialized.length <= maxChars) return cloned;

    for (const [section, key, minCount] of listTargets) {
      const current =
        key === null
          ? (Array.isArray(cloned?.[section]) ? cloned[section] : null)
          : (Array.isArray(cloned?.[section]?.[key]) ? cloned[section][key] : null);
      if (!current || current.length <= minCount) continue;

      const reduced = current.slice(0, Math.max(minCount, Math.floor(current.length / 2)));
      if (key === null) cloned[section] = reduced;
      else cloned[section][key] = reduced;

      serialized = safeStringify();
      if (serialized.length <= maxChars) return cloned;
    }

    for (const [section, key, minCount] of listTargets) {
      const current =
        key === null
          ? (Array.isArray(cloned?.[section]) ? cloned[section] : null)
          : (Array.isArray(cloned?.[section]?.[key]) ? cloned[section][key] : null);
      if (!current || current.length <= minCount) continue;
      const reduced = current.slice(0, minCount);
      if (key === null) cloned[section] = reduced;
      else cloned[section][key] = reduced;
    }

    serialized = safeStringify();
    if (serialized.length <= maxChars) return cloned;

    for (const [section, key] of listTargets) {
      if (key === null) cloned[section] = [];
      else if (cloned?.[section] && typeof cloned[section] === 'object') cloned[section][key] = [];
    }

    return cloned;
  }

  async function buildPremiumDashboardChatContext() {
    const [orderState, customerState] = await Promise.all([
      getUiStateValues(premiumActiveOrdersScope),
      getUiStateValues(premiumCustomersScope),
    ]);

    const orderValues =
      orderState?.values && typeof orderState.values === 'object' ? orderState.values : {};
    const customerValues =
      customerState?.values && typeof customerState.values === 'object' ? customerState.values : {};

    const customOrders = parseCustomOrdersFromUiState(orderValues[premiumActiveCustomOrdersKey]);
    const runtimeByOrderId = parseDashboardChatRuntimeByOrderId(orderValues[premiumActiveRuntimeKey]);
    const customers = parseDashboardChatCustomers(customerValues[premiumCustomersKey]);

    const orders = customOrders
      .map((item) => {
        const runtime = runtimeByOrderId[String(item.id)] || {};
        const paidAt = normalizeString(runtime.paidAt || item.paidAt || '');
        const updatedAtRaw =
          (Number.isFinite(Number(runtime.updatedAt)) && Number(runtime.updatedAt) > 0
            ? Number(runtime.updatedAt)
            : Date.parse(normalizeString(item.updatedAt || item.createdAt || ''))) || 0;
        return {
          id: Number(item.id) || null,
          klant: truncateText(normalizeString(item.clientName || ''), 160),
          titel: truncateText(normalizeString(item.title || ''), 220),
          locatie: truncateText(normalizeString(item.location || ''), 160),
          status: truncateText(normalizeString(runtime.statusKey || item.status || ''), 80) || 'wacht',
          bedragEur: Math.max(0, Math.round(Number(item.amount) || 0)),
          betaaldOp: paidAt ? paidAt.slice(0, 10) : '',
          laatstBijgewerkt: normalizeString(item.updatedAt || item.createdAt || ''),
          updatedAtMs: Number(updatedAtRaw) || 0,
        };
      })
      .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

    const callUpdates = recentCallUpdates
      .map((item) => {
        const updatedAt =
          normalizeString(item?.updatedAt || item?.createdAt || '') || new Date().toISOString();
        const updatedAtMs =
          (Number.isFinite(Number(item?.updatedAtMs)) && Number(item.updatedAtMs) > 0
            ? Number(item.updatedAtMs)
            : Date.parse(updatedAt)) || 0;
        const recordingUrl = resolvePreferredRecordingUrl(item);
        const hasRecording =
          Boolean(recordingUrl) ||
          toBooleanSafe(item?.recorded, false) ||
          toBooleanSafe(item?.hasRecording, false);

        return {
          callId: truncateText(normalizeString(item?.callId || ''), 160),
          bedrijf: truncateText(normalizeString(item?.company || ''), 160) || 'Onbekend',
          contactpersoon: truncateText(normalizeString(item?.name || ''), 160),
          telefoon: truncateText(normalizeString(item?.phone || ''), 80),
          status: truncateText(normalizeString(item?.status || item?.messageType || ''), 80) || 'onbekend',
          duur: truncateText(normalizeString(item?.durationLabel || ''), 40),
          hasRecording,
          samenvatting: truncateText(normalizeString(item?.summary || ''), 220),
          transcriptSnippet: truncateText(normalizeString(item?.transcriptSnippet || ''), 220),
          updatedAt,
          updatedAtMs,
        };
      })
      .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

    const agenda = generatedAgendaAppointments
      .map((item) => {
        const createdAt = normalizeString(item?.createdAt || '');
        const updatedAt = normalizeString(item?.updatedAt || createdAt);
        const updatedAtMs = Date.parse(updatedAt || createdAt || '') || 0;
        return {
          id: Number(item?.id) || null,
          bedrijf:
            truncateText(normalizeString(item?.company || item?.leadCompany || ''), 160) ||
            'Onbekend',
          contactpersoon: truncateText(
            normalizeString(item?.contactName || item?.leadName || item?.name || ''),
            160
          ),
          telefoon: truncateText(normalizeString(item?.phone || item?.leadPhone || ''), 80),
          datum: normalizeDateYyyyMmDd(item?.date || item?.appointmentDate || ''),
          tijd: normalizeTimeHhMm(item?.time || item?.appointmentTime || ''),
          status:
            truncateText(
              normalizeString(item?.status || item?.postCallStatus || item?.confirmationStatus || ''),
              80
            ) || 'onbekend',
          notitie: truncateText(normalizeString(item?.summary || item?.notes || ''), 500),
          updatedAt,
          updatedAtMs,
        };
      })
      .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

    const aiInsights = recentAiCallInsights
      .map((item) => ({
        callId: truncateText(normalizeString(item?.callId || ''), 160),
        bedrijf: truncateText(normalizeString(item?.company || ''), 160) || 'Onbekend',
        contactpersoon: truncateText(normalizeString(item?.contactName || ''), 160),
        telefoon: truncateText(normalizeString(item?.phone || ''), 80),
        branche: truncateText(normalizeString(item?.branche || ''), 120),
        afspraakIngepland: toBooleanSafe(item?.appointmentBooked, false),
        afspraakDatum: normalizeDateYyyyMmDd(item?.appointmentDate || ''),
        afspraakTijd: normalizeTimeHhMm(item?.appointmentTime || ''),
        followUpNodig: toBooleanSafe(item?.followUpRequired, false),
        followUpReden: truncateText(normalizeString(item?.followUpReason || ''), 120),
        samenvatting: truncateText(normalizeString(item?.summary || ''), 220),
        analyzedAt: normalizeString(item?.analyzedAt || ''),
      }))
      .sort((a, b) => {
        const aTs = Date.parse(a.analyzedAt || '') || 0;
        const bTs = Date.parse(b.analyzedAt || '') || 0;
        return bTs - aTs;
      });

    const activities = recentDashboardActivities
      .map((item) => ({
        tijd: normalizeString(item?.createdAt || ''),
        titel: truncateText(normalizeString(item?.title || ''), 200),
        detail: truncateText(normalizeString(item?.detail || ''), 180),
        bedrijf: truncateText(normalizeString(item?.company || ''), 160),
        bron: truncateText(normalizeString(item?.source || ''), 80),
        actor: truncateText(normalizeString(item?.actor || ''), 120),
      }))
      .sort((a, b) => {
        const aTs = Date.parse(a.tijd || '') || 0;
        const bTs = Date.parse(b.tijd || '') || 0;
        return bTs - aTs;
      });

    const orderTotalValueEur = orders.reduce((sum, item) => sum + (Number(item?.bedragEur) || 0), 0);
    const orderPaidCount = orders.reduce((sum, item) => sum + (item?.betaaldOp ? 1 : 0), 0);
    const customerPaidCount = customers.reduce(
      (sum, item) => sum + (normalizeString(item?.status) === 'Betaald' ? 1 : 0),
      0
    );
    const customerOpenCount = customers.length - customerPaidCount;
    const customerWebsiteRevenueEur = customers.reduce(
      (sum, item) =>
        sum + (Number.isFinite(Number(item?.websiteBedrag)) ? Number(item.websiteBedrag) : 0),
      0
    );
    const customerMaintenanceMonthlyEur = customers.reduce(
      (sum, item) =>
        sum +
        (Number.isFinite(Number(item?.onderhoudPerMaand)) ? Number(item.onderhoudPerMaand) : 0),
      0
    );

    return {
      generatedAt: new Date().toISOString(),
      workspace: 'softora-premium-personeel-dashboard',
      overview: {
        totaalOpdrachten: orders.length,
        totaalKlanten: customers.length,
        totaalCalls: callUpdates.length,
        totaalAgendaItems: agenda.length,
        totaalAiInsights: aiInsights.length,
        totaalActiviteiten: activities.length,
      },
      orders: {
        total: orders.length,
        paidCount: orderPaidCount,
        statusCounts: buildDashboardChatStatusCounts(orders, 'status'),
        totalValueEur: orderTotalValueEur,
        items: orders.slice(0, 60),
      },
      customers: {
        total: customers.length,
        paidCount: customerPaidCount,
        openCount: customerOpenCount,
        websiteRevenueEur: customerWebsiteRevenueEur,
        monthlyMaintenanceEur: customerMaintenanceMonthlyEur,
        statusCounts: buildDashboardChatStatusCounts(customers, 'status'),
        items: customers.slice(0, 80),
      },
      calls: {
        total: callUpdates.length,
        statusCounts: buildDashboardChatStatusCounts(callUpdates, 'status'),
        withRecordingCount: callUpdates.reduce((sum, item) => sum + (item?.hasRecording ? 1 : 0), 0),
        items: callUpdates.slice(0, 60),
      },
      agenda: {
        total: agenda.length,
        statusCounts: buildDashboardChatStatusCounts(agenda, 'status'),
        items: agenda.slice(0, 60),
      },
      aiCallInsights: {
        total: aiInsights.length,
        appointmentsBooked: aiInsights.reduce(
          (sum, item) => sum + (toBooleanSafe(item?.afspraakIngepland, false) ? 1 : 0),
          0
        ),
        followUpsRequired: aiInsights.reduce(
          (sum, item) => sum + (toBooleanSafe(item?.followUpNodig, false) ? 1 : 0),
          0
        ),
        items: aiInsights.slice(0, 60),
      },
      recentActivities: activities.slice(0, 60),
    };
  }

  async function generatePremiumDashboardChatReplyWithAi(options = {}) {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      const err = new Error('ANTHROPIC_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const question = truncateText(normalizeString(options.question || ''), 4000);
    if (!question) {
      const err = new Error('Vraag ontbreekt');
      err.status = 400;
      throw err;
    }

    const history = normalizeDashboardChatHistory(options.history);
    const context = options.context && typeof options.context === 'object' ? options.context : {};
    let assistantContext =
      options.assistantContext && typeof options.assistantContext === 'object'
        ? options.assistantContext
        : null;
    if (!assistantContext && rubenAssistant && typeof rubenAssistant.buildAssistantContext === 'function') {
      assistantContext = await rubenAssistant.buildAssistantContext({ dashboardContext: context });
    }
    const trimmedContext = trimDashboardChatContextForModel(context, 52000);
    const contextJson = JSON.stringify(trimmedContext);

    const systemPrompt =
      rubenAssistant && typeof rubenAssistant.buildAssistantSystemPrompt === 'function'
        ? rubenAssistant.buildAssistantSystemPrompt({ assistantContext })
        : [
            'Je bent de interne Softora AI-assistent voor het personeel-dashboard.',
            'Je antwoordt altijd in duidelijk Nederlands.',
            'Gebruik uitsluitend de aangeleverde dashboard-context.',
            'Als data ontbreekt of niet zeker is, zeg dat expliciet en verzin niets.',
            'Als de gebruiker vraagt om "alles", geef een compact overzicht per domein: omzet/opdrachten, klanten, calls, agenda en recente activiteiten.',
            'Geef concrete aantallen en namen als die in de context staan.',
            'Noem geen technische interne details (zoals API keys of serverconfiguratie).',
          ].join('\n');

    const system = [
      systemPrompt,
      assistantContext ? `RUBEN_ASSISTANT_CONTEXT_JSON:\n${JSON.stringify(assistantContext)}` : '',
      `DASHBOARD_CONTEXT_JSON:\n${contextJson}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const messages = [
      ...history,
      { role: 'user', content: question },
    ];
    const model = normalizeString(options.model || anthropicModel) || 'claude-sonnet-4-6';

    const { response, data } = await fetchJsonWithTimeout(
      `${anthropicApiBaseUrl}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system,
          messages,
        }),
      },
      65000
    );

    if (!response.ok) {
      const err = new Error(`Anthropic dashboard-chat mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.content;
    const answer = truncateText(normalizeString(extractAnthropicTextContent(content)), 12000);
    if (!answer) {
      const err = new Error('AI gaf geen antwoord terug.');
      err.status = 502;
      err.data = data;
      throw err;
    }

    return {
      answer,
      model: normalizeString(data?.model || model) || model,
      usage: data?.usage || null,
      provider: 'anthropic',
    };
  }

  async function sendPremiumDashboardChatResponse(req, res) {
    try {
      await ensureDashboardChatRuntimeReady();

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const question = normalizeString(body.question || body.message || body.prompt || '');
      if (!question) {
        return res.status(400).json({
          ok: false,
          error: 'Vraag ontbreekt',
          detail: 'Stuur JSON met { question: "..." }',
        });
      }
      if (question.length > 4000) {
        return res.status(400).json({
          ok: false,
          error: 'Vraag te lang',
          detail: 'Gebruik maximaal 4000 tekens.',
        });
      }

      const context = await buildPremiumDashboardChatContext();
      const assistantContext =
        rubenAssistant && typeof rubenAssistant.buildAssistantContext === 'function'
          ? await rubenAssistant.buildAssistantContext({ dashboardContext: context })
          : null;
      const result = await generatePremiumDashboardChatReplyWithAi({
        question,
        history: body.history,
        context,
        assistantContext,
      });

      return res.status(200).json({
        ok: true,
        answer: result.answer,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        contextMeta: {
          generatedAt: context.generatedAt || null,
          totals: context.overview || {},
        },
        assistant:
          rubenAssistant && typeof rubenAssistant.buildAssistantIdentity === 'function'
            ? rubenAssistant.buildAssistantIdentity()
            : null,
        anthropicEnabled: true,
        openAiEnabled: Boolean(getOpenAiApiKey()),
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const safeStatus = status >= 400 && status < 600 ? status : 500;
      return res.status(safeStatus).json({
        ok: false,
        error:
          safeStatus === 503
            ? 'AI dashboard assistent niet beschikbaar'
            : 'AI dashboard assistent mislukt',
        detail: String(error?.message || 'Onbekende fout'),
        anthropicEnabled: Boolean(getAnthropicApiKey()),
        openAiEnabled: Boolean(getOpenAiApiKey()),
      });
    }
  }

  async function sendAiSummarizeResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const text = normalizeString(body.text || '');
      const style = normalizeAiSummaryStyle(body.style);
      const language = normalizeString(body.language || 'nl') || 'nl';
      const extraInstructions = normalizeString(body.extraInstructions || '');
      const maxSentences = Math.max(1, Math.min(12, parseIntSafe(body.maxSentences, 4)));

      if (!text) {
        return res.status(400).json({
          ok: false,
          error: 'Tekst ontbreekt',
          detail: 'Stuur een JSON body met { text: "..." }',
        });
      }

      if (text.length > 50000) {
        return res.status(400).json({
          ok: false,
          error: 'Tekst te lang',
          detail: 'Maximaal 50.000 tekens per request.',
        });
      }

      if (body.style !== undefined && !style) {
        return res.status(400).json({
          ok: false,
          error: 'Ongeldige stijl',
          detail: 'Gebruik: short, medium, long of bullets',
        });
      }

      const result = await generateTextSummaryWithAi({
        text,
        style: style || 'medium',
        language,
        maxSentences,
        extraInstructions,
      });

      return res.status(200).json({
        ok: true,
        summary: result.summary,
        style: result.style,
        language: result.language,
        maxSentences: result.maxSentences,
        source: result.source,
        model: result.model,
        usage: result.usage,
        openAiEnabled: true,
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const safeStatus = status >= 400 && status < 600 ? status : 500;
      return res.status(safeStatus).json({
        ok: false,
        error:
          safeStatus === 503
            ? 'AI samenvatting niet beschikbaar'
            : 'AI samenvatting mislukt',
        detail: String(error?.message || 'Onbekende fout'),
        openAiEnabled: Boolean(getOpenAiApiKey()),
      });
    }
  }

  return {
    buildDashboardChatStatusCounts,
    buildPremiumDashboardChatContext,
    generatePremiumDashboardChatReplyWithAi,
    normalizeDashboardChatHistory,
    parseDashboardChatCustomers,
    parseDashboardChatRuntimeByOrderId,
    sendAiSummarizeResponse,
    sendPremiumDashboardChatResponse,
    trimDashboardChatContextForModel,
  };
}

module.exports = {
  createAiDashboardCoordinator,
};

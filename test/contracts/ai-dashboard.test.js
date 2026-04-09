const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiDashboardCoordinator } = require('../../server/services/ai-dashboard');
const { createRubenAssistant } = require('../../server/services/ruben-assistant');

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
  const fetchCalls = [];
  const summaryCalls = [];
  const runtimeReadyCalls = [];

  const customOrders =
    overrides.customOrders ||
    [
      {
        id: 1,
        clientName: 'Alpha BV',
        title: 'Nieuwe Alpha site',
        location: 'Amsterdam',
        status: 'wacht',
        amount: 1200,
        paidAt: '2026-04-06T10:00:00.000Z',
        updatedAt: '2026-04-06T11:00:00.000Z',
        createdAt: '2026-04-05T09:00:00.000Z',
      },
      {
        id: 2,
        clientName: 'Beta BV',
        title: 'Nieuwe Beta site',
        location: 'Rotterdam',
        status: 'concept',
        amount: 650,
        createdAt: '2026-04-04T09:00:00.000Z',
      },
    ];

  const stateByScope = {
    active_orders: {
      values: {
        custom_orders: overrides.customOrdersRaw || customOrders,
        runtime_by_order_id:
          overrides.runtimeByOrderIdRaw ||
          JSON.stringify({
            2: {
              statusKey: 'in_uitwerking',
              progressPct: 70,
              paidAt: '2026-04-07T09:00:00.000Z',
              updatedAt: 1712476800000,
            },
          }),
      },
    },
    customers: {
      values: {
        customers:
          overrides.customersRaw ||
          JSON.stringify([
            {
              id: 'customer-1',
              naam: 'Alpha',
              bedrijf: 'Alpha BV',
              telefoon: '0612345678',
              website: 'https://alpha.example',
              type: 'Website',
              status: 'betaald',
              datum: '2026-04-01',
              websiteBedrag: 1500,
              onderhoudPerMaand: 50,
            },
            {
              id: 'customer-2',
              naam: 'Beta',
              bedrijf: 'Beta BV',
              telefoon: '0687654321',
              website: 'https://beta.example',
              type: 'Onderhoud',
              status: 'open',
              datum: '2026-04-02',
              bedrag: 99,
            },
          ]),
      },
    },
    ruben_nijhuis_memory: {
      source: 'supabase',
      updatedAt: '2026-04-07T13:00:00.000Z',
      values: {
        mission: 'Ruben bewaakt de samenhang tussen leads, agenda, opdrachten en klanten.',
        notes: JSON.stringify([
          {
            id: 'rule-1',
            category: 'workflow',
            title: 'Niet geïnteresseerde lead niet opnieuw bellen',
            detail: 'Als een lead dismissed of niet geïnteresseerd is, mag die niet opnieuw terug de bellijst in.',
            why: 'Dat voorkomt onnodige irritatie en houdt het systeem schoon.',
            createdAt: '2026-04-07T12:00:00.000Z',
          },
        ]),
      },
    },
  };

  const rubenAssistant = createRubenAssistant({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    parseJsonLoose: (value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value ?? null;
    },
    getUiStateValues: async (scope) => stateByScope[scope] || null,
  });

  const coordinator = createAiDashboardCoordinator({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    parseJsonLoose: (value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value ?? null;
    },
    parseNumberSafe: (value, fallback = null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    normalizeDateYyyyMmDd: (value) => String(value || '').trim().slice(0, 10),
    normalizeTimeHhMm: (value) => String(value || '').trim().slice(0, 5),
    toBooleanSafe: (value, fallback = false) => {
      if (value === true || value === false) return value;
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return fallback;
      return /^(1|true|yes|ja|on)$/.test(raw);
    },
    resolvePreferredRecordingUrl: (item) => String(item?.recordingUrl || ''),
    getUiStateValues: overrides.getUiStateValues || (async (scope) => stateByScope[scope] || null),
    premiumActiveOrdersScope: 'active_orders',
    premiumCustomersScope: 'customers',
    premiumActiveCustomOrdersKey: 'custom_orders',
    premiumActiveRuntimeKey: 'runtime_by_order_id',
    premiumCustomersKey: 'customers',
    parseCustomOrdersFromUiState: overrides.parseCustomOrdersFromUiState || ((value) => {
      if (Array.isArray(value)) return value;
      return [];
    }),
    recentCallUpdates:
      overrides.recentCallUpdates ||
      [
        {
          callId: 'call-1',
          company: 'Alpha BV',
          name: 'Anne',
          phone: '0612345678',
          status: 'completed',
          durationLabel: '03:15',
          summary: 'Klant wil offerte zien',
          transcriptSnippet: 'Bel me morgen terug',
          updatedAt: '2026-04-07T12:00:00.000Z',
          recordingUrl: 'https://cdn.example/audio.mp3',
        },
        {
          callId: 'call-2',
          company: 'Beta BV',
          name: 'Bert',
          phone: '0687654321',
          messageType: 'busy',
          updatedAt: '2026-04-07T11:00:00.000Z',
        },
      ],
    generatedAgendaAppointments:
      overrides.generatedAgendaAppointments ||
      [
        {
          id: 44,
          company: 'Alpha BV',
          contactName: 'Anne',
          phone: '0612345678',
          date: '2026-04-08',
          time: '13:30',
          status: 'bevestigd',
          summary: 'Demo op kantoor',
          updatedAt: '2026-04-07T12:30:00.000Z',
        },
      ],
    recentAiCallInsights:
      overrides.recentAiCallInsights ||
      [
        {
          callId: 'call-1',
          company: 'Alpha BV',
          contactName: 'Anne',
          phone: '0612345678',
          branche: 'Bouw',
          appointmentBooked: true,
          appointmentDate: '2026-04-08',
          appointmentTime: '13:30',
          followUpRequired: true,
          followUpReason: 'Offerte voorbereiden',
          summary: 'Veel interesse',
          analyzedAt: '2026-04-07T12:45:00.000Z',
        },
      ],
    recentDashboardActivities:
      overrides.recentDashboardActivities ||
      [
        {
          createdAt: '2026-04-07T12:50:00.000Z',
          title: 'Nieuwe call update',
          detail: 'Anne wil een voorstel',
          company: 'Alpha BV',
          source: 'coldcalling',
          actor: 'system',
        },
      ],
    getOpenAiApiKey: () =>
      overrides.openAiApiKey === undefined ? 'openai-key' : overrides.openAiApiKey,
    fetchJsonWithTimeout: overrides.fetchJsonWithTimeout || (async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        response: { ok: true, status: 200 },
        data: {
          choices: [
            {
              message: {
                content: 'Er zijn nu 2 klanten en 2 opdrachten actief.',
              },
            },
          ],
          usage: { total_tokens: 111 },
        },
      };
    }),
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-5.1-mini',
    extractOpenAiTextContent: (content) => String(content || ''),
    ensureDashboardChatRuntimeReady: overrides.ensureDashboardChatRuntimeReady || (async () => {
      runtimeReadyCalls.push(true);
    }),
    normalizeAiSummaryStyle: overrides.normalizeAiSummaryStyle || ((value) => {
      const raw = String(value || '').trim().toLowerCase();
      return ['short', 'medium', 'long', 'bullets'].includes(raw) ? raw : '';
    }),
    generateTextSummaryWithAi: overrides.generateTextSummaryWithAi || (async (payload) => {
      summaryCalls.push(payload);
      return {
        summary: 'Korte samenvatting',
        style: payload.style,
        language: payload.language,
        maxSentences: payload.maxSentences,
        source: 'openai',
        model: 'gpt-5.1-mini',
        usage: { total_tokens: 55 },
      };
    }),
    parseIntSafe: (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    rubenAssistant,
  });

  return {
    coordinator,
    fetchCalls,
    runtimeReadyCalls,
    summaryCalls,
  };
}

test('ai dashboard coordinator normalizes dashboard chat history safely', () => {
  const { coordinator } = createFixture();
  const history = coordinator.normalizeDashboardChatHistory([
    { role: 'assistant', content: '  Antwoord  ' },
    { role: 'developer', content: 'Vraag' },
    { role: 'user', content: '' },
    null,
    ...Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: `bericht-${index + 1}`.repeat(400),
    })),
  ]);

  assert.equal(history.length, 12);
  assert.equal(history[0].role, 'assistant');
  assert.equal(history[1].role, 'user');
  assert.equal(history[0].content.length, 3000);
  assert.ok(history.every((item) => item.content.length > 0));
});

test('ai dashboard coordinator trims oversized model context without changing the shape', () => {
  const { coordinator } = createFixture();
  const rawContext = {
    orders: {
      items: Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        note: `order-${index + 1}-${'x'.repeat(500)}`,
      })),
    },
    customers: {
      items: Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        note: `customer-${index + 1}-${'y'.repeat(500)}`,
      })),
    },
    calls: {
      items: Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        note: `call-${index + 1}-${'z'.repeat(500)}`,
      })),
    },
    recentActivities: Array.from({ length: 80 }, (_, index) => ({
      id: index + 1,
      detail: `activity-${index + 1}-${'a'.repeat(500)}`,
    })),
  };

  const trimmed = coordinator.trimDashboardChatContextForModel(rawContext, 6000);

  assert.ok(Array.isArray(trimmed.orders.items));
  assert.ok(trimmed.orders.items.length < rawContext.orders.items.length);
  assert.ok(trimmed.customers.items.length < rawContext.customers.items.length);
  assert.ok(trimmed.calls.items.length < rawContext.calls.items.length);
  assert.ok(trimmed.recentActivities.length < rawContext.recentActivities.length);
});

test('ai dashboard coordinator builds dashboard context totals from runtime state', async () => {
  const { coordinator } = createFixture();

  const context = await coordinator.buildPremiumDashboardChatContext();

  assert.equal(context.overview.totaalOpdrachten, 2);
  assert.equal(context.overview.totaalKlanten, 2);
  assert.equal(context.overview.totaalCalls, 2);
  assert.equal(context.orders.paidCount, 2);
  assert.equal(context.orders.statusCounts.wacht, 1);
  assert.equal(context.orders.statusCounts.in_uitwerking, 1);
  assert.equal(context.customers.paidCount, 1);
  assert.equal(context.customers.openCount, 1);
  assert.equal(context.customers.websiteRevenueEur, 1500);
  assert.equal(context.customers.monthlyMaintenanceEur, 149);
  assert.equal(context.calls.withRecordingCount, 1);
  assert.equal(context.aiCallInsights.appointmentsBooked, 1);
  assert.equal(context.aiCallInsights.followUpsRequired, 1);
});

test('ai dashboard coordinator calls OpenAI with normalized question, history and context', async () => {
  const { coordinator, fetchCalls } = createFixture();

  const result = await coordinator.generatePremiumDashboardChatReplyWithAi({
    question: '  Hoeveel klanten hebben we?  ',
    history: [
      { role: 'assistant', content: 'Vorige antwoord' },
      { role: 'system', content: 'Dit moet user worden' },
    ],
    context: {
      overview: {
        totaalKlanten: 2,
      },
    },
  });

  assert.equal(result.answer, 'Er zijn nu 2 klanten en 2 opdrachten actief.');
  assert.equal(fetchCalls.length, 1);

  const requestBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(fetchCalls[0].url, 'https://api.openai.test/v1/chat/completions');
  assert.equal(requestBody.model, 'gpt-5.1-mini');
  assert.equal(requestBody.messages.at(-1).content, 'Hoeveel klanten hebben we?');
  assert.match(requestBody.messages[0].content, /Ruben Nijhuis/);
  assert.match(requestBody.messages[1].content, /RUBEN_ASSISTANT_CONTEXT_JSON/);
  assert.match(requestBody.messages[2].content, /DASHBOARD_CONTEXT_JSON/);
});

test('ai dashboard coordinator reports missing OpenAI config and empty upstream replies safely', async () => {
  const missingKeyFixture = createFixture({
    openAiApiKey: '',
  });

  await assert.rejects(
    () =>
      missingKeyFixture.coordinator.generatePremiumDashboardChatReplyWithAi({
        question: 'Hoeveel klanten?',
        context: {},
      }),
    (error) => error?.status === 503 && /OPENAI_API_KEY/.test(error.message)
  );

  const emptyAnswerFixture = createFixture({
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: {
        choices: [{ message: { content: '' } }],
      },
    }),
  });

  await assert.rejects(
    () =>
      emptyAnswerFixture.coordinator.generatePremiumDashboardChatReplyWithAi({
        question: 'Hoeveel klanten?',
        context: {},
      }),
    (error) => error?.status === 502 && /geen antwoord/i.test(error.message)
  );
});

test('ai dashboard coordinator validates dashboard chat input and returns stable payloads', async () => {
  const { coordinator, runtimeReadyCalls } = createFixture();
  const missingRes = createResponseRecorder();

  await coordinator.sendPremiumDashboardChatResponse({ body: {} }, missingRes);

  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'Vraag ontbreekt');

  const longRes = createResponseRecorder();
  await coordinator.sendPremiumDashboardChatResponse(
    {
      body: { question: 'x'.repeat(4001) },
    },
    longRes
  );

  assert.equal(longRes.statusCode, 400);
  assert.equal(longRes.body.error, 'Vraag te lang');

  const successRes = createResponseRecorder();
  await coordinator.sendPremiumDashboardChatResponse(
    {
      body: {
        question: 'Geef mij een overzicht',
        history: [{ role: 'user', content: 'Vorige vraag' }],
      },
    },
    successRes
  );

  assert.equal(successRes.statusCode, 200);
  assert.equal(successRes.body.ok, true);
  assert.equal(typeof successRes.body.answer, 'string');
  assert.equal(successRes.body.contextMeta.totals.totaalKlanten, 2);
  assert.equal(successRes.body.assistant.name, 'Ruben Nijhuis');
  assert.equal(successRes.body.openAiEnabled, true);
  assert.equal(runtimeReadyCalls.length, 3);
});

test('ai dashboard coordinator validates summarize input and returns AI summary payload', async () => {
  const { coordinator, summaryCalls } = createFixture();
  const missingRes = createResponseRecorder();

  await coordinator.sendAiSummarizeResponse({ body: {} }, missingRes);

  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'Tekst ontbreekt');

  const invalidStyleRes = createResponseRecorder();
  await coordinator.sendAiSummarizeResponse(
    {
      body: {
        text: 'Dit is geldige tekst.',
        style: 'roman',
      },
    },
    invalidStyleRes
  );

  assert.equal(invalidStyleRes.statusCode, 400);
  assert.equal(invalidStyleRes.body.error, 'Ongeldige stijl');

  const tooLongRes = createResponseRecorder();
  await coordinator.sendAiSummarizeResponse(
    {
      body: {
        text: 'x'.repeat(50001),
      },
    },
    tooLongRes
  );

  assert.equal(tooLongRes.statusCode, 400);
  assert.equal(tooLongRes.body.error, 'Tekst te lang');

  const successRes = createResponseRecorder();
  await coordinator.sendAiSummarizeResponse(
    {
      body: {
        text: 'Maak hier een korte samenvatting van.',
        style: 'bullets',
        language: 'en',
        maxSentences: '9',
        extraInstructions: 'Gebruik alleen de kern.',
      },
    },
    successRes
  );

  assert.equal(successRes.statusCode, 200);
  assert.equal(successRes.body.ok, true);
  assert.equal(successRes.body.summary, 'Korte samenvatting');
  assert.equal(successRes.body.style, 'bullets');
  assert.equal(successRes.body.language, 'en');
  assert.equal(successRes.body.maxSentences, 9);
  assert.equal(successRes.body.openAiEnabled, true);
  assert.equal(summaryCalls.length, 1);
  assert.equal(summaryCalls[0].style, 'bullets');
  assert.equal(summaryCalls[0].maxSentences, 9);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiToolsCoordinator } = require('../../server/services/ai-tools');

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
  const activities = [];
  const loggerCalls = [];

  const coordinator = createAiToolsCoordinator({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    fetchWebsitePreviewScanFromUrl: overrides.fetchWebsitePreviewScanFromUrl || (async (url) => ({
      normalizedUrl: 'https://softora.nl',
      finalUrl: 'https://softora.nl',
      scan: {
        host: 'softora.nl',
        title: 'Softora',
        metaDescription: 'Digitale partner',
        h1: 'Welkom',
        headings: ['Welkom'],
        paragraphs: ['Paragraaf'],
        visualCues: ['Blauw'],
        imageCount: 2,
      },
      requestedUrl: url,
    })),
    generateWebsitePreviewImageWithAi: overrides.generateWebsitePreviewImageWithAi || (async () => ({
      brief: 'Korte briefing',
      prompt: 'Maak een moderne hero',
      dataUrl: 'data:image/png;base64,abcd',
      mimeType: 'image/png',
      fileName: 'preview.png',
      model: 'gpt-image-2',
      revisedPrompt: 'Verbeterde prompt',
      usage: { totalTokens: 50 },
    })),
    appendDashboardActivity: (payload, reason) => activities.push({ payload, reason }),
    getOpenAiApiKey: () => overrides.openAiApiKey || 'openai-key',
    openAiImageModel: overrides.openAiImageModel || 'gpt-image-2',
    buildOrderDossierInput: overrides.buildOrderDossierInput || ((value) => ({ ...value })),
    generateDynamicOrderDossierWithAnthropic:
      overrides.generateDynamicOrderDossierWithAnthropic ||
      (async (input) => ({
        layout: { blocks: [{ type: 'hero', title: input.title || 'Dossier' }] },
        source: 'anthropic',
        model: 'claude-opus-4-6',
        usage: { inputTokens: 100 },
      })),
    buildOrderDossierFallbackLayout: overrides.buildOrderDossierFallbackLayout || ((input) => ({
      blocks: [{ type: 'fallback', title: input.title || 'Fallback dossier' }],
    })),
    getAnthropicApiKey: () => overrides.anthropicApiKey || 'anthropic-key',
    getDossierAnthropicModel: () => overrides.getDossierAnthropicModel || 'claude-opus-4-6',
    generateWebsitePromptFromTranscriptWithAi:
      overrides.generateWebsitePromptFromTranscriptWithAi ||
      (async ({ transcript, language }) => ({
        prompt: `Prompt voor ${transcript}`,
        source: 'openai',
        model: 'gpt-4o-mini',
        usage: { totalTokens: 75 },
        language,
      })),
    buildWebsitePromptFallback: overrides.buildWebsitePromptFallback || ((input) => `Fallback: ${input.transcript}`),
    extractMeetingNotesFromImageWithAi:
      overrides.extractMeetingNotesFromImageWithAi ||
      (async () => ({
        transcript: 'Klant wil een nieuwe website',
        source: 'vision',
        model: 'gpt-4o-mini',
        usage: { totalTokens: 40 },
      })),
    logger: {
      error: (...args) => loggerCalls.push(args),
    },
  });

  return {
    activities,
    coordinator,
    loggerCalls,
  };
}

test('ai tools coordinator validates website preview input and returns generated preview payload', async () => {
  const { activities, coordinator } = createFixture();
  const missingRes = createResponseRecorder();

  await coordinator.sendWebsitePreviewGenerateResponse({ body: {} }, missingRes);

  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'Website-URL ontbreekt');

  const successRes = createResponseRecorder();
  await coordinator.sendWebsitePreviewGenerateResponse(
    {
      body: { url: 'https://softora.nl' },
    },
    successRes
  );

  assert.equal(successRes.statusCode, 200);
  assert.equal(successRes.body.ok, true);
  assert.equal(successRes.body.site.host, 'softora.nl');
  assert.equal(successRes.body.image.mimeType, 'image/png');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].reason, 'dashboard_activity_website_preview_generated');
});

test('ai tools coordinator wraps website preview failures in a stable error payload', async () => {
  const { coordinator } = createFixture({
    fetchWebsitePreviewScanFromUrl: async () => {
      const error = new Error('OpenAI image provider offline');
      error.status = 503;
      error.data = { error: { detail: 'Image quota bereikt' } };
      throw error;
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendWebsitePreviewGenerateResponse(
    {
      body: { url: 'https://softora.nl' },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Websitegenerator AI niet beschikbaar');
  assert.equal(
    res.body.detail,
    'OpenAI image provider offline: Image quota bereikt'
  );
  assert.equal(res.body.imageModel, 'gpt-image-2');
  assert.equal(res.body.upstreamDetail, null);
});

test('ai tools coordinator validates dossier input and falls back safely on anthropic errors', async () => {
  const invalidRes = createResponseRecorder();
  const invalidFixture = createFixture();

  await invalidFixture.coordinator.sendOrderDossierResponse({ body: {} }, invalidRes);

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'Onvoldoende dossierinformatie');

  const fallbackFixture = createFixture({
    generateDynamicOrderDossierWithAnthropic: async () => {
      const error = new Error('Claude tijdelijk offline');
      error.status = 503;
      throw error;
    },
  });
  const fallbackRes = createResponseRecorder();

  await fallbackFixture.coordinator.sendOrderDossierResponse(
    {
      body: {
        orderId: 12,
        title: 'Nieuwe site',
      },
    },
    fallbackRes
  );

  assert.equal(fallbackRes.statusCode, 200);
  assert.equal(fallbackRes.body.ok, true);
  assert.equal(fallbackRes.body.source, 'template-fallback');
  assert.match(fallbackRes.body.warning, /template-fallback/i);
  assert.equal(fallbackFixture.loggerCalls.length, 1);
});

test('ai tools coordinator validates transcript input and falls back to template prompt', async () => {
  const { coordinator, loggerCalls } = createFixture({
    generateWebsitePromptFromTranscriptWithAi: async () => {
      throw new Error('Prompt provider offline');
    },
  });
  const invalidRes = createResponseRecorder();

  await coordinator.sendTranscriptToPromptResponse({ body: {} }, invalidRes);

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'Transcript ontbreekt');

  const longRes = createResponseRecorder();
  await coordinator.sendTranscriptToPromptResponse(
    {
      body: { transcript: 'x'.repeat(50001) },
    },
    longRes
  );

  assert.equal(longRes.statusCode, 400);
  assert.equal(longRes.body.error, 'Transcript te lang');

  const fallbackRes = createResponseRecorder();
  await coordinator.sendTranscriptToPromptResponse(
    {
      body: { transcript: 'Nieuwe website voor softora' },
    },
    fallbackRes
  );

  assert.equal(fallbackRes.statusCode, 200);
  assert.equal(fallbackRes.body.ok, true);
  assert.equal(fallbackRes.body.source, 'template-fallback');
  assert.match(fallbackRes.body.warning, /template fallback/i);
  assert.equal(loggerCalls.length, 1);
});

test('ai tools coordinator validates notes image input and keeps prompt fallback local to prompt generation', async () => {
  const invalidFixture = createFixture();
  const missingRes = createResponseRecorder();

  await invalidFixture.coordinator.sendNotesImageToTextResponse({ body: {} }, missingRes);

  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'Afbeelding ontbreekt');

  const tooLargeRes = createResponseRecorder();
  await invalidFixture.coordinator.sendNotesImageToTextResponse(
    {
      body: { imageDataUrl: `data:image/png;base64,${'a'.repeat(900001)}` },
    },
    tooLargeRes
  );

  assert.equal(tooLargeRes.statusCode, 413);
  assert.equal(tooLargeRes.body.error, 'Afbeelding te groot');

  const fallbackFixture = createFixture({
    generateWebsitePromptFromTranscriptWithAi: async () => {
      throw new Error('Prompt provider offline');
    },
  });
  const fallbackRes = createResponseRecorder();

  await fallbackFixture.coordinator.sendNotesImageToTextResponse(
    {
      body: { imageDataUrl: 'data:image/png;base64,abcd' },
    },
    fallbackRes
  );

  assert.equal(fallbackRes.statusCode, 200);
  assert.equal(fallbackRes.body.ok, true);
  assert.equal(fallbackRes.body.promptSource, 'template-fallback');
  assert.equal(typeof fallbackRes.body.transcript, 'string');
});

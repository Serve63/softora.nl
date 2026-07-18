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
        source: 'openai',
        model: 'gpt-5.5-pro',
        usage: { inputTokens: 100 },
      })),
    buildOrderDossierFallbackLayout: overrides.buildOrderDossierFallbackLayout || ((input) => ({
      blocks: [{ type: 'fallback', title: input.title || 'Fallback dossier' }],
    })),
    getAnthropicApiKey: () => '',
    getDossierAnthropicModel: () => '',
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
    summarizeMeetingTranscriptWithAi:
      overrides.summarizeMeetingTranscriptWithAi ||
      (async ({ transcript, language }) => ({
        notes: `Samenvatting audiomeeting\n\nWat de klant wil:\n- ${transcript}`,
        source: 'openai',
        model: 'gpt-4o-mini',
        usage: { totalTokens: 45 },
        language,
      })),
    transcribeMeetingAudioWithAi:
      overrides.transcribeMeetingAudioWithAi ||
      (async () => ({
        transcript: 'Klant wil een website op basis van audiomeeting',
        source: 'audio',
        model: 'gpt-4o-transcribe',
        usage: null,
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

test('ai tools coordinator forwards database preview generation controls to the image generator', async () => {
  let capturedScan = null;
  const { coordinator } = createFixture({
    generateWebsitePreviewImageWithAi: async (scan) => {
      capturedScan = scan;
      return {
        brief: 'Korte briefing',
        prompt: 'Maak een moderne hero',
        dataUrl: 'data:image/png;base64,abcd',
        mimeType: 'image/png',
        fileName: 'preview.png',
        model: 'gpt-image-2',
        revisedPrompt: '',
        usage: null,
      };
    },
  });

  const payload = await coordinator.runWebsitePreviewGeneratePipeline('https://softora.nl', {
    imageSize: '2160x3840',
    disableReferenceImages: true,
    referenceImageMode: 'prompt-only',
    body: {
      source: 'premium-database',
      action: 'webdesign',
      softoraOutreachProfile: {
        name: 'Servé Creusen',
        roleLabel: 'WEBDESIGN & SOFTWARE ONTWIKKELING',
      },
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(capturedScan.imageSize, '2160x3840');
  assert.equal(capturedScan.disableReferenceImages, true);
  assert.equal(capturedScan.referenceImageMode, 'prompt-only');
  assert.deepEqual(capturedScan.softoraOutreachProfile, {
    name: 'Servé Creusen',
    roleLabel: 'WEBDESIGN & SOFTWARE ONTWIKKELING',
    source: '',
  });
});

test('ai tools coordinator gives V2 exactly one homepage screenshot reference', async () => {
  let capturedScan = null;
  const { coordinator } = createFixture({
    fetchWebsitePreviewScanFromUrl: async () => ({
      normalizedUrl: 'https://www.bliv.nl/',
      finalUrl: 'https://www.bliv.nl/',
      scan: {
        host: 'www.bliv.nl',
        referenceImageUrls: ['https://www.bliv.nl/og-image.jpg'],
      },
    }),
    generateWebsitePreviewImageWithAi: async (scan) => {
      capturedScan = scan;
      return {
        brief: 'V2 brief',
        prompt: 'V2 prompt',
        dataUrl: 'data:image/png;base64,abcd',
        mimeType: 'image/png',
        fileName: 'bliv-v2.png',
        model: 'gpt-image-2',
      };
    },
  });

  await coordinator.runWebsitePreviewGeneratePipeline('https://www.bliv.nl/', {
    referenceImageMode: 'homepage-screenshot',
    requireReferenceImages: true,
  });

  assert.equal(capturedScan.disableReferenceImages, false);
  assert.equal(capturedScan.referenceImageMode, 'homepage-screenshot');
  assert.equal(capturedScan.requireReferenceImages, true);
  assert.equal(capturedScan.referenceImageFidelity, 'high');
  assert.deepEqual(capturedScan.referenceImageUrls, [
    'https://s0.wordpress.com/mshots/v1/https%3A%2F%2Fwww.bliv.nl%2F?w=1280&h=1600',
  ]);
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

test('ai tools coordinator hides raw OpenAI safety rejection details', async () => {
  const rawSafetyMessage =
    'OpenAI websitegenerator mislukt (400): Your request was rejected by the safety system. Include request ID req_caef77d7f5d84889803634ba4e82ac8a. safety_violations=[sexual].';
  const { coordinator } = createFixture({
    generateWebsitePreviewImageWithAi: async () => {
      const error = new Error(rawSafetyMessage);
      error.status = 400;
      error.openAiSafetyBlocked = true;
      error.data = {
        error: {
          message: rawSafetyMessage,
        },
      };
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

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Websitegenerator overgeslagen');
  assert.equal(res.body.safetyBlocked, true);
  assert.match(res.body.detail, /AI-veiligheidscheck/);
  assert.equal(res.body.upstreamDetail, null);
  assert.doesNotMatch(JSON.stringify(res.body), /request ID|safety_violations|sexual|help\.openai\.com/i);
});

test('ai tools coordinator lets premium database previews generate with gpt-image-2 when scanning fails', async () => {
  const generatedScans = [];
  const { coordinator } = createFixture({
    fetchWebsitePreviewScanFromUrl: async () => {
      const error = new Error('Kon deze website niet ophalen (400).');
      error.status = 400;
      throw error;
    },
    generateWebsitePreviewImageWithAi: async (scan) => {
      generatedScans.push(scan);
      return {
        brief: 'Fallback briefing',
        prompt: 'Fallback prompt',
        dataUrl: 'data:image/png;base64,fallback',
        mimeType: 'image/png',
        fileName: 'fallback.png',
        model: 'gpt-image-2',
        revisedPrompt: '',
        usage: null,
      };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendWebsitePreviewGenerateResponse(
    {
      body: {
        url: 'https://growingbyknowing.nl',
        company: 'Growingbyknowing',
        domain: 'growingbyknowing.nl',
        source: 'premium-database',
        action: 'webdesign',
        senderProfile: {
          senderName: 'Servé Creusen',
          role: 'WEBDESIGN & SOFTWARE ONTWIKKELING',
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.model, 'gpt-image-2');
  assert.equal(res.body.scanFallback, true);
  assert.equal(generatedScans.length, 1);
  assert.equal(generatedScans[0].host, 'growingbyknowing.nl');
  assert.match(generatedScans[0].bodyTextSample, /Growingbyknowing/);
  assert.deepEqual(generatedScans[0].softoraOutreachProfile, {
    name: 'Servé Creusen',
    roleLabel: 'WEBDESIGN & SOFTWARE ONTWIKKELING',
    source: '',
  });
});

test('ai tools coordinator validates dossier input and falls back safely on OpenAI errors', async () => {
  const invalidRes = createResponseRecorder();
  const invalidFixture = createFixture();

  await invalidFixture.coordinator.sendOrderDossierResponse({ body: {} }, invalidRes);

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'Onvoldoende dossierinformatie');

  const fallbackFixture = createFixture({
    generateDynamicOrderDossierWithAnthropic: async () => {
      const error = new Error('OpenAI tijdelijk offline');
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

test('ai tools coordinator validates notes audio input and keeps prompt fallback local to prompt generation', async () => {
  const invalidFixture = createFixture();
  const missingRes = createResponseRecorder();

  await invalidFixture.coordinator.sendNotesAudioToTextResponse({ body: {} }, missingRes);

  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'Audiobestand ontbreekt');

  const tooLargeRes = createResponseRecorder();
  await invalidFixture.coordinator.sendNotesAudioToTextResponse(
    {
      body: { audioDataUrl: `data:audio/mpeg;base64,${'a'.repeat(34000001)}` },
    },
    tooLargeRes
  );

  assert.equal(tooLargeRes.statusCode, 413);
  assert.equal(tooLargeRes.body.error, 'Audiobestand te groot');

  const fallbackFixture = createFixture({
    generateWebsitePromptFromTranscriptWithAi: async () => {
      throw new Error('Prompt provider offline');
    },
  });
  const fallbackRes = createResponseRecorder();

  await fallbackFixture.coordinator.sendNotesAudioToTextResponse(
    {
      body: {
        audioDataUrl: 'data:audio/mpeg;base64,YXVkaW8=',
        fileName: 'meeting.mp3',
      },
    },
    fallbackRes
  );

  assert.equal(fallbackRes.statusCode, 200);
  assert.equal(fallbackRes.body.ok, true);
  assert.match(fallbackRes.body.notes, /Samenvatting audiomeeting/);
  assert.equal(fallbackRes.body.promptSource, 'template-fallback');
  assert.equal(typeof fallbackRes.body.transcript, 'string');
});

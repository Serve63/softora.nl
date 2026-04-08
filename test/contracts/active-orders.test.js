const test = require('node:test');
const assert = require('node:assert/strict');

const { createActiveOrdersCoordinator } = require('../../server/services/active-orders');

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
  const activityCalls = [];
  const generateCalls = [];
  const launchCalls = [];

  const coordinator = createActiveOrdersCoordinator({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    sanitizeReferenceImages: overrides.sanitizeReferenceImages || ((input) => {
      const items = Array.isArray(input) ? input : [];
      return items
        .filter((item) => item && item.allowed)
        .map((item, index) => ({
          id: item.id || `img-${index + 1}`,
          name: item.name || `bijlage-${index + 1}`,
          dataUrl: item.dataUrl || 'data:image/png;base64,abcd',
          sizeBytes: 128,
          mimeType: 'image/png',
        }));
    }),
    sanitizeLaunchDomainName: overrides.sanitizeLaunchDomainName || ((value) => String(value || '').trim().toLowerCase()),
    generateWebsiteHtmlWithAi: overrides.generateWebsiteHtmlWithAi || (async (payload) => {
      generateCalls.push(payload);
      return {
        html: '<html><body>Softora</body></html>',
        source: 'openai',
        model: 'gpt-4o-mini',
        usage: { totalTokens: 123 },
        apiCost: { totalUsd: 0.12 },
      };
    }),
    runActiveOrderLaunchPipeline: overrides.runActiveOrderLaunchPipeline || (async (payload) => {
      launchCalls.push(payload);
      return {
        ok: true,
        repo: 'softora-case-demo',
        previewUrl: 'https://demo.softora.nl',
      };
    }),
    appendDashboardActivity: (payload, reason) => activityCalls.push({ payload, reason }),
    getOpenAiApiKey: () => overrides.openAiApiKey || 'openai-key',
    getAnthropicApiKey: () => overrides.anthropicApiKey || 'anthropic-key',
    getWebsiteGenerationProvider: () => overrides.websiteGenerationProvider || 'openai',
    getWebsiteAnthropicModel: () => overrides.websiteAnthropicModel || 'claude-opus-4-6',
    openAiModel: overrides.openAiModel || 'gpt-4o-mini',
    websiteGenerationStrictAnthropic:
      overrides.websiteGenerationStrictAnthropic === undefined
        ? true
        : Boolean(overrides.websiteGenerationStrictAnthropic),
    websiteGenerationStrictHtml:
      overrides.websiteGenerationStrictHtml === undefined
        ? true
        : Boolean(overrides.websiteGenerationStrictHtml),
  });

  return {
    activityCalls,
    coordinator,
    generateCalls,
    launchCalls,
  };
}

test('active orders coordinator rejects generate requests without a prompt', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.sendGenerateSiteResponse({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Prompt ontbreekt');
});

test('active orders coordinator generates a site and emits dashboard activity', async () => {
  const { activityCalls, coordinator, generateCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.sendGenerateSiteResponse(
    {
      body: {
        prompt: 'Maak een case site',
        company: 'Softora',
        title: 'Nieuwe case',
        buildMode: 'fast',
        orderId: 42,
        referenceImages: [
          { allowed: true, id: 'img-1', name: 'voorbeeld-1' },
          { allowed: false, id: 'img-2' },
        ],
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.order.orderId, 42);
  assert.equal(res.body.order.referenceImageCount, 1);
  assert.equal(res.body.generator.strictAnthropic, true);
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].referenceImages.length, 1);
  assert.equal(activityCalls.length, 1);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_active_order_generated');
});

test('active orders coordinator wraps generation failures in a stable error payload', async () => {
  const { coordinator } = createFixture({
    websiteGenerationProvider: 'anthropic',
    generateWebsiteHtmlWithAi: async () => {
      const error = new Error('Provider tijdelijk offline');
      error.status = 503;
      error.data = {
        error: {
          detail: 'Anthropic quota bereikt',
        },
      };
      throw error;
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendGenerateSiteResponse(
    {
      body: {
        prompt: 'Maak een case site',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'AI website generatie niet beschikbaar');
  assert.equal(res.body.websiteGenerationProvider, 'anthropic');
  assert.equal(res.body.websiteGenerationModel, 'claude-opus-4-6');
  assert.equal(res.body.upstreamDetail, 'Anthropic quota bereikt');
});

test('active orders coordinator rejects launch requests without html', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.sendLaunchSiteResponse({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'HTML ontbreekt');
});

test('active orders coordinator launches a site and reports pipeline errors safely', async () => {
  const successFixture = createFixture();
  const successRes = createResponseRecorder();

  await successFixture.coordinator.sendLaunchSiteResponse(
    {
      body: {
        html: '<html><body>Softora</body></html>',
        orderId: 7,
        company: 'Softora',
        domainName: 'Softora.NL',
      },
    },
    successRes
  );

  assert.equal(successRes.statusCode, 200);
  assert.equal(successRes.body.ok, true);
  assert.equal(successFixture.launchCalls.length, 1);
  assert.equal(successFixture.launchCalls[0].domainName, 'softora.nl');
  assert.equal(successFixture.activityCalls.length, 1);
  assert.equal(successFixture.activityCalls[0].reason, 'dashboard_activity_active_order_launch');

  const failingFixture = createFixture({
    runActiveOrderLaunchPipeline: async () => {
      throw new Error('GitHub token ontbreekt');
    },
  });
  const failingRes = createResponseRecorder();

  await failingFixture.coordinator.sendLaunchSiteResponse(
    {
      body: {
        html: '<html><body>Softora</body></html>',
      },
    },
    failingRes
  );

  assert.equal(failingRes.statusCode, 400);
  assert.equal(failingRes.body.ok, false);
  assert.equal(failingRes.body.error, 'Launch pipeline mislukt');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiRemoteService } = require('../../server/services/ai-remote');

function createService(overrides = {}) {
  const state = {
    fetchJsonCalls: [],
    fetchTextCalls: [],
  };

  const service = createAiRemoteService({
    env: overrides.env || {},
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    getOpenAiApiKey: () => overrides.openAiApiKey || 'openai-key',
    getAnthropicApiKey: () => overrides.anthropicApiKey || 'anthropic-key',
    getWebsiteGenerationProvider: () => overrides.websiteGenerationProvider || 'openai',
    getWebsiteAnthropicModel: () => overrides.websiteAnthropicModel || 'claude-opus-4-6',
    getDossierAnthropicModel: () => overrides.dossierAnthropicModel || 'claude-opus-4-6',
    getAnthropicDossierMaxTokens: () => overrides.anthropicDossierMaxTokens || 9000,
    fetchJsonWithTimeout:
      overrides.fetchJsonWithTimeout ||
      (async (url, options, timeoutMs) => {
        state.fetchJsonCalls.push({ url, options, timeoutMs });
        return {
          response: { ok: true, status: 200 },
          data: {},
        };
      }),
    fetchTextWithTimeout:
      overrides.fetchTextWithTimeout ||
      (async (url, options, timeoutMs) => {
        state.fetchTextCalls.push({ url, options, timeoutMs });
        return {
          response: {
            ok: true,
            status: 200,
            url,
            headers: {
              get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/html' : ''),
            },
          },
          text: '<html><body><h1>Softora</h1></body></html>',
        };
      }),
    extractOpenAiTextContent:
      overrides.extractOpenAiTextContent ||
      ((content) => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || '').join('\n');
        return String(content?.text || content?.content || '');
      }),
    extractAnthropicTextContent:
      overrides.extractAnthropicTextContent ||
      ((content) => {
        if (Array.isArray(content)) return content.map((item) => item?.text || '').join('\n');
        return String(content?.text || '');
      }),
    parseJsonLoose:
      overrides.parseJsonLoose ||
      ((text) => {
        try {
          return JSON.parse(String(text || '').trim());
        } catch {
          return null;
        }
      }),
    assertWebsitePreviewUrlIsPublic:
      overrides.assertWebsitePreviewUrlIsPublic || (async (value) => String(value || '').trim()),
    normalizeWebsitePreviewTargetUrl:
      overrides.normalizeWebsitePreviewTargetUrl || ((value) => String(value || '').trim()),
    extractWebsitePreviewScanFromHtml:
      overrides.extractWebsitePreviewScanFromHtml ||
      ((html, pageUrl) => ({
        title: html.includes('Softora') ? 'Softora' : '',
        h1: 'Meer klanten',
        metaDescription: 'Premium websites',
        bodyTextSample: 'Sterke websites die converteren.',
        sourceUrl: pageUrl,
      })),
    buildWebsitePreviewPromptFromScan:
      overrides.buildWebsitePreviewPromptFromScan || ((scan) => `Preview ${scan.host || 'site'}`),
    buildWebsitePreviewBriefFromScan:
      overrides.buildWebsitePreviewBriefFromScan || ((scan) => `Brief ${scan.host || 'site'}`),
    buildWebsitePreviewDownloadFileName:
      overrides.buildWebsitePreviewDownloadFileName || ((scan) => `${scan.host || 'preview'}.png`),
    buildWebsiteGenerationPrompts:
      overrides.buildWebsiteGenerationPrompts ||
      (() => ({
        company: 'Softora',
        title: 'Nieuwe site',
        userPrompt: 'Bouw een premium site',
        systemPrompt: 'Je bent een topdesigner.',
        referenceImages: [],
      })),
    ensureHtmlDocument:
      overrides.ensureHtmlDocument ||
      ((html) => `<!doctype html><html lang="nl"><body>${String(html || '').trim()}</body></html>`),
    ensureStrictAnthropicHtml: overrides.ensureStrictAnthropicHtml || ((html) => String(html || '').trim()),
    isLikelyUsableWebsiteHtml: overrides.isLikelyUsableWebsiteHtml || (() => true),
    buildLocalWebsiteBlueprint:
      overrides.buildLocalWebsiteBlueprint || (() => '<website_blueprint>Blueprint</website_blueprint>'),
    buildAnthropicWebsiteHtmlPrompts:
      overrides.buildAnthropicWebsiteHtmlPrompts ||
      (() => ({
        systemPrompt: 'Systeemprompt',
        userPrompt: 'Gebruikersprompt',
        referenceImages: [],
        title: 'Nieuwe site',
        company: 'Softora',
      })),
    getAnthropicWebsiteStageEffort: overrides.getAnthropicWebsiteStageEffort || (() => 'high'),
    getAnthropicWebsiteStageMaxTokens:
      overrides.getAnthropicWebsiteStageMaxTokens || (() => 12000),
    supportsAnthropicAdaptiveThinking: overrides.supportsAnthropicAdaptiveThinking || (() => false),
    sanitizeReferenceImages: overrides.sanitizeReferenceImages || (() => []),
    parseImageDataUrl:
      overrides.parseImageDataUrl ||
      ((value) => {
        const raw = String(value || '');
        if (!raw.startsWith('data:image/png;base64,')) return null;
        return {
          mimeType: 'image/png',
          base64Payload: raw.slice('data:image/png;base64,'.length),
        };
      }),
    estimateOpenAiUsageCost:
      overrides.estimateOpenAiUsageCost || ((usage, model) => ({ usage, model, method: 'usage' })),
    estimateOpenAiTextCost:
      overrides.estimateOpenAiTextCost || ((prompt, html, model) => ({ prompt, html, model, method: 'text' })),
    estimateAnthropicUsageCost:
      overrides.estimateAnthropicUsageCost || ((usage, model) => ({ usage, model, method: 'usage' })),
    estimateAnthropicTextCost:
      overrides.estimateAnthropicTextCost ||
      ((prompt, html, model) => ({ prompt, html, model, method: 'text' })),
    buildAnthropicOrderDossierPrompts:
      overrides.buildAnthropicOrderDossierPrompts ||
      ((input) => ({
        systemPrompt: 'Dossier systeem',
        userPrompt: 'Dossier gebruiker',
        input,
      })),
    normalizeOrderDossierLayout:
      overrides.normalizeOrderDossierLayout ||
      ((value, input) => ({
        normalized: true,
        sections: value.sections || [],
        orderId: input.orderId || null,
      })),
    openAiApiBaseUrl: overrides.openAiApiBaseUrl || 'https://api.openai.test/v1',
    openAiModel: overrides.openAiModel || 'gpt-5-mini',
    openAiImageModel: overrides.openAiImageModel || 'gpt-image-2',
    anthropicApiBaseUrl: overrides.anthropicApiBaseUrl || 'https://api.anthropic.test/v1',
    anthropicModel: overrides.anthropicModel || 'claude-opus-4-6',
    websiteGenerationTimeoutMs: overrides.websiteGenerationTimeoutMs || 45000,
    websiteGenerationStrictAnthropic: Boolean(overrides.websiteGenerationStrictAnthropic),
    websiteGenerationStrictHtml: Boolean(overrides.websiteGenerationStrictHtml),
  });

  return {
    service,
    state,
  };
}

test('ai remote service generates website preview image payload from OpenAI image output', async () => {
  const calls = [];
  const { service, state } = createService({
    fetchJsonWithTimeout: async (url, options, timeoutMs) => {
      calls.push({ url, options, timeoutMs });
      return {
        response: { ok: true, status: 200 },
        data: {
          data: [{ b64_json: 'YWJjZA==', revised_prompt: 'Verbeterde prompt' }],
          usage: { total_tokens: 42 },
        },
      };
    },
  });

  const result = await service.generateWebsitePreviewImageWithAi({ host: 'softora.nl' });

  assert.equal(state.fetchJsonCalls.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.test/v1/images/generations');
  assert.match(String(calls[0].options.body || ''), /gpt-image-2/);
  assert.match(String(calls[0].options.body || ''), /"quality":"high"/);
  assert.doesNotMatch(String(calls[0].options.body || ''), /response_format/);
  assert.equal(result.model, 'gpt-image-2');
  assert.equal(result.brief, 'Brief softora.nl');
  assert.equal(result.fileName, 'softora.nl.png');
  assert.equal(result.dataUrl, 'data:image/png;base64,YWJjZA==');
  assert.equal(result.revisedPrompt, 'Verbeterde prompt');
});

test('ai remote service keeps b64_json response format for legacy dall-e image models', async () => {
  const calls = [];
  const { service } = createService({
    openAiImageModel: 'dall-e-3',
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({ url, options });
      return {
        response: { ok: true, status: 200 },
        data: {
          data: [{ b64_json: 'YWJjZA==' }],
        },
      };
    },
  });

  const result = await service.generateWebsitePreviewImageWithAi({ host: 'softora.nl' });

  assert.equal(calls.length, 1);
  assert.match(String(calls[0].options.body || ''), /"model":"dall-e-3"/);
  assert.match(String(calls[0].options.body || ''), /"response_format":"b64_json"/);
  assert.equal(result.model, 'dall-e-3');
});

test('ai remote service rejects non-image model configuration before calling OpenAI', async () => {
  const { service } = createService({
    openAiImageModel: 'gpt-4o-mini',
  });

  await assert.rejects(
    () => service.generateWebsitePreviewImageWithAi({ host: 'softora.nl' }),
    (error) => {
      assert.equal(error.status, 500);
      assert.match(String(error.message || ''), /image-model ongeldig geconfigureerd/i);
      assert.match(String(error?.data?.error?.detail || ''), /OPENAI_IMAGE_MODEL moet een ondersteund image-model/i);
      return true;
    }
  );
});

test('ai remote service fetches and normalizes website preview scan metadata including stylesheet colors', async () => {
  const calls = [];
  const { service, state } = createService({
    fetchTextWithTimeout: async (url, options, timeoutMs) => {
      calls.push({ url, options, timeoutMs });
      if (url === 'https://softora.nl/site.css') {
        return {
          response: {
            ok: true,
            status: 200,
            url,
            headers: {
              get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/css; charset=utf-8' : ''),
            },
          },
          text: `
            :root {
              --accent: #8B2252;
              --accent-light: #A62D65;
              --bg-primary: #F8F7F4;
              --text-primary: #1A1A2E;
            }
            .btn { background: #8B2252; color: #ffffff; }
          `,
        };
      }
      return {
        response: {
          ok: true,
          status: 200,
          url: 'https://softora.nl/landing',
          headers: {
            get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : ''),
          },
        },
        text: `
          <html>
            <head>
              <link rel="stylesheet" href="/site.css">
            </head>
            <body><h1>Softora</h1></body>
          </html>
        `,
      };
    },
  });

  const result = await service.fetchWebsitePreviewScanFromUrl('https://softora.nl');

  assert.equal(state.fetchTextCalls.length, 0);
  assert.equal(calls.length, 2);
  assert.equal(result.normalizedUrl, 'https://softora.nl');
  assert.equal(result.finalUrl, 'https://softora.nl/landing');
  assert.equal(result.scan.title, 'Softora');
  assert.equal(result.scan.sourceUrl, 'https://softora.nl/landing');
  assert.deepEqual(result.scan.brandColorHints, [
    'accent: #8b2252',
    'accent-light: #a62d65',
    'bg-primary: #f8f7f4',
    'text-primary: #1a1a2e',
  ]);
  assert.deepEqual(result.scan.brandPalette, ['#8b2252', '#a62d65', '#f8f7f4', '#1a1a2e', '#ffffff']);
});

test('ai remote service generates website html via OpenAI and preserves cost metadata', async () => {
  const { service } = createService({
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: {
        choices: [{ message: { content: '<main><h1>Nieuwe site</h1></main>' } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      },
    }),
  });

  const result = await service.generateWebsiteHtmlWithAi({ prompt: 'Maak een premium website' });

  assert.match(result.html, /<!doctype html>/i);
  assert.equal(result.source, 'openai');
  assert.equal(result.model, 'gpt-5-mini');
  assert.deepEqual(result.apiCost, {
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    model: 'gpt-5-mini',
    method: 'usage',
  });
});

test('ai remote service blocks non-anthropic providers when strict anthropic mode is enabled', async () => {
  const { service } = createService({
    websiteGenerationProvider: 'openai',
    websiteGenerationStrictAnthropic: true,
  });

  await assert.rejects(
    () => service.generateWebsiteHtmlWithAi({ prompt: 'Maak iets moois' }),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(String(error.message || ''), /strict op Anthropic/i);
      return true;
    }
  );
});

test('ai remote service normalizes anthropic dossier JSON into a stable layout payload', async () => {
  const { service } = createService({
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 50, output_tokens: 120 },
        content: [{ type: 'text', text: '{"sections":[{"type":"hero","title":"Welkom"}]}' }],
      },
    }),
  });

  const result = await service.generateDynamicOrderDossierWithAnthropic({ orderId: 12 });

  assert.equal(result.source, 'anthropic');
  assert.equal(result.model, 'claude-opus-4-6');
  assert.deepEqual(result.layout, {
    normalized: true,
    sections: [{ type: 'hero', title: 'Welkom' }],
    orderId: 12,
  });
  assert.deepEqual(result.usage, { input_tokens: 50, output_tokens: 120 });
});

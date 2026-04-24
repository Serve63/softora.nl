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
    fetchBinaryWithTimeout:
      overrides.fetchBinaryWithTimeout ||
      (async (url, options, timeoutMs) => {
        state.fetchBinaryCalls = state.fetchBinaryCalls || [];
        state.fetchBinaryCalls.push({ url, options, timeoutMs });
        return {
          response: {
            ok: true,
            status: 200,
            url,
            headers: {
              get: (name) =>
                String(name || '').toLowerCase() === 'content-type' ? 'image/png' : '',
            },
          },
          bytes: Buffer.from('png-image-bytes'),
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
  assert.match(String(calls[0].options.body || ''), /"size":"2160x3840"/);
  assert.match(String(calls[0].options.body || ''), /"quality":"high"/);
  assert.doesNotMatch(String(calls[0].options.body || ''), /response_format/);
  assert.equal(result.model, 'gpt-image-2');
  assert.equal(result.brief, 'Brief softora.nl');
  assert.equal(result.fileName, 'softora.nl.png');
  assert.equal(result.dataUrl, 'data:image/png;base64,YWJjZA==');
  assert.equal(result.revisedPrompt, 'Verbeterde prompt');
});

test('ai remote service uses OpenAI image edits with fetched website reference images when available', async () => {
  const calls = [];
  let capturedPromptScan = null;
  const { service } = createService({
    buildWebsitePreviewPromptFromScan: (scan) => {
      capturedPromptScan = scan;
      return `Preview met ${scan.referenceImageCount || 0} referentie`;
    },
    sanitizeReferenceImages: (images) => images,
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({ url, options });
      return {
        response: { ok: true, status: 200 },
        data: {
          data: [{ b64_json: 'YWJjZA==' }],
        },
      };
    },
    fetchBinaryWithTimeout: async (url, options) => ({
      response: {
        ok: true,
        status: 200,
        url,
        headers: {
          get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'image/png' : ''),
        },
      },
      bytes: Buffer.alloc(2048, 1),
    }),
  });

  const result = await service.generateWebsitePreviewImageWithAi({
    host: 'softora.nl',
    sourceUrl: 'https://softora.nl/',
    referenceImageUrls: ['https://softora.nl/og-softora.png'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.test/v1/images/edits');
  assert.equal(capturedPromptScan.referenceImageCount, 1);
  assert.equal(result.referenceImageCount, 1);
  assert.equal(calls[0].options.body.get('model'), 'gpt-image-2');
  assert.equal(calls[0].options.body.get('size'), '2160x3840');
  assert.equal(calls[0].options.body.get('quality'), 'high');
  assert.equal(calls[0].options.body.get('prompt'), 'Preview met 1 referentie');
  assert.equal(calls[0].options.body.getAll('image[]').length, 1);
});

test('ai remote service keeps gpt-image-2 and surfaces verification errors without fallback', async () => {
  const calls = [];
  const { service } = createService({
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({ url, options });
      return {
        response: { ok: false, status: 403 },
        data: {
          error: {
            message:
              'Your organization must be verified to use the model `gpt-image-2`. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization.',
          },
        },
      };
    },
  });

  await assert.rejects(
    () => service.generateWebsitePreviewImageWithAi({ host: 'softora.nl' }),
    (error) => {
      assert.equal(calls.length, 1);
      assert.match(String(calls[0].options.body || ''), /gpt-image-2/);
      assert.equal(error.status, 403);
      assert.equal(error.model, 'gpt-image-2');
      assert.match(String(error?.data?.error?.message || ''), /organization must be verified/i);
      return true;
    }
  );
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

test('ai remote service accepts chatgpt-image-latest without legacy response format', async () => {
  const calls = [];
  const { service } = createService({
    openAiImageModel: 'chatgpt-image-latest',
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
  assert.equal(calls[0].url, 'https://api.openai.test/v1/images/generations');
  assert.match(String(calls[0].options.body || ''), /"model":"chatgpt-image-latest"/);
  assert.doesNotMatch(String(calls[0].options.body || ''), /response_format/);
  assert.equal(result.model, 'chatgpt-image-latest');
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
            h1 { font-family: 'Oswald', sans-serif; }
            body { font-family: Inter, system-ui, sans-serif; }
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
  assert.deepEqual(result.scan.fontHints, ['Oswald', 'Inter']);
});

test('ai remote service follows client-side redirect shells before scanning website previews', async () => {
  const calls = [];
  const { service } = createService({
    fetchTextWithTimeout: async (url, options, timeoutMs) => {
      calls.push({ url, options, timeoutMs });
      if (url === 'https://softora.nl') {
        return {
          response: {
            ok: true,
            status: 200,
            url: 'https://www.softora.nl/',
            headers: {
              get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : ''),
            },
          },
          text: `
            <html>
              <head><title>Softora</title><script>window.location.replace('/premium-website');</script></head>
              <body>Je wordt doorgestuurd naar Softora.</body>
            </html>
          `,
        };
      }
      return {
        response: {
          ok: true,
          status: 200,
          url,
          headers: {
            get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : ''),
          },
        },
        text: `
          <html>
            <head><title>Softora | Premium Webdesign & Development</title></head>
            <body>
              <nav><a>Home</a><a>Diensten</a><a>Start project</a></nav>
              <main><h1>Digitaal Geregeld.</h1><section><h2>Wat we bouwen</h2><p>Websites, bedrijfssoftware, voicesoftware en chatbots voor ondernemers.</p></section></main>
            </body>
          </html>
        `,
      };
    },
    extractWebsitePreviewScanFromHtml: (html, pageUrl) => ({
      title: html.includes('Digitaal Geregeld') ? 'Softora | Premium Webdesign & Development' : 'Softora redirect',
      h1: html.includes('Digitaal Geregeld') ? 'Digitaal Geregeld.' : '',
      metaDescription: '',
      headings: html.includes('Wat we bouwen') ? ['Wat we bouwen'] : [],
      paragraphs: html.includes('Websites, bedrijfssoftware') ? ['Websites, bedrijfssoftware, voicesoftware en chatbots voor ondernemers.'] : [],
      bodyTextSample: html.includes('Digitaal Geregeld')
        ? 'Digitaal Geregeld. Wat we bouwen. Websites, bedrijfssoftware, voicesoftware en chatbots voor ondernemers.'
        : 'Je wordt doorgestuurd naar Softora.',
      sourceUrl: pageUrl,
    }),
  });

  const result = await service.fetchWebsitePreviewScanFromUrl('https://softora.nl');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://softora.nl');
  assert.equal(calls[1].url, 'https://www.softora.nl/premium-website');
  assert.equal(result.finalUrl, 'https://www.softora.nl/premium-website');
  assert.equal(result.scan.fetchSource, 'client-redirect');
  assert.equal(result.scan.clientRedirectUrl, 'https://www.softora.nl/premium-website');
  assert.equal(result.scan.h1, 'Digitaal Geregeld.');
  assert.match(result.scan.bodyTextSample, /Websites, bedrijfssoftware, voicesoftware en chatbots/);
  assert.doesNotMatch(result.scan.bodyTextSample, /doorgestuurd/);
});

test('ai remote service retries website preview fetch with a compat profile after a 403', async () => {
  const calls = [];
  const { service } = createService({
    fetchTextWithTimeout: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          response: {
            ok: false,
            status: 403,
            url,
            headers: { get: () => 'text/html; charset=utf-8' },
          },
          text: 'Forbidden',
        };
      }

      return {
        response: {
          ok: true,
          status: 200,
          url: 'https://www.bol.com/nl/nl/',
          headers: {
            get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : ''),
          },
        },
        text: '<html><head><title>bol</title></head><body><h1>bol</h1></body></html>',
      };
    },
    extractWebsitePreviewScanFromHtml: (_html, pageUrl) => ({
      title: 'bol',
      h1: 'bol',
      metaDescription: 'De winkel van ons allemaal',
      bodyTextSample: 'Kies uit miljoenen artikelen.',
      sourceUrl: pageUrl,
    }),
  });

  const result = await service.fetchWebsitePreviewScanFromUrl('https://www.bol.com/nl/nl/');

  assert.equal(calls.length, 2);
  assert.match(String(calls[0].options?.headers?.['User-Agent'] || ''), /Chrome\/135/);
  assert.match(String(calls[1].options?.headers?.['User-Agent'] || ''), /SoftoraWebsitePreview/);
  assert.equal(result.finalUrl, 'https://www.bol.com/nl/nl/');
  assert.equal(result.scan.title, 'bol');
});

test('ai remote service falls back to reader markdown when direct html is a block page', async () => {
  const calls = [];
  const { service } = createService({
    fetchTextWithTimeout: async (url, options) => {
      calls.push({ url, options });
      if (String(url).startsWith('https://r.jina.ai/')) {
        return {
          response: {
            ok: true,
            status: 200,
            url,
            headers: {
              get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/plain; charset=utf-8' : ''),
            },
          },
          text: `Title: De winkel van ons allemaal | bol
URL Source: https://www.bol.com/nl/nl/

Markdown Content:
# bol

De winkel van ons allemaal.

Kies uit miljoenen artikelen. Snel en veelal gratis verzonden!`,
        };
      }

      return {
        response: {
          ok: true,
          status: 200,
          url: 'https://www.bol.com/nl/nl/',
          headers: {
            get: (name) => (String(name || '').toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : ''),
          },
        },
        text: `
          <html>
            <head><title>IP adres 34.34.225.234 is geblokkeerd</title></head>
            <body>Je toegang tot bol is tijdelijk geblokkeerd vanwege mogelijk misbruik vanaf dit IP adres.</body>
          </html>
        `,
      };
    },
  });

  const result = await service.fetchWebsitePreviewScanFromUrl('https://www.bol.com/nl/nl/');

  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://r.jina.ai/https://www.bol.com/nl/nl/');
  assert.equal(result.finalUrl, 'https://www.bol.com/nl/nl/');
  assert.equal(result.scan.fetchSource, 'reader-fallback');
  assert.equal(result.scan.title, 'De winkel van ons allemaal | bol');
  assert.equal(result.scan.h1, 'bol');
  assert.match(String(result.scan.bodyTextSample || ''), /Kies uit miljoenen artikelen/);
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

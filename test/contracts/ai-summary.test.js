const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiSummaryService } = require('../../server/services/ai-summary');

function createFixture(overrides = {}) {
  const fetchCalls = [];

  const service = createAiSummaryService({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    parseIntSafe: (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    fetchJsonWithTimeout:
      overrides.fetchJsonWithTimeout ||
      (async (url, options, timeoutMs) => {
        fetchCalls.push({ url, options, timeoutMs });
        return {
          response: { ok: true, status: 200 },
          data: {
            choices: [
              {
                message: {
                  content: 'Korte Nederlandse samenvatting.',
                },
              },
            ],
            usage: { total_tokens: 111 },
          },
        };
      }),
    getOpenAiApiKey: () =>
      overrides.openAiApiKey === undefined ? 'openai-key' : overrides.openAiApiKey,
    extractOpenAiTextContent: (content) => String(content || ''),
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-5-mini',
  });

  return {
    fetchCalls,
    service,
  };
}

test('ai summary service normalizes styles and detects English markers conservatively', () => {
  const { service } = createFixture();

  assert.equal(service.normalizeAiSummaryStyle(' bullets '), 'bullets');
  assert.equal(service.normalizeAiSummaryStyle('iets-anders'), '');
  assert.equal(service.isDutchLanguageRequest('nl-NL'), true);
  assert.equal(
    service.summaryContainsEnglishMarkers(
      'The call summary mentioned a follow-up appointment after the meeting.'
    ),
    true
  );
  assert.equal(
    service.summaryContainsEnglishMarkers('Korte Nederlandse samenvatting zonder Engelse woorden.'),
    false
  );
});

test('ai summary service generates a stable summary payload through OpenAI', async () => {
  const { fetchCalls, service } = createFixture();

  const result = await service.generateTextSummaryWithAi({
    text: 'Dit is de brontekst.',
    style: 'short',
    language: 'nl',
    maxSentences: 2,
    extraInstructions: 'Hou het concreet.',
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.openai.test/v1/chat/completions');
  assert.match(String(fetchCalls[0].options.body || ''), /gpt-5-mini/);
  assert.equal(result.summary, 'Korte Nederlandse samenvatting.');
  assert.equal(result.style, 'short');
  assert.equal(result.language, 'nl');
  assert.equal(result.maxSentences, 2);
  assert.equal(result.source, 'openai');
  assert.equal(result.model, 'gpt-5-mini');
});

test('ai summary service rewrites English output when Dutch-only output is requested', async () => {
  let callCount = 0;
  const { service } = createFixture({
    fetchJsonWithTimeout: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          response: { ok: true, status: 200 },
          data: {
            choices: [
              {
                message: {
                  content:
                    'The call summary mentioned a follow-up appointment after the meeting.',
                },
              },
            ],
            usage: { total_tokens: 90 },
          },
        };
      }

      return {
        response: { ok: true, status: 200 },
        data: {
          choices: [
            {
              message: {
                content: 'De samenvatting noemt een vervolgafspraak na het gesprek.',
              },
            },
          ],
          usage: { total_tokens: 91 },
        },
      };
    },
  });

  const result = await service.generateTextSummaryWithAi({
    text: 'bron',
    style: 'medium',
    language: 'nl',
  });

  assert.equal(callCount, 2);
  assert.equal(result.summary, 'De samenvatting noemt een vervolgafspraak na het gesprek.');
  assert.equal(result.source, 'openai');
});

test('ai summary service reports missing API config with a stable 503 error', async () => {
  const { service } = createFixture({
    openAiApiKey: '',
  });

  await assert.rejects(
    () => service.generateTextSummaryWithAi({ text: 'bron' }),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(String(error.message || ''), /OPENAI_API_KEY ontbreekt/);
      return true;
    }
  );
});

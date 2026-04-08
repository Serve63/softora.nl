const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiHelpers } = require('../../server/services/ai-helpers');

function createAiHelpersFixture(overrides = {}) {
  return createAiHelpers({
    anthropicModel: overrides.anthropicModel || 'claude-opus-4-6',
    env: {
      ANTHROPIC_COST_INPUT_PER_1M: '5',
      ANTHROPIC_COST_OUTPUT_PER_1M: '25',
      OPENAI_COST_INPUT_PER_1M: '0.15',
      OPENAI_COST_OUTPUT_PER_1M: '0.6',
      OPENAI_COST_USD_TO_EUR: '0.91',
      ...(overrides.env || {}),
    },
    normalizeString: (value) => String(value || '').trim(),
    openAiModel: overrides.openAiModel || 'gpt-4o-mini',
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });
}

test('ai helpers parse loose json fences and normalize OpenAI and Anthropic text content', () => {
  const helpers = createAiHelpersFixture();

  assert.deepEqual(helpers.parseJsonLoose('```json\n{"ok":true,"count":2}\n```'), { ok: true, count: 2 });
  assert.equal(
    helpers.extractOpenAiTextContent([
      { text: 'Eerste regel' },
      { output_text: 'Tweede regel' },
      'Derde regel',
    ]),
    'Eerste regel\nTweede regel\nDerde regel'
  );
  assert.equal(
    helpers.extractAnthropicTextContent([
      { type: 'text', text: 'Alpha' },
      { content: [{ type: 'text', text: 'Beta' }] },
    ]),
    'Alpha\nBeta'
  );
});

test('ai helpers extract transcripts from nested payloads and retell transcript objects', () => {
  const helpers = createAiHelpersFixture();

  const payload = {
    message: {
      call: {
        artifact: {
          messages: [
            { role: 'agent', content: 'Goedemiddag, spreek ik met Servé?' },
            { role: 'lead', content: 'Ja, daar spreekt u mee.' },
          ],
        },
      },
    },
  };

  assert.equal(
    helpers.extractTranscriptSnippet(payload),
    'agent: Goedemiddag, spreek ik met Servé? | lead: Ja, daar spreekt u mee.'
  );
  assert.equal(
    helpers.extractTranscriptFull(payload),
    'agent: Goedemiddag, spreek ik met Servé?\nlead: Ja, daar spreekt u mee.'
  );

  assert.equal(
    helpers.extractRetellTranscriptText({
      transcript_object: [
        { speaker: 'agent', text: 'Welkom' },
        { speaker: 'lead', text: 'Dankjewel' },
      ],
    }),
    'agent: Welkom\nlead: Dankjewel'
  );
});

test('ai helpers estimate OpenAI and Anthropic costs from usage and text fallback', () => {
  const helpers = createAiHelpersFixture();

  const openAiUsageEstimate = helpers.estimateOpenAiUsageCost(
    {
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
    },
    'gpt-4o-mini'
  );
  assert.equal(openAiUsageEstimate.model, 'gpt-4o-mini');
  assert.equal(openAiUsageEstimate.promptTokens, 1000);
  assert.equal(openAiUsageEstimate.completionTokens, 500);
  assert.equal(openAiUsageEstimate.method, 'usage');
  assert.equal(openAiUsageEstimate.rates.source, 'env');
  assert.equal(openAiUsageEstimate.usd, 0.00045);
  assert.equal(openAiUsageEstimate.eur, 0.0004095);

  const anthropicTextEstimate = helpers.estimateAnthropicTextCost('abcd'.repeat(250), 'efgh'.repeat(125), 'claude-opus-4-6');
  assert.equal(anthropicTextEstimate.model, 'claude-opus-4-6');
  assert.equal(anthropicTextEstimate.promptTokens, 250);
  assert.equal(anthropicTextEstimate.completionTokens, 125);
  assert.equal(anthropicTextEstimate.method, 'text-fallback');
  assert.equal(anthropicTextEstimate.rates.source, 'env');
  assert.equal(anthropicTextEstimate.usd, 0.004375);
  assert.equal(anthropicTextEstimate.eur, 0.00398125);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSupportedOpenAiImageModel, normalizeOpenAiImageGenerationQuality, supportsOpenAiInputFidelity } = require('../../server/services/openai-image-model-capabilities');

test('image model validation accepts official Sunburst aliases and rejects invented variants', () => {
  for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-2.5-flare']) {
    assert.equal(isSupportedOpenAiImageModel(model), true);
    assert.equal(normalizeOpenAiImageGenerationQuality('xhigh', model), 'xhigh');
    assert.equal(normalizeOpenAiImageGenerationQuality('max', model), 'max');
    assert.equal(supportsOpenAiInputFidelity(model), false);
  }
  for (const model of ['gpt-image-2.5', 'gpt-image-2.5-made-up', 'gpt-image-2.5-sunburst-2099-01-01']) {
    assert.equal(isSupportedOpenAiImageModel(model), false);
  }
  assert.equal(normalizeOpenAiImageGenerationQuality('max', 'gpt-image-2'), 'low');
  assert.equal(normalizeOpenAiImageGenerationQuality('auto', 'gpt-image-2'), 'auto');
  assert.equal(supportsOpenAiInputFidelity('gpt-image-1.5'), true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWebsiteImageGenerationMetadata: metadata } = require('../../server/services/website-image-generation-cost');
const { buildWebdesignJobPayload } = require('../../server/services/webdesign-job-payload');
const { formatGenerationCost, formatOutputEstimate } = require('../../assets/premium-database-photo-batch');
const { createCostReporter } = require('../../assets/premium-database-photo-batch');

const payload = { model: 'gpt-image-2.5-sunburst', quality: 'max', size: '1024x1536',
  usage: { input_tokens: 3000, output_tokens: 5488, input_tokens_details: { text_tokens: 1000, image_tokens: 2000 } } };

test('image cost includes prompt and reference input, not only output', () => {
  const result = metadata(payload);
  assert.equal(result.cost.amountUsd, 0.18564); // $0.005 prompt + $0.016 reference + $0.16464 image.
  assert.equal(result.cost.currency, 'USD');
  assert.equal(result.quality, 'max');
  assert.equal(formatGenerationCost(result), 'ca. €0,20');
  assert.equal(formatOutputEstimate(1), 'ca. €0,04');
});

test('cached text and cached image tokens receive their own discounted rates', () => {
  const input = structuredClone(payload);
  Object.assign(input.usage.input_tokens_details, { cached_tokens: 600, cached_tokens_details: { text_tokens: 100, image_tokens: 500 } });
  assert.equal(metadata(input).cost.amountUsd, 0.182265);
});

test('missing, inconsistent and ambiguous usage never becomes a fabricated price', () => {
  for (const usage of [null, {}, { ...payload.usage, input_tokens: 0 },
    { ...payload.usage, output_tokens: -1 },
    { ...payload.usage, input_tokens_details: { text_tokens: 1000, image_tokens: 2000, cached_tokens: 600 } }]) {
    assert.equal(metadata({ ...payload, usage }).cost, null);
  }
  assert.equal(metadata({ ...payload, model: 'unknown-model' }).cost, null);
  assert.equal(formatGenerationCost(null), 'beeldkosten niet beschikbaar');
  assert.equal(formatGenerationCost({ cost: { amountUsd: 0, currency: 'USD' } }), 'beeldkosten niet beschikbaar');
});

test('job serialization preserves provenance and cost without prompt, image or arbitrary payload fields', () => {
  const generation = metadata({ ...payload, prompt: 'private', image: 'secret-image' });
  const stored = buildWebdesignJobPayload({ customer: { id: 'example' }, generation: { ...generation, prompt: 'private' } });
  assert.deepEqual(stored.generation, generation);
  assert.doesNotMatch(JSON.stringify(stored), /private|secret-image/);
});

test('the completed price replaces the estimate and survives the photo refresh announcement once', () => {
  const labels = [], messages = [];
  const root = { document: {
    createElement: () => ({ setAttribute() {}, classList: { add() {}, remove() {} }, style: {} }),
    body: { appendChild: (label) => labels.push(label) }, querySelectorAll: () => labels,
  }, requestAnimationFrame: (fn) => fn(), setTimeout() {} };
  const reporter = createCostReporter({ root, costEur: null, setStatusMessage: (text) => messages.push(text) });
  reporter.show('v2-visual-dna');
  assert.equal(labels[0].textContent, 'ca. €0,04');
  reporter.report({ customerId: 'example', company: 'Example', generation: metadata(payload) });
  assert.equal(labels[1].textContent, 'ca. €0,20');
  assert.equal(messages[0], 'Example · ca. €0,20');
  assert.equal(reporter.consume(['example']), 'ca. €0,20');
  assert.equal(reporter.consume(['example']), '');
});

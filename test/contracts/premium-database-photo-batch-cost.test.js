const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, formatEuroCost } = require('../../assets/premium-database-photo-batch');

test('opening a Sunburst batch shows the selected medium total estimate for both selection and total without starting generation', () => {
  const nodes = {
    generatePhotosButton: { disabled: false }, photoBatchChoiceButtons: [],
    photoBatchLimitInput: { value: '', focus() {} }, photoBatchAllCount: {}, photoBatchSummary: {},
    startPhotoBatchButton: {},
    photoBatchModal: { classList: { add() {} }, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null },
  };
  const controller = createController({
    nodes, costEur: null, formatEuroCost, getTargets: () => Array.from({ length: 100 }),
    closeAddActions() {}, generate() { assert.fail('Opening the selection must not generate images'); },
  });
  controller.open();
  assert.equal(nodes.photoBatchAllCount.textContent, '100 bedrijven');
  assert.equal(nodes.photoBatchSummary.textContent, '10 bedrijven · €0,40');
  assert.equal(nodes.startPhotoBatchButton.disabled, true);
});

test('batch generation requires an explicit provider and passes the chosen destination through', () => {
  const provider = { value: 'instantly', checked: false, addEventListener(_event, callback) { this.onChange = callback; } };
  const calls = [];
  const nodes = {
    generatePhotosButton: { disabled: false }, photoBatchChoiceButtons: [],
    photoBatchLimitInput: { value: '', focus() {}, addEventListener() {} }, photoBatchAllCount: {}, photoBatchSummary: {},
    startPhotoBatchButton: { addEventListener(_event, callback) { this.onStart = callback; } }, cancelPhotoBatchButton: { addEventListener() {} },
    photoBatchOptions: { addEventListener() {} },
    photoBatchModal: { classList: { add() {}, remove() {}, contains: () => true }, setAttribute() {}, addEventListener() {},
      querySelectorAll: () => [provider], querySelector: () => provider.checked ? provider : null },
  };
  const controller = createController({ nodes, getTargets: () => Array.from({ length: 10 }), closeAddActions() {}, generate: (...args) => calls.push(args) });
  controller.open();
  controller.bind();
  assert.equal(nodes.startPhotoBatchButton.disabled, true);
  provider.checked = true;
  provider.onChange();
  assert.equal(nodes.startPhotoBatchButton.disabled, false);
  nodes.photoBatchLimitInput.value = '10';
  nodes.startPhotoBatchButton.onStart();
  assert.deepEqual(calls, [[10, { silentProgress: true, mailProvider: 'instantly' }]]);
});


test('euro prices round upwards to cents with exactly two decimals, without floating point phantom cents', () => {
  assert.equal(formatEuroCost(0.1715), '€0,18');
  assert.equal(formatEuroCost(0.1934), '€0,20');
  assert.equal(formatEuroCost(0.18), '€0,18');
  assert.equal(formatEuroCost(0.1 + 0.2), '€0,30');
  assert.equal(formatEuroCost(0.00001), '€0,01');
  assert.equal(formatEuroCost(0), '€0,00');
  assert.equal(formatEuroCost(null), 'prijs na generatie');
});

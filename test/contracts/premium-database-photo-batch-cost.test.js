const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, formatEuroCost } = require('../../assets/premium-database-photo-batch');

test('opening a Sunburst batch shows explicit medium output estimates for both selection and total without starting generation', () => {
  const nodes = {
    generatePhotosButton: { disabled: false }, photoBatchChoiceButtons: [],
    photoBatchLimitInput: { value: '', focus() {} }, photoBatchAllCount: {}, photoBatchSummary: {},
    photoBatchModal: { classList: { add() {} }, setAttribute() {} },
  };
  const controller = createController({
    nodes, costEur: null, formatEuroCost, getTargets: () => Array.from({ length: 100 }),
    closeAddActions() {}, generate() { assert.fail('Opening the selection must not generate images'); },
  });
  controller.open();
  assert.equal(nodes.photoBatchAllCount.textContent, '100 bedrijven · ca. €1,08 + invoer (incl. 21% btw)');
  assert.equal(nodes.photoBatchSummary.textContent, 'Selectie: 10 bedrijven · ca. €0,11 + invoer (incl. 21% btw)');
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

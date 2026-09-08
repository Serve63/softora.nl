const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, formatEuroCost } = require('../../assets/premium-database-photo-batch');

test('opening a Sunburst batch shows explicit max output estimates for both selection and total without starting generation', () => {
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
  assert.equal(nodes.photoBatchAllCount.textContent, '100 bedrijven · ca. US$16,464 + invoer');
  assert.equal(nodes.photoBatchSummary.textContent, 'Selectie: 10 bedrijven · ca. US$1,6464 + invoer (beeldprijs; invoer extra)');
});

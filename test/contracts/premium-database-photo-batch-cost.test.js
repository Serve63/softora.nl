const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('opening a Sunburst batch shows variable costs for both selection and total without starting generation', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../assets/premium-database-photo-batch.js'), 'utf8'), { window });
  const page = fs.readFileSync(path.join(__dirname, '../../premium-database.html'), 'utf8');
  const formatterLine = page.split('\n').find(line => line.includes('function formatEuroCost(value)'));
  const formatEuroCost = vm.runInNewContext('(' + formatterLine.trim() + ')');
  const nodes = {
    generatePhotosButton: { disabled: false }, photoBatchChoiceButtons: [],
    photoBatchLimitInput: { value: '', focus() {} }, photoBatchAllCount: {}, photoBatchSummary: {},
    photoBatchModal: { classList: { add() {} }, setAttribute() {} },
  };
  const controller = window.SoftoraDatabasePhotoBatch.createController({
    nodes, costEur: null, formatEuroCost, getTargets: () => Array.from({ length: 100 }),
    closeAddActions() {}, generate() { assert.fail('Opening the selection must not generate images'); },
  });
  controller.open();
  assert.equal(nodes.photoBatchAllCount.textContent, '100 bedrijven · kosten variabel');
  assert.equal(nodes.photoBatchSummary.textContent, 'Selectie: 10 bedrijven · kosten variabel');
});

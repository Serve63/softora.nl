const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');

function loadManualLeadPromptHelpers(promptValues = []) {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/coldcalling-manual-lead-prompt.js'), 'utf8');
  const values = promptValues.slice();
  const sandbox = {
    window: {
      prompt: () => values.shift() || '',
    },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraColdcallingManualLeadPrompt;
}

test('coldcalling manual lead prompt exposes a standalone fallback prompt flow', async () => {
  const helpers = loadManualLeadPromptHelpers([
    '  Softora Test  ',
    ' Oisterwijk ',
    ' 0612345678 ',
    ' softora.nl ',
  ]);

  const result = await helpers.promptForManualLeadDetails({}, {
    normalizeFreeText: (value) => String(value || '').trim(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.values.company, 'Softora Test');
  assert.equal(result.values.address, 'Oisterwijk');
  assert.equal(result.values.phone, '0612345678');
  assert.equal(result.values.website, 'softora.nl');
});

test('coldcalling manual lead prompt cancels when required fallback fields are missing', async () => {
  const helpers = loadManualLeadPromptHelpers(['']);
  const result = await helpers.promptForManualLeadDetails();

  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
});

test('coldcalling dashboard delegates manual lead input to the extracted prompt helper', () => {
  const dashboardSource = fs.readFileSync(path.join(repoRoot, 'assets/coldcalling-dashboard.js'), 'utf8');
  const promptSource = fs.readFileSync(path.join(repoRoot, 'assets/coldcalling-manual-lead-prompt.js'), 'utf8');

  assert.match(dashboardSource, /window\.SoftoraColdcallingManualLeadPrompt/);
  assert.match(dashboardSource, /manualLeadPromptHelpers\.promptForManualLeadDetails\(defaults/);
  assert.doesNotMatch(dashboardSource, /data-manual-lead-company/);
  assert.match(promptSource, /data-manual-lead-company/);
  assert.match(promptSource, /Telefoonnummer lijkt ongeldig/);
});

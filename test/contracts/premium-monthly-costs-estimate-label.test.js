const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('premium terugkerende kosten toont Retell AI kosten als dynamische maandkosten', () => {
  const scriptPath = path.join(__dirname, '../../assets/premium-monthly-costs-dynamic.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  assert.match(
    scriptSource,
    /const COLDCALLING_COST_NOTE = 'Retell AI kosten deze maand';/
  );
  assert.match(scriptSource, /const COLDCALLING_PARTIAL_NOTE = 'Retell AI deels exact, deels geschat';/);
  assert.match(scriptSource, /function buildColdcallingCostNote\(summary\) \{/);
  assert.match(scriptSource, /const nextNote = normalizeString\(note\) \|\| COLDCALLING_COST_NOTE;/);
  assert.match(scriptSource, /const noteChanged = normalizeString\(item\.note\) !== nextNote;/);
  assert.match(scriptSource, /item\.note = nextNote;/);
});

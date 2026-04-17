const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('premium vaste lasten markeert coldcalling als schatting in de dynamische sync', () => {
  const scriptPath = path.join(__dirname, '../../assets/premium-monthly-costs-dynamic.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  assert.match(
    scriptSource,
    /const COLDCALLING_ESTIMATE_NOTE = 'Geschatte maandkosten, Retell kan hoger uitvallen';/
  );
  assert.match(scriptSource, /const nextNote = COLDCALLING_ESTIMATE_NOTE;/);
  assert.match(scriptSource, /const noteChanged = normalizeString\(item\.note\) !== nextNote;/);
  assert.match(scriptSource, /item\.note = nextNote;/);
});

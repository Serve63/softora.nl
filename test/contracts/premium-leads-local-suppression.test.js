const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium leads clears legacy browser suppression so server truth wins again', () => {
  const root = path.join(__dirname, '../..');
  const themeSource = fs.readFileSync(path.join(root, 'assets/personnel-theme.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(root, 'premium-ai-coldmailing.html'), 'utf8');

  assert.match(
    themeSource,
    /function readSuppressedLeadKeys\(\) \{\s*try \{\s*localStorage\.removeItem\("softora_coldcalling_suppressed_leads_json"\);/
  );
  assert.match(
    leadsPageSource,
    /function persistSuppressedLeadRows\(\) \{\s*try \{\s*localStorage\.removeItem\(LEAD_SUPPRESSION_STORAGE_KEY\);/
  );
  assert.match(
    leadsPageSource,
    /function hydrateSuppressedLeadRows\(\) \{\s*manuallySuppressedLeadKeys\.clear\(\);\s*persistSuppressedLeadRows\(\);\s*\}/
  );
  assert.match(
    leadsPageSource,
    /function filterSuppressedLeadRows\(rows\) \{\s*return Array\.isArray\(rows\) \? rows : \[\];\s*\}/
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium leads keeps suppression local without storage side effects', () => {
  const root = path.join(__dirname, '../..');
  const themeSource = fs.readFileSync(path.join(root, 'assets/personnel-theme.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(root, 'premium-ai-coldmailing.html'), 'utf8');

  assert.match(themeSource, /function readSuppressedLeadKeys\(\) \{/);
  assert.doesNotMatch(
    themeSource,
    /localStorage\.removeItem\("softora_coldcalling_suppressed_leads_json"\)/
  );
  assert.match(leadsPageSource, /const MANUAL_LEAD_SUPPRESSION_TTL_MS = 1000 \* 60 \* 2;/);
  assert.match(
    leadsPageSource,
    /function persistSuppressedLeadRows\(\) \{\s*purgeExpiredSuppressedLeadKeys\(\);\s*\}/
  );
  assert.match(
    leadsPageSource,
    /function hydrateSuppressedLeadRows\(\) \{\s*purgeExpiredSuppressedLeadKeys\(\);\s*\}/
  );
  assert.match(
    leadsPageSource,
    /function filterSuppressedLeadRows\(rows\) \{\s*if \(!Array\.isArray\(rows\)\) return \[\];[\s\S]*!isSuppressedLeadRow\(row\)/
  );
  assert.doesNotMatch(leadsPageSource, /localStorage\./);
});

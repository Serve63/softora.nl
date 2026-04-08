const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium actieve opdrachten renderen de claim-badge alleen met de naam', () => {
  const filePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /const claimHtml = `<div class="order-claim" aria-hidden="true"><span class="order-claim-name">\$\{escapeHtml\(claimInfo\.by \|\| 'Nog niet geclaimd'\)\}<\/span><\/div>`;/
  );
  assert.doesNotMatch(source, /<strong>Geclaimd door<\/strong>/);
  assert.match(source, /\.order-card\.has-claim\s+\.order-main\s*\{[\s\S]*padding-top:\s*3\.55rem;/);
  assert.match(source, /\.order-claim\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0\.95rem;[\s\S]*left:\s*50%;[\s\S]*transform:\s*translateX\(-50%\);/);
  assert.match(source, /<div class="order-card has-claim[\s\S]*\$\{claimHtml\}[\s\S]*<div class="order-main">/);
  assert.match(source, /leadOwnerName: String\(item\?\.leadOwnerName \|\| item\?\.leadOwnerFullName \|\| ''\)\.trim\(\),/);
  assert.match(source, /const linkedLeadOwnerName = resolveLinkedLeadOwnerNameForOrder\(customOrder\);[\s\S]*const claimedBy = normalizeClaimEmployeeName\(customOrder\.claimedBy \|\| runtime\.claimedBy \|\| linkedLeadOwnerName \|\| ''\);/);
  assert.match(source, /claimedBy: linkedLeadOwnerName \|\| null,/);
});

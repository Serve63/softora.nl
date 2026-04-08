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
  assert.match(source, /\.order-claim\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;/);
  assert.match(source, /<div class="order-actions">\s*\$\{claimHtml\}\s*<button class="execute-btn magnetic"/);
  assert.match(source, /leadOwnerName: String\(item\?\.leadOwnerName \|\| item\?\.leadOwnerFullName \|\| ''\)\.trim\(\),/);
  assert.match(source, /const linkedLeadOwnerName = resolveLinkedLeadOwnerNameForOrder\(customOrder\);[\s\S]*const claimedBy = normalizeClaimEmployeeName\(customOrder\.claimedBy \|\| runtime\.claimedBy \|\| linkedLeadOwnerName \|\| ''\);/);
  assert.match(source, /claimedBy: linkedLeadOwnerName \|\| null,/);
});

test('premium actieve opdrachten tonen create-order modal zonder sample-design en domeinvelden', () => {
  const filePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /Voorbeelddesign meenemen als basis/);
  assert.doesNotMatch(source, /Gebruik dit als je de stijl\/richting van het voorbeelddesign wilt doorzetten in de echte build\./);
  assert.doesNotMatch(source, /Domeinnaam \(voor live launch\)/);
  assert.doesNotMatch(source, /Optioneel, maar nodig als je ook domein-koppeling\/registratie wilt automatiseren\./);
  assert.doesNotMatch(source, /id="newOrderIncludeSampleDesign"/);
  assert.doesNotMatch(source, /id="newOrderDomain"/);
});

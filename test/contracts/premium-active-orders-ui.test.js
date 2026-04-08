const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium actieve opdrachten renderen de claim-badge alleen met de naam', () => {
  const filePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /const claimHtml = `<div class="order-claim"><span class="order-claim-name">\$\{escapeHtml\(claimInfo\.by \|\| 'Nog niet geclaimd'\)\}<\/span><\/div>`;/
  );
  assert.doesNotMatch(source, /<strong>Geclaimd door<\/strong>/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium algemene voorwaarden page shows the Softora VOF terms version', () => {
  const pagePath = path.join(__dirname, '../../premium-algemene-voorwaarden.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<title>Algemene voorwaarden Softora VOF - Softora\.nl<\/title>/);
  assert.match(pageSource, /<h1 class="terms-title">Algemene voorwaarden Softora VOF<\/h1>/);
  assert.match(pageSource, /<strong>Versie:<\/strong> 27 april 2026/);
  assert.match(pageSource, /<strong>Gevestigd te:<\/strong> Oisterwijk, Nederland/);
  assert.match(pageSource, /<strong>E-mail:<\/strong> info@softora\.nl/);

  const sectionCount = (pageSource.match(/class="av-section" id="art\d+"/g) || []).length;
  assert.equal(sectionCount, 33);

  assert.match(pageSource, /Artikel 20[\s\S]*AI, automatiseringen en softwarekoppelingen/);
  assert.match(pageSource, /Opdrachtgever blijft verantwoordelijk voor controle, gebruik, beslissingen, opvolging en uitkomsten van AI-systemen/);
  assert.match(pageSource, /Artikel 30[\s\S]*Non-solicitation/);
  assert.match(pageSource, /&euro;10\.000 per overtreding/);
  assert.match(pageSource, /De meest recente versie van deze algemene voorwaarden staat op de website van Softora\./);
  assert.doesNotMatch(pageSource, /Ja bro|Gebruikstip|Conclusie:/);
});

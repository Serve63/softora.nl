const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium privacy policy page shows the Softora VOF privacy declaration', () => {
  const pagePath = path.join(__dirname, '../../premium-privacy-policy.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<title>Privacyverklaring Softora VOF - Softora\.nl<\/title>/);
  assert.match(pageSource, /<h1 class="privacy-title">Privacyverklaring Softora VOF<\/h1>/);
  assert.match(pageSource, /<strong>Versie:<\/strong> 27 april 2026/);
  assert.match(pageSource, /<strong>Gevestigd te:<\/strong> Oisterwijk, Nederland/);
  assert.match(pageSource, /<strong>E-mail:<\/strong> info@softora\.nl/);
  assert.match(pageSource, /<strong>Website:<\/strong> www\.softora\.nl/);

  const sectionCount = (pageSource.match(/class="av-section" id="art\d+"/g) || []).length;
  assert.equal(sectionCount, 15);

  assert.match(pageSource, /Verwerking namens klanten/);
  assert.match(pageSource, /Geautomatiseerde besluitvorming/);
  assert.match(pageSource, /Doorgifte buiten de Europese Economische Ruimte/);
  assert.match(pageSource, /Softora verkoopt persoonsgegevens niet aan derden\./);
  assert.match(pageSource, /Adres: Oisterwijk, Nederland/);
  assert.doesNotMatch(pageSource, /Privacy Policy|Deze privacy policy is voor het laatst bijgewerkt/);
});

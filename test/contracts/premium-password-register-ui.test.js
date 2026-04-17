const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium wachtwoordenregister gebruikt dashboard-typografie en persistente editflow', () => {
  const pagePath = path.join(__dirname, '../../premium-wachtwoordenregister.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /family=Inter:wght@300;400;500;600;700&family=Oswald:wght@400;500;600;700/);
  assert.doesNotMatch(pageSource, /Barlow/);
  assert.doesNotMatch(pageSource, /<div class="reg-logo">SOFTORA\.NL<\/div>/);
  assert.doesNotMatch(pageSource, /cat-bar/);
  assert.doesNotMatch(pageSource, /Alle<\/button>/);
  assert.doesNotMatch(pageSource, /Hosting<\/button>/);
  assert.doesNotMatch(pageSource, /Tools<\/button>/);
  assert.doesNotMatch(pageSource, /Socials<\/button>/);

  assert.match(pageSource, /\.reg-title\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;[\s\S]*font-size:\s*3rem;/s);
  assert.match(pageSource, /\.main-content\s*\{[\s\S]*padding:\s*3rem 3rem 1\.8rem;/s);
  assert.match(pageSource, /const PASSWORD_REGISTER_SCOPE = 'premium_password_register';/);
  assert.match(pageSource, /const PASSWORD_REGISTER_ENTRIES_KEY = 'entries_json';/);
  assert.match(pageSource, /fetchUiStateGetWithFallback\(PASSWORD_REGISTER_SCOPE\)/);
  assert.match(pageSource, /fetchUiStateSetWithFallback\(PASSWORD_REGISTER_SCOPE, payload\)/);
  assert.match(pageSource, /\[PASSWORD_REGISTER_ENTRIES_KEY\]: JSON\.stringify\(sanitized\)/);
  assert.match(pageSource, /hosting@example\.test/);
  assert.match(pageSource, /Voorbeeldgegevens geladen\. Vervang deze en sla daarna op om echte gegevens veilig te bewaren\./);
  assert.doesNotMatch(pageSource, /persistPasswordEntries\('bootstrap'\)/);
  assert.doesNotMatch(pageSource, /H0st!nger24|Tr@nsIP2026!|G00gl3Work!|Insta\$oft24|Link3dIn!26/);
  assert.doesNotMatch(pageSource, /beheer@softora\.nl|admin@softora\.nl|info@softora\.nl/);
  assert.match(pageSource, /openEditModal\(/);
  assert.match(pageSource, /openCreateModal\(/);
  assert.match(pageSource, /class="add-entry-btn"/);
  assert.match(pageSource, /entryModalMode === 'create'/);
  assert.match(pageSource, /persistPasswordEntries\('create'\)/);
  assert.match(pageSource, /saveEntryFromModal/);
  assert.match(pageSource, /id="entry-modal"/);
  assert.match(pageSource, /id="entry-user"/);
  assert.match(pageSource, /id="entry-password"/);
});

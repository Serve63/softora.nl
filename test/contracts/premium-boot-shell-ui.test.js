const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pages = [
  'premium-personeel-dashboard.html',
  'premium-actieve-opdrachten.html',
  'premium-personeel-agenda.html',
  'premium-ai-coldmailing.html',
  'premium-ai-lead-generator.html',
  'premium-klanten.html',
  'premium-mailbox.html',
  'premium-pakketten.html',
  'premium-pdfs.html',
  'premium-boekhouding.html',
  'premium-kladblok.html',
  'premium-word.html',
  'premium-instellingen.html',
];

test('premium personeel pagina’s met boot-shell delen personnel-theme loader en hook', () => {
  const themePath = path.join(__dirname, '../../assets/personnel-theme.css');
  const themeSource = fs.readFileSync(themePath, 'utf8');
  assert.match(themeSource, /\.premium-boot-loader\s*\{/);
  assert.match(themeSource, /\.premium-boot-shell\.is-booting\s*\{/);

  const jsPath = path.join(__dirname, '../../assets/personnel-theme.js');
  const jsSource = fs.readFileSync(jsPath, 'utf8');
  assert.match(jsSource, /SoftoraPremiumBoot\.setShellBooting/);
  assert.match(jsSource, /main\.is-premium-boot-host/);

  const userMgmtPath = path.join(__dirname, '../../assets/premium-user-management.js');
  const userMgmtSource = fs.readFileSync(userMgmtPath, 'utf8');
  assert.match(
    userMgmtSource,
    /SoftoraPremiumBoot\.setShellBooting\(false\)/,
    'premium-user-management.js moet boot-shell sluiten na laden'
  );

  for (const file of pages) {
    const pagePath = path.join(__dirname, '../../', file);
    const source = fs.readFileSync(pagePath, 'utf8');
    assert.match(source, /<main[^>]*\bis-premium-boot-host\b/, file);
    assert.match(source, /class="premium-boot-loader"/, file);
    assert.match(source, /class="premium-boot-shell is-booting"/, file);
    if (file !== 'premium-instellingen.html') {
      assert.match(source, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
    }
  }
});

test('coldcalling-dashboard beëindigt premium boot-shell na bootstrap', () => {
  const scriptPath = path.join(__dirname, '../../assets/coldcalling-dashboard.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(
    source,
    /async function bootstrapColdcallingUi\(\) \{[\s\S]*finally \{[\s\S]*setShellBooting\(false\)/
  );
});

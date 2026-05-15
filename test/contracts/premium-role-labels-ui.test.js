const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium rol-labels tonen Full Acces in plaats van Administrator', () => {
  const root = path.join(__dirname, '../..');
  const premiumHtmlFiles = fs
    .readdirSync(root)
    .filter((file) => file.startsWith('premium-') && file.endsWith('.html'));

  for (const file of premiumHtmlFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, />Administrator</, `${file} bevat nog een Administrator-label`);
  }

  const themeSource = fs.readFileSync(path.join(root, 'assets/personnel-theme.js'), 'utf8');
  const userManagementSource = fs.readFileSync(
    path.join(root, 'assets/premium-user-management.js'),
    'utf8'
  );

  assert.doesNotMatch(themeSource, /Administrator/);
  assert.match(themeSource, /Full Acces/);
  assert.doesNotMatch(userManagementSource, /Administrator/);
  assert.match(userManagementSource, /Full Acces/);
  assert.match(userManagementSource, /function createPersonRow\(persoon\) \{/);
  assert.match(userManagementSource, /list\.replaceChildren\(\.\.\.team\.map\(createPersonRow\)\);/);
  assert.match(userManagementSource, /button\.addEventListener\('click', onClick\);/);
  assert.match(userManagementSource, /btn\.replaceChildren\(createPasswordVisibilityIcon\(show\)\);/);
  assert.doesNotMatch(userManagementSource, /onclick=/);
  assert.doesNotMatch(userManagementSource, /\.innerHTML\s*=/);
  assert.doesNotMatch(userManagementSource, /escapeJsString/);

  const settingsSource = fs.readFileSync(path.join(root, 'premium-instellingen.html'), 'utf8');
  assert.match(
    settingsSource,
    /assets\/premium-user-management\.js\?v=20260516a/,
    'premium-instellingen moet een versie op premium-user-management.js zetten zodat ADMIN niet uit browsercache terugkomt'
  );
});

test('premium instellingen gebruikt merk-kleuren in de verwijderpopup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-instellingen.html'), 'utf8');

  assert.match(source, /\.confirm-title\s*\{[\s\S]*color:\s*var\(--crimson\);/);
  assert.match(source, /\.btn-del\s*\{[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--crimson\),\s*var\(--crimson-light\)\);/);
});

test('premium instellingen valideert de pagina-pin server-side zonder hardcoded pincode', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-instellingen.html'), 'utf8');

  assert.doesNotMatch(source, /SETTINGS_PAGE_PIN\s*=\s*['"][0-9]{6}['"]/);
  assert.match(source, /fetch\('\/api\/premium-users\/verify-pin'/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*actionConfirmCode:\s*pin\s*\}\)/);
  assert.match(source, /window\.__premiumSettingsUnlockedPin\s*=\s*unlockedPin/);
});

test('premium gebruikersbeheer rendert personeelsrijen zonder html strings', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../assets/premium-user-management.js'), 'utf8');

  assert.match(source, /function createPersonRow\(persoon\) \{/);
  assert.match(source, /list\.replaceChildren\(\.\.\.team\.map\(createPersonRow\)\);/);
  assert.match(source, /createUserManagementIconButton\('edit', 'Medewerker bewerken'/);
  assert.doesNotMatch(source, /list\.innerHTML\s*=/);
  assert.doesNotMatch(source, /onclick="openEdit/);
  assert.doesNotMatch(source, /escapeJsString/);
  assert.match(source, /actionConfirmCode:\s*actionConfirmCode/);
  assert.doesNotMatch(source, /actionConfirmPin:\s*actionConfirmPin/);
});

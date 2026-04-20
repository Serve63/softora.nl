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

  const settingsSource = fs.readFileSync(path.join(root, 'premium-instellingen.html'), 'utf8');
  assert.match(
    settingsSource,
    /assets\/premium-user-management\.js\?v=20260421c/,
    'premium-instellingen moet een versie op premium-user-management.js zetten zodat ADMIN niet uit browsercache terugkomt'
  );
});

test('premium instellingen gebruikt merk-kleuren in de verwijderpopup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-instellingen.html'), 'utf8');

  assert.match(source, /\.confirm-title\s*\{[\s\S]*color:\s*var\(--crimson\);/);
  assert.match(source, /\.btn-del\s*\{[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--crimson\),\s*var\(--crimson-light\)\);/);
});

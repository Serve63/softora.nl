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
});

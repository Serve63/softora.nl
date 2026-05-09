const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('premium instellingen gebruikt delegated actions zonder inline handlers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-instellingen.html'), 'utf8');
  const userManagementSource = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-user-management.js'),
    'utf8'
  );

  assert.match(source, /<button type="button" class="settings-num-btn" data-settings-pin-digit="1">1<\/button>/);
  assert.match(source, /data-settings-pin-clear aria-label="Volledige PIN wissen"/);
  assert.match(source, /data-settings-pin-back aria-label="Laatste cijfer wissen"/);
  assert.match(source, /<button type="button" class="settings-pin-back" data-settings-action="cancel-pin">Terug naar instellingen<\/button>/);
  assert.match(source, /<button type="button" class="tegel" data-settings-action="open-pin">/);
  assert.match(source, /data-settings-action="back-overview"/);
  assert.match(source, /data-settings-action="lock"/);
  assert.match(source, /data-settings-password-toggle="new-pw"/);
  assert.match(source, /data-settings-password-toggle="edit-pw"/);
  assert.match(source, /data-settings-action="add-personnel"/);
  assert.match(source, /data-settings-overlay-close="edit-overlay"/);
  assert.match(source, /data-settings-overlay-close="confirm-overlay"/);
  assert.match(source, /data-settings-avatar-file/);
  assert.match(source, /data-settings-avatar-preview/);
  assert.match(source, /data-settings-action="cancel-admin-pin"/);
  assert.match(source, /\.tegel \{[\s\S]*font:\s*inherit;[\s\S]*text-align:\s*left;/);

  assert.match(source, /function bindSettingsStaticActions\(\)/);
  assert.match(source, /button\.addEventListener\('click', function \(\) \{[\s\S]*settingsPagePinDigit\(button\.dataset\.settingsPinDigit \|\| ''\);/);
  assert.match(source, /callSettingsGlobal\('togglePw', \[button\.dataset\.settingsPasswordToggle, button\]\);/);
  assert.match(source, /callSettingsGlobal\('onEditAvatarPicked', \[avatarFile\]\);/);
  assert.match(source, /bindSettingsStaticActions\(\);/);
  assert.match(userManagementSource, /persoon && persoon\.avatarDataUrl/);
  assert.match(userManagementSource, /document\.createElement\('img'\)/);
  assert.match(userManagementSource, /avatarImg\.src = avatarDataUrl/);
  assert.match(userManagementSource, /syncPremiumSidebarAfterUserManagementSave\(payload\.session\)/);
  assert.match(userManagementSource, /payload\.session/);
  assert.match(userManagementSource, /function mountExtraSettingsCategory\(\)/);
  assert.match(userManagementSource, /settings-tile-grid/);
  assert.match(userManagementSource, /\.settings-tile-grid,\.settings-extra-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(280px,280px\)\);/);
  assert.match(userManagementSource, /@media \(max-width:720px\)\{\.settings-tile-grid,\.settings-extra-grid\{grid-template-columns:minmax\(280px,280px\);\}\}/);
  assert.match(userManagementSource, /data-settings-extra-open/);
  assert.match(userManagementSource, /goTo\('screen-extra'\)/);
  assert.match(userManagementSource, /card\.className = 'tegel settings-extra-card';/);
  assert.match(userManagementSource, /appendUserManagementTextElement\(card, 'div', 'tegel-label', label\);/);
  assert.match(userManagementSource, /appendUserManagementTextElement\(card, 'div', 'tegel-count', 'Extra ' \+ number\);/);
  assert.match(userManagementSource, /Servé's gezondheidsdossier/);
  assert.match(userManagementSource, /Ruben zet toto/);
  assert.match(userManagementSource, /world watcher/);
  assert.match(userManagementSource, /Flynow/);
  assert.match(userManagementSource, /Transfermarkt/);
  assert.match(userManagementSource, /Net Worth Index/);
  assert.match(userManagementSource, /Pulse/);
  assert.match(userManagementSource, /Ruben’s Company/);
  assert.match(userManagementSource, /Ruben’s Trading System/);
  assert.match(userManagementSource, /mountExtraSettingsCategory\(\);/);

  assert.doesNotMatch(source, /\son(?:click|input|change|keydown|submit)=/);
  assert.doesNotMatch(source, /onclick=/);
  assert.doesNotMatch(source, /oninput=/);
  assert.doesNotMatch(source, /onchange=/);
  assert.doesNotMatch(userManagementSource, /\.settings-extra-card\{min-height:140px/);
});

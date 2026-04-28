const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('premium instellingen gebruikt delegated actions zonder inline handlers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-instellingen.html'), 'utf8');

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

  assert.doesNotMatch(source, /\son(?:click|input|change|keydown|submit)=/);
  assert.doesNotMatch(source, /onclick=/);
  assert.doesNotMatch(source, /oninput=/);
  assert.doesNotMatch(source, /onchange=/);
});

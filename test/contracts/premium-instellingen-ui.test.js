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
  assert.match(source, /id="admin-action-pin-input" name="softora_action_code" autocomplete="one-time-code"/);
  assert.match(source, /data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"/);
  assert.match(source, /class="settings-overview-grid"/);
  assert.match(source, /href="\/premium-vaste-lasten\?view=klantdekking"/);
  assert.match(source, /Worden alle kosten betaald\?/);
  assert.match(source, /Klantkosten-check/);
  assert.doesNotMatch(source, /id="edit-status"/);
  assert.doesNotMatch(source, /<label>Status<\/label><select id="edit-status"/);
  assert.match(source, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(source, /calc\(4 \* 320px \+ 3 \* 24px\)/);
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
  assert.match(userManagementSource, /\.settings-tile-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,280px\)\);/);
  assert.match(userManagementSource, /\.settings-tile-grid>\.tegel\{width:280px;min-width:0;aspect-ratio:1 \/ 1;\}/);
  assert.match(userManagementSource, /\.settings-extra-grid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(240px,1fr\)\);/);
  assert.match(userManagementSource, /max-width:calc\(4 \* 280px \+ 3 \* 20px\)/);
  assert.match(userManagementSource, /\.settings-extra-grid>\.tegel\{width:100%;min-width:0;\}/);
  assert.match(userManagementSource, /@media \(max-width:720px\)\{\.settings-tile-grid,\.settings-extra-grid\{grid-template-columns:minmax\(0,1fr\);max-width:100%;\}\.settings-tile-grid>\.tegel\{width:100%;\}\}/);
  assert.match(userManagementSource, /data-settings-extra-open/);
  assert.match(userManagementSource, /goTo\('screen-extra'\)/);
  assert.match(userManagementSource, /var isFlynow = label === 'Flynow';/);
  assert.match(userManagementSource, /data-settings-extra-href', '\/premium-flynow'/);
  assert.match(userManagementSource, /window\.location\.href = '\/premium-flynow';/);
  assert.match(userManagementSource, /card\.className = 'tegel settings-extra-card';/);
  assert.match(userManagementSource, /appendUserManagementTextElement\(card, 'div', 'tegel-label', label\);/);
  assert.match(userManagementSource, /appendUserManagementTextElement\(card, 'div', 'tegel-count', 'Extra ' \+ number\);/);
  assert.match(userManagementSource, /Servé's gezondheidsdossier/);
  assert.match(userManagementSource, /Ruben zet toto/);
  assert.match(userManagementSource, /world watcher/);
  assert.match(userManagementSource, /Flynow/);
  assert.match(userManagementSource, /Transfermarkt/);
  assert.match(userManagementSource, /Ruben’s Company/);
  assert.match(userManagementSource, /Ruben’s Trading System/);
  assert.match(userManagementSource, /'7 onderdelen'/);
  assert.doesNotMatch(userManagementSource, /Net Worth Index/);
  assert.doesNotMatch(userManagementSource, /Pulse/);
  assert.match(userManagementSource, /mountExtraSettingsCategory\(\);/);

  assert.doesNotMatch(source, /\son(?:click|input|change|keydown|submit)=/);
  assert.doesNotMatch(source, /onclick=/);
  assert.doesNotMatch(source, /oninput=/);
  assert.doesNotMatch(source, /onchange=/);
  assert.doesNotMatch(userManagementSource, /\.settings-extra-card\{min-height:140px/);
});

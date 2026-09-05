const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const extraModules = require('../../assets/premium-extra-modules.js');

test('premium instellingen gebruikt delegated actions zonder inline handlers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-instellingen.html'), 'utf8');
  const userManagementSource = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-user-management.js'),
    'utf8'
  );
  const moduleRoutesSource = fs.readFileSync(
    path.join(__dirname, '../../assets/settings-module-routes.js'),
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
  assert.match(source, /#admin-pin-overlay \.modal\s*\{[\s\S]*width:\s*min\(340px, calc\(100vw - 24px\)\);/);
  assert.match(source, /\.admin-pin-numpad\s*\{[\s\S]*grid-template-rows:\s*repeat\(4, 42px\);[\s\S]*max-width:\s*230px;/);
  assert.match(source, /\.admin-pin-icon,\s*\.admin-pin-eyebrow\s*\{\s*display:\s*none;/);
  assert.match(source, /class="admin-pin-cancel"[^>]*data-settings-action="cancel-admin-pin"/);
  assert.doesNotMatch(source, /#admin-pin-overlay[\s\S]{0,1800}<div class="modal-foot">/);
  assert.doesNotMatch(source, /href="\/premium-vaste-lasten\?view=klantdekking"/);
  assert.doesNotMatch(source, /Worden alle kosten betaald\?/);
  assert.doesNotMatch(source, /Klantkosten-check/);
  assert.doesNotMatch(source, /id="edit-status"/);
  assert.doesNotMatch(source, /<label>Status<\/label><select id="edit-status"/);
  assert.match(source, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(source, /calc\(4 \* 320px \+ 3 \* 24px\)/);
  assert.match(source, /\.tegel \{[\s\S]*font:\s*inherit;[\s\S]*text-align:\s*left;/);
  assert.match(source, /\.dashboard-layout\s*\{[\s\S]*display:\s*flex;[\s\S]*min-height:\s*100vh;[\s\S]*width:\s*100%;/);
  assert.match(source, /main\.main\.is-premium-boot-host\s*\{[\s\S]*flex:\s*0 0 calc\(100% - var\(--premium-sidebar-width,\s*320px\)\);/);
  assert.match(source, /\/\* Pagina-PIN: zelfde shell-centrering als premium-wachtwoordenregister \*\//);
  assert.match(source, /\.settings-screen-pin\s*\{[\s\S]*width:\s*100%;[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*center;/);

  const pinScreenRule = source.match(/#settings-screen-pin:not\(\[hidden\]\)\s*\{[\s\S]*?\}/);
  assert.ok(pinScreenRule, 'Personeel PIN-scherm moet eigen layoutregel houden');
  assert.match(pinScreenRule[0], /position:\s*static;/);
  assert.match(pinScreenRule[0], /width:\s*min\(1000px,\s*100%\);/);
  assert.match(pinScreenRule[0], /min-height:\s*calc\(100vh - 64px\);/);
  assert.match(pinScreenRule[0], /margin:\s*0 auto;/);
  assert.match(pinScreenRule[0], /padding:\s*0;/);
  assert.match(pinScreenRule[0], /background:\s*transparent;/);
  assert.doesNotMatch(pinScreenRule[0], /position:\s*fixed;/);
  assert.doesNotMatch(pinScreenRule[0], /\b(?:left|right|top|bottom):/);

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
  assert.match(userManagementSource, /window\.SoftoraSettingsModuleRoutes/);
  assert.match(userManagementSource, /moduleRoutes\.EXTRA_MODULES\.slice\(\)/);
  assert.match(userManagementSource, /var isLinkedModule = item\.unlocked === true && Boolean\(moduleHref\);/);
  assert.match(userManagementSource, /card\.setAttribute\('data-settings-extra-href', moduleHref\);/);
  assert.match(moduleRoutesSource, /href: '\/premium-gezondheidsdossier'/);
  assert.match(moduleRoutesSource, /href: '\/premium-omzetwerk'/);
  assert.match(userManagementSource, /card\.classList\.add\('settings-extra-card--locked'\);/);
  assert.match(userManagementSource, /card\.setAttribute\('data-settings-extra-locked', 'true'\);/);
  assert.match(userManagementSource, /card\.setAttribute\('aria-disabled', 'true'\);/);
  assert.match(userManagementSource, /class: isLinkedModule \? 'tegel-arrow' : 'settings-extra-lock'/);
  assert.match(userManagementSource, /isLinkedModule \? 'Extra ' \+ number : 'Vergrendeld'/);
  assert.match(userManagementSource, /\.settings-extra-card--locked\{opacity:\.52;cursor:not-allowed;/);
  assert.match(userManagementSource, /\.settings-extra-card--locked:hover\{transform:none;box-shadow:none;/);
  assert.match(userManagementSource, /\.settings-extra-lock\{position:absolute;top:20px;right:20px;/);
  assert.doesNotMatch(userManagementSource, /document\.createElement\('iframe'\)/);
  assert.doesNotMatch(userManagementSource, /settings-local-database-frame/);
  assert.doesNotMatch(userManagementSource, /localDatabaseFrame/);
  assert.doesNotMatch(moduleRoutesSource, /href: '\/premium-database'/);
  assert.match(userManagementSource, /function navigateToSettingsModule\(moduleHref\)/);
  assert.doesNotMatch(userManagementSource, /function openWinningModule\(moduleHref\)/);
  assert.doesNotMatch(userManagementSource, /requestAdminActionPin\('Winnen openen'/);
  assert.doesNotMatch(userManagementSource, /fetchJson\('\/api\/live-momentum\/access'/);
  assert.doesNotMatch(userManagementSource, /liveMomentumLocked/);
  assert.match(userManagementSource, /var targetWindow = window\.top && window\.top !== window \? window\.top : window;/);
  assert.match(userManagementSource, /targetWindow\.location\.href = moduleHref;/);
  assert.match(userManagementSource, /navigateToSettingsModule\(moduleHref\);/);
  assert.doesNotMatch(userManagementSource, /openLockedWinningModuleFromUrl/);
  assert.doesNotMatch(userManagementSource, /window\.location\.href = moduleHref;/);
  assert.match(source, /premium-extra-modules\.js\?v=20260811a/);
  assert.match(source, /settings-module-routes\.js\?v=20260906a/);
  assert.match(source, /premium-user-management\.js\?v=20260814a/);
  assert.match(userManagementSource, /card\.className = 'tegel settings-extra-card';/);
  assert.match(userManagementSource, /appendUserManagementTextElement\(card, 'div', 'tegel-label', label\);/);
  assert.match(moduleRoutesSource, /label: 'Winnen'[\s\S]*label: 'Database'[\s\S]*label: "Servé's gezondheidsdossier"/);
  assert.match(moduleRoutesSource, /Ruben zet toto/);
  assert.match(moduleRoutesSource, /world watcher/);
  assert.match(moduleRoutesSource, /Flynow/);
  assert.match(moduleRoutesSource, /Transfermarkt/);
  assert.match(moduleRoutesSource, /OMZETWERK/);
  assert.match(moduleRoutesSource, /Codex’ eigen zaak binnen Softora: koers, voortgang en bewijs richting €1\.000\.000\./);
  assert.match(moduleRoutesSource, /Ruben’s Trading System/);
  assert.match(userManagementSource, /'9 onderdelen'/);
  assert.doesNotMatch(userManagementSource, /Net Worth Index/);
  assert.doesNotMatch(userManagementSource, /Pulse/);
  assert.match(userManagementSource, /mountExtraSettingsCategory\(\);/);

  assert.doesNotMatch(source, /\son(?:click|input|change|keydown|submit)=/);
  assert.doesNotMatch(source, /onclick=/);
  assert.doesNotMatch(source, /oninput=/);
  assert.doesNotMatch(source, /onchange=/);
  assert.doesNotMatch(userManagementSource, /\.settings-extra-card\{min-height:140px/);
});

test('EXTRA-kaarten sorteren stabiel op toegang: eerst unlocked, daarna locked', () => {
  const items = [
    { label: 'locked-a', unlocked: false },
    { label: 'open-a', unlocked: true },
    { label: 'locked-b', unlocked: false },
    { label: 'open-b', unlocked: true },
  ];
  assert.deepEqual(
    extraModules.sortExtraSettingsItems(items).map((item) => item.label),
    ['open-a', 'open-b', 'locked-a', 'locked-b']
  );
});

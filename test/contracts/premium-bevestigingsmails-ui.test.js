const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

test('premium bevestigingsmails renders the current coldmailing dashboard shell without coldcalling bootstrap', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /<script[^>]+src=["']assets\/coldcalling-dashboard\.js[^"']*["'][^>]*>/);
  const coldmailingSidebarLink = pageSource.match(
    /<a class="sidebar-link magnetic active sidebar-link--autopilot" data-sidebar-key="coldmailing"[^>]*>[\s\S]*?<\/a>/
  );
  assert.ok(coldmailingSidebarLink, 'Coldmailing hoort als autopilot-sidebaritem actief te zijn');
  assert.doesNotMatch(coldmailingSidebarLink[0], /href=/);
  assert.match(coldmailingSidebarLink[0], /aria-disabled="true"/);
  assert.match(coldmailingSidebarLink[0], /tabindex="-1"/);
  assert.match(coldmailingSidebarLink[0], /<span class="sidebar-autopilot-badge" aria-hidden="true">autopilot<\/span>/);
  assert.doesNotMatch(coldmailingSidebarLink[0], /sidebar-link-lock/);
  assert.match(pageSource, /<div class="page-section-inner">/);
  assert.doesNotMatch(pageSource, /<div class="zones-row">/);
  assert.doesNotMatch(pageSource, /id="z1-count"/);
  assert.doesNotMatch(pageSource, /id="z2-count"/);
  assert.doesNotMatch(pageSource, /id="z4-count"/);
  assert.doesNotMatch(pageSource, /id="z5-count"/);
  assert.doesNotMatch(pageSource, /id="conv-zone-pct"/);
  assert.match(pageSource, /assets\/premium-coldmail-live-stats\.js\?v=20260611b/);
  assert.match(pageSource, /<div class="card-title">Standaard mailtekst<\/div>/);
  assert.match(pageSource, /<div class="campagne-title">Nieuwe Campagne<\/div>/);
  assert.match(pageSource, /Coldmailing wordt automatisch geblokkeerd zodra de agenda voor<br>de komende 10 werkdagen vol zit/);
  assert.doesNotMatch(pageSource, /Coldmailing wordt automatisch geblokkeerd zodra de agenda voor<br>de komende 10 werkdagen vol zit of het gewenste aantal afspraken is ingepland/);
  assert.doesNotMatch(pageSource, /<p>Coldcalling wordt automatisch geblokkeerd zodra de agenda voor<br>de komende 10 werkdagen vol zit/);
  assert.match(pageSource, /<button class="btn-start" id="start-campaign-btn" onclick="startCampagne\(\)" data-secure-mail-send-pin>/);
  assert.doesNotMatch(pageSource, /<!-- SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP -->/);
});

test('premium bevestigingsmails laadt geen coldmail teller per afzender', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-bevestigingsmails.html'), 'utf8');

  assert.doesNotMatch(pageSource, /assets\/premium-coldmail-sender-scoreboard\.js/);
  assert.doesNotMatch(pageSource, /coldmailSenderScoreboard/);
  assert.equal(fs.existsSync(path.join(root, 'assets/premium-coldmail-sender-scoreboard.js')), false);
});

test('premium bevestigingsmails live mailteller pollt echte coldmail statistieken', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-bevestigingsmails.html'), 'utf8');
  const liveStatsSource = fs.readFileSync(path.join(root, 'assets/premium-coldmail-live-stats.js'), 'utf8');
  const managementSource = fs.readFileSync(path.join(root, 'assets/premium-bevestigingsmails-management.js'), 'utf8');

  assert.match(liveStatsSource, /Vandaag verstuurd/);
  assert.match(liveStatsSource, /Laatste 24 uur/);
  assert.match(liveStatsSource, /Totaal Softora\/Gmail/);
  assert.match(liveStatsSource, /id="coldmailLiveSentToday"/);
  assert.match(liveStatsSource, /id="coldmailLiveSentLast24h"/);
  assert.match(liveStatsSource, /id="coldmailLiveSentTotal"/);
  assert.match(liveStatsSource, /function injectMarkup\(\)/);
  assert.match(liveStatsSource, /function readTotalSent\(stats\)/);
  assert.match(liveStatsSource, /stats\.systemTotalSent \|\| stats\.totalSent \|\| stats\.databaseTotalSent/);
  assert.match(liveStatsSource, /const STATS_URL = "\/api\/coldmailing\/stats";/);
  assert.match(liveStatsSource, /const REFRESH_MS = 15000;/);
  assert.match(liveStatsSource, /softora:coldmail-live-stats/);
  assert.match(liveStatsSource, /credentials: "same-origin"/);
  assert.match(liveStatsSource, /cache: "no-store"/);
  assert.match(liveStatsSource, /SoftoraColdmailLiveStats/);
  assert.match(managementSource, /function readStatsTotalSent\(stats\)/);
  assert.match(managementSource, /readStatsNumber\(stats, 'systemTotalSent'\)/);
});

test('premium bevestigingsmails blokkeert de pagina netjes tijdens coldmail verzending', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-bevestigingsmails.html'), 'utf8');
  const freezeSource = fs.readFileSync(path.join(root, 'assets/premium-coldmail-send-freeze.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(freezeSource, context);

  assert.match(pageSource, /assets\/premium-coldmail-send-freeze\.js\?v=20260520a/);
  assert.match(freezeSource, /OVERLAY_ID = 'coldmailSendFreezeOverlay'/);
  assert.match(freezeSource, /data-coldmail-send-freeze/);
  assert.match(freezeSource, /sendColdmailCampaignNowWithFreeze/);
  assert.match(freezeSource, /global\.sendColdmailCampaignNow = wrapped;/);
  assert.match(freezeSource, /show\(\);\s*try \{\s*return await original\.apply\(this, arguments\);[\s\S]*hide\(\);/);
  assert.match(freezeSource, /beforeunload/);
  assert.match(freezeSource, /event\.returnValue = '';/);
  assert.match(freezeSource, /pointer-events:auto/);
  assert.match(freezeSource, /softora-dossier-loader__orbit--outer/);
  assert.match(freezeSource, /Mails worden verstuurd/);
  assert.match(freezeSource, /Klikken is geblokkeerd tot de verzending klaar is\./);
  assert.doesNotMatch(freezeSource, /rgba\(25,27,39/);
  assert.equal(typeof context.window.SoftoraColdmailSendFreeze.show, 'function');
  assert.equal(typeof context.window.SoftoraColdmailSendFreeze.hide, 'function');
  assert.equal(typeof context.window.SoftoraColdmailSendFreeze.patchSendFreeze, 'function');
});

test('risky action pin modal uses a typed input without exposing the pin in frontend assets', () => {
  const pinAssetPath = path.join(__dirname, '../../assets/premium-risky-action-pin.js');
  const pinAssetSource = fs.readFileSync(pinAssetPath, 'utf8');

  assert.match(pinAssetSource, /type="password"/);
  assert.match(pinAssetSource, /inputmode="numeric"/);
  assert.doesNotMatch(pinAssetSource, /698069/);
  assert.doesNotMatch(pinAssetSource, /data-[a-z-]*pin-digit/);
  assert.doesNotMatch(pinAssetSource, /numpad/i);
});

test('premium ai lead generator alias rewrites the shared coldmailing subtitle to coldcalling', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /data-softora-lead-generator-alias/);
  assert.match(pageSource, /h1\.textContent = 'Coldcalling';/);
  assert.match(
    pageSource,
    /subtitle\.innerHTML =\s*'Coldcalling wordt automatisch geblokkeerd zodra de agenda voor<br>de komende 10 werkdagen vol zit\.';/
  );
  assert.doesNotMatch(
    pageSource,
    /Coldcalling wordt automatisch geblokkeerd zodra de agenda voor<br>de komende 10 werkdagen vol zit of het gewenste aantal afspraken is ingepland/
  );
});

test('premium bevestigingsmails bevestigt mailverzending met pincode-bolletjes zonder wachtwoordveld', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-bevestigingsmails.html'), 'utf8');
  const pinSource = fs.readFileSync(path.join(root, 'assets/premium-secure-action-pin.js'), 'utf8');

  assert.match(pageSource, /assets\/premium-secure-action-pin\.js\?v=20260520b/);
  assert.match(pageSource, /id="start-campaign-btn" onclick="startCampagne\(\)" data-secure-mail-send-pin/);

  assert.match(pinSource, /secure-action-pin-overlay\{[^}]*background:transparent;backdrop-filter:none/);
  assert.doesNotMatch(pinSource, /rgba\(25,27,39/);
  assert.match(pinSource, /var PIN_LENGTH = 4;/);
  assert.match(pinSource, /secure-action-pin-card,\.[^"]*box-sizing:border-box/);
  assert.match(pinSource, /secure-action-pin-card\{[^}]*width:min\(356px,100%\)/);
  assert.match(pinSource, /secure-action-pin-card\{[^}]*padding:24px 24px 22px/);
  assert.match(pinSource, /secure-action-pin-title\{[^}]*font-size:1\.18rem/);
  assert.match(pinSource, /secure-action-pin-slot\{[^}]*width:18px;height:18px/);
  assert.match(pinSource, /secure-action-pin-slot\.filled\{[^}]*background:#9b2355/);
  assert.match(pinSource, /slot\.textContent = "";/);
  assert.doesNotMatch(pinSource, /slot\.textContent = digit/);
  assert.match(pinSource, /secure-action-pin-pad\{[^}]*width:min\(216px,100%\)/);
  assert.match(pinSource, /secure-action-pin-key\{[^}]*height:38px/);
  assert.match(pinSource, /secure-action-pin-slot/);
  assert.match(pinSource, /data-secure-action-pin-digit/);
  assert.match(pinSource, /function confirmMailSend\(\)/);
  assert.match(pinSource, /title: "Mails versturen"/);
  assert.match(pinSource, /description: "Voer je 4-cijferige code in om deze verzending te starten\."/);
  assert.match(pinSource, /data-secure-mail-send-pin/);
  assert.match(pinSource, /window\.startCampagne\(pin\)/);
  assert.match(pinSource, /fetch\(verifyUrl/);
  assert.match(pinSource, /\/api\/premium-users\/verify-pin/);
  assert.match(pinSource, /actionConfirmScope: "coldmail-send"/);
  assert.match(pinSource, /autocomplete="one-time-code"/);
  assert.match(pinSource, /name="softora_action_code"/);
  assert.match(pinSource, /data-1p-ignore="true"/);
  assert.match(pinSource, /data-lpignore="true"/);
  assert.match(pinSource, /data-bwignore="true"/);
  assert.match(pinSource, /data-form-type="other"/);
  assert.match(pinSource, /JSON\.stringify\(\{ actionConfirmCode: pin, actionConfirmScope: "coldmail-send" \}\)/);
  assert.doesNotMatch(pinSource, /actionConfirmPin/);
  assert.doesNotMatch(pinSource, /secure-action-pin-cancel/);
  assert.doesNotMatch(pinSource, />Annuleren</);
  assert.doesNotMatch(pinSource, /type=["']password["']/);
  assert.doesNotMatch(pinSource, /autocomplete=["']current-password["']/);
});

test('premium bevestigingsmails houdt het handmatige coldmailing scherm zichtbaar in softwaremodus', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const managementPath = path.join(__dirname, '../../assets/premium-bevestigingsmails-management.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const managementSource = fs.readFileSync(managementPath, 'utf8');

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<script src="assets\/ai-management-mode\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /id="screen-ai-management"/);
  assert.match(pageSource, /AI bepaalt zelf of coldmailing nu nodig is/);
  assert.match(pageSource, /AI is momenteel hier niet mee bezig\./);
  assert.doesNotMatch(pageSource, /html\[data-ai-management-mode="software"\] #screen-dashboard,/);
  assert.doesNotMatch(pageSource, /html\[data-ai-management-mode="software"\] #screen-ai-management \{ display: block !important; \}/);
  assert.match(pageSource, /<script src="assets\/premium-coldmail-autopilot\.js\?v=20260611a"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-bevestigingsmails-management\.js\?v=20260611b" defer><\/script>/);
  assert.match(managementSource, /AI is momenteel hier niet mee bezig\./);
  assert.match(managementSource, /Vandaag zijn er \$\{liveSentToday\} mails echt verzonden/);
  assert.match(managementSource, /window\.addEventListener\('softora-ai-management-change', updateAiColdmailingWorkspace\);/);
  assert.match(managementSource, /softora:coldmail-live-stats/);
  assert.match(managementSource, /softora:coldmail-autopilot-status/);
});

test('premium bevestigingsmails keeps the campaign duration setting without a separate looptijd card', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /<div class="topbar-note-label">Looptijd<\/div>/);
  assert.doesNotMatch(pageSource, /campaign-duration-note/);
  assert.doesNotMatch(pageSource, /<script[^>]+src=["']assets\/coldcalling-dashboard\.js[^"']*["'][^>]*>/);
});

test('premium bevestigingsmails is directly accessible without coming-soon lock styling', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const themePath = path.join(__dirname, '../../assets/personnel-theme.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const themeSource = fs.readFileSync(themePath, 'utf8');
  const comingSoonKeysMatch = themeSource.match(
    /const PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set\(\[([\s\S]*?)\]\);/
  );

  assert.doesNotMatch(pageSource, /content-lock-overlay/);
  assert.doesNotMatch(pageSource, /unlockContentArea\(/);
  assert.doesNotMatch(pageSource, /Binnenkort beschikbaar/);
  assert.ok(comingSoonKeysMatch);
  assert.doesNotMatch(comingSoonKeysMatch[1], /"coldmailing"/);
  assert.match(themeSource, /key: "coldmailing"/);
});

test('premium bevestigingsmails hides the old zone cards from the dashboard grid', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /\.zones-row \{ display: grid;[\s\S]*gap: 12px;/);
  assert.match(pageSource, /\.bottom-grid \{ display: grid; grid-template-columns: 1fr 360px; gap: 20px;/);
  assert.doesNotMatch(pageSource, /<div class="zones-row">/);
  assert.match(pageSource, /<div class="page-section-inner">\s*<div class="bottom-grid">/);
});

test('premium bevestigingsmails campaign finish uses Campagne afronden label and canonical URL for notifications', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /PREMIUM_BEVESTIGINGSMAILS_CANONICAL\s*=\s*'https:\/\/www\.softora\.nl\/premium-bevestigingsmails'/);
  assert.match(pageSource, /notifyColdmailingCampaignAfronden/);
  assert.match(pageSource, /'Campagne afronden'/);
  assert.doesNotMatch(pageSource, /Terug naar overzicht/);
});

test('premium bevestigingsmails hides the verbose checkpoint text block in the status card', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /campaign-status-text/);
});

test('premium bevestigingsmails includes lead-generator campaign boot overlay before immediate start', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="campaign-boot-overlay"/);
  assert.match(pageSource, /id="campaign-boot-status"/);
  assert.match(pageSource, /id="campaign-boot-eta"/);
  assert.match(pageSource, /function startCampagneWithLeadGeneratorBoot/);
  assert.match(pageSource, /function startCampagneImmediate/);
  assert.match(
    pageSource,
    /function startCampagne\(verifiedMailSendPin\) \{[\s\S]*?isPremiumAiLeadGeneratorPath\(\)[\s\S]*?startCampagneWithLeadGeneratorBoot/
  );
});

test('premium bevestigingsmails campaign volume uses a fixed mail company label', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /field-label-nav/);
  assert.doesNotMatch(pageSource, /cycleCampaignCountMode/);
  assert.doesNotMatch(pageSource, /campaign-count-mode-label/);
  assert.doesNotMatch(pageSource, /Hoeveel afspraken inplannen\?/);
  assert.match(pageSource, /<div class="field-label" id="campaignVolumeLabel">Hoeveel bedrijven mailen\?<\/div>/);
  assert.match(pageSource, /<output class="field-val" id="slider-val" for="mail-slider" aria-live="polite" aria-label="Aantal bedrijven mailen">9<\/output>/);
  assert.doesNotMatch(pageSource, /campaign-volume-input|onfocus="this\.select\(\)"|onblur="updateSlider\(this\.value\)"/);
  assert.match(pageSource, /<input class="slider" type="range" min="1" max="9" step="1" value="9" id="mail-slider"/);
  assert.match(pageSource, /const COLDMAIL_VOLUME_CONTROL = \{ min: 1, max: 9, step: 1, value: 9/);
  assert.match(pageSource, /const COLDCALL_VOLUME_CONTROL = \{ min: 10, max: 500, step: 10, value: 100/);
  assert.match(pageSource, /campaignVolumeLabel\.textContent = 'Hoeveel bedrijven bellen\?';/);
  assert.match(pageSource, /const raw = Number\.parseInt\(v \|\| \(slider && slider\.value\) \|\| min, 10\);/);
  assert.match(pageSource, /Math\.max\(min, Math\.min\(max, Number\.isFinite\(raw\) \? raw : min\)\)/);
  assert.match(pageSource, /valueEl\.setAttribute\('aria-label', isPremiumAiLeadGeneratorPath\(\) \? 'Aantal bedrijven bellen' : 'Aantal bedrijven mailen'\);/);
  assert.doesNotMatch(pageSource, /Aantal te mailen bedrijven/);
});

test('premium bevestigingsmails toont bedrijfsicoon met database-aantal in Nieuwe Campagne', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const testModePath = path.join(__dirname, '../../assets/premium-campaign-test-mode.js');
  const sendCopyPath = path.join(__dirname, '../../assets/premium-coldmail-send-copy.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const testModeSource = fs.readFileSync(testModePath, 'utf8');
  const sendCopySource = fs.readFileSync(sendCopyPath, 'utf8');

  assert.match(pageSource, /<div class="campagne-head">[\s\S]*<div class="campagne-title">Nieuwe Campagne<\/div>[\s\S]*id="campaignCompanyCount"/);
  assert.match(pageSource, /<link rel="stylesheet" href="assets\/softora-dossier-loader\.css\?v=20260424a">/);
  assert.match(pageSource, /<script src="assets\/premium-campaign-radius\.js\?v=20260501a"><\/script>/);
  assert.match(pageSource, /assets\/premium-campaign-test-mode\.js\?v=20260527a/);
  assert.match(pageSource, /<main class="main-content is-premium-boot-host">/);
  assert.match(pageSource, /<div class="premium-boot-loader" id="premium-boot-loader" aria-hidden="true">/);
  assert.match(pageSource, /<div class="premium-boot-shell is-booting" aria-busy="true">/);
  assert.match(pageSource, /function finishPremiumShellBoot\(\)/);
  assert.match(pageSource, /Promise\.allSettled\(campaignBootTasks\)\.finally\(finishPremiumShellBoot\);/);
  assert.match(pageSource, /<button class="campaign-company-count" id="campaignCompanyCount" type="button"[^>]*onclick="toggleCampaignRecipientsList\(event\)"/);
  assert.match(pageSource, /id="campaignTestModeToggle"[^>]*aria-pressed="false"/);
  assert.match(pageSource, /id="campaignTestModeToggle"[\s\S]*id="campaignCompanyCount"/);
  assert.match(pageSource, /<span id="campaignCompanyCountValue">0<\/span>/);
  assert.match(pageSource, /\.campaign-company-count \{[\s\S]*display: inline-flex;[\s\S]*border-radius: 999px;/);
  assert.match(pageSource, /\.campaign-test-mode-toggle\.is-active \{[\s\S]*background: var\(--crimson\);[\s\S]*color: #fff;/);
  assert.match(pageSource, /\.campaign-test-mode-toggle\.is-active::after \{[\s\S]*background: #16a34a;/);
  assert.match(pageSource, /id="campaignRecipientList" hidden/);
  assert.match(pageSource, /\.campaign-recipient-list \{[\s\S]*position: absolute;[\s\S]*max-height: 300px;/);
  assert.match(pageSource, /const CUSTOMER_DB_SCOPE = 'premium_customers_database';/);
  assert.match(pageSource, /const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';/);
  assert.match(pageSource, /CUSTOMER_DB_KEY \+ '_chunks_v1'/);
  assert.match(pageSource, /CUSTOMER_DB_KEY \+ '_chunk_' \+ index/);
  assert.match(pageSource, /const COLDMAIL_TEST_COMPANIES = \['mcv e-commerce', 'softora testmodus'\];/);
  assert.match(pageSource, /function isDedicatedColdmailTestCampaignRow\(row\)/);
  assert.match(pageSource, /if \(!row \|\| typeof row !== 'object' \|\| isDedicatedColdmailTestCampaignRow\(row\)\) return false;/);
  assert.match(pageSource, /function isColdmailTestCampaignCompany\(row\)/);
  assert.match(pageSource, /if \(isColdmailTestCampaignCompany\(row\)\) return isLikelyCampaignEmail\(getCampaignRowEmail\(row\)\);/);
  assert.match(pageSource, /function hydrateCampaignCompanyCountFromSupabase\(\)/);
  assert.match(pageSource, /function initCampaignDatabaseAutoRefresh\(\)/);
  assert.match(pageSource, /window\.addEventListener\('focus', refreshCampaignDatabaseForLatestState\);/);
  assert.match(pageSource, /document\.addEventListener\('visibilitychange'/);
  assert.match(pageSource, /window\.setInterval\(\(\) => \{[\s\S]*refreshCampaignDatabaseForLatestState\(\);[\s\S]*\}, 15000\);/);
  assert.doesNotMatch(pageSource, /id="campaignRecipientPreview"/);
  assert.match(pageSource, /function hydrateCampaignRecipientList\(\)/);
  assert.doesNotMatch(pageSource, /Deze pagina staat op coldcalling\. E-mailontvangers zie je bij Coldmailing\./);
  assert.doesNotMatch(pageSource, /if \(isPremiumAiLeadGeneratorPath\(\)\) \{\s*setCampaignRecipientListLoading/);
  assert.match(pageSource, /function toggleCampaignRecipientsList\(event\)/);
  assert.match(pageSource, /function renderCampaignRecipientList\(payload\)/);
  assert.match(pageSource, /\/api\/coldmailing\/campaigns\/recipients\?/);
  assert.match(pageSource, /if \(isPremiumAiLeadGeneratorPath\(\)\) params\.set\('mode', 'call'\);/);
  assert.match(pageSource, /params\.set\('testMode', '1'\);/);
  assert.match(pageSource, /if \(serviceSelect && serviceSelect\.value\) params\.set\('service', serviceSelect\.value\);/);
  assert.match(pageSource, /serviceKey = normalizeLowerText\(serviceSelect && serviceSelect\.value\)[\s\S]*serviceKey === 'websites' \|\| serviceKey === 'website'\) \? 'webdesign' : ''\);/);
  assert.match(pageSource, /if \(specialAction\) params\.set\('specialAction', specialAction\);/);
  assert.match(pageSource, /recipient\.bedrijf \|\| 'Onbekend bedrijf'/);
  assert.match(pageSource, /const showPhone = isPremiumAiLeadGeneratorPath\(\);/);
  assert.match(pageSource, /function normalizeCampaignRecipientPhone\(value\)/);
  assert.match(pageSource, /function getCampaignRowPhone\(row\)/);
  assert.match(pageSource, /row\.phoneE164 \|\|[\s\S]*row\.phone \|\|[\s\S]*row\.tel \|\|[\s\S]*row\.telefoon \|\|[\s\S]*row\.telefoonnummer \|\|[\s\S]*row\.contactPhone/);
  assert.match(pageSource, /if \(!getCampaignRowPhone\(row\)\) return false;/);
  assert.match(pageSource, /const recipientPhone = getCampaignRowPhone\(recipient\);/);
  assert.match(pageSource, /recipientPhone \|\| 'Geen telefoonnummer ingevuld'/);
  assert.match(pageSource, /recipient\.email \|\| 'Geen e-mailadres'/);
  assert.match(pageSource, /function isEligibleColdmailCampaignRow\(row\)/);
  assert.match(pageSource, /function isEligibleColdcallingCampaignRow\(row\)/);
  assert.match(pageSource, /function isEligibleCampaignCountRow\(row\) \{\s*return isPremiumAiLeadGeneratorPath\(\)[\s\S]*isEligibleColdcallingCampaignRow\(row\)[\s\S]*isEligibleColdmailCampaignRow\(row\);/);
  assert.match(pageSource, /function isCampaignRowWithinRadius\(row\)/);
  assert.match(pageSource, /params\.set\('radiusKm', String\(getSelectedCampaignRadiusKm\(\)\)\);/);
  assert.match(pageSource, /<input class="slider" type="range" min="0" max="12" value="4" id="km-slider" oninput="updateKm\(this\.value\)">/);
  assert.match(pageSource, /<div class="slider-row"><span>10 km<\/span><span>250 km<\/span><span>500 km<\/span><\/div>/);
  assert.match(pageSource, /const KM_OPTIES = \[10,20,30,40,50,75,100,130,150,175,200,250,500\];/);
  assert.match(pageSource, /const index = Math\.max\(0, Math\.min\(KM_OPTIES\.length - 1,/);
  assert.match(pageSource, /const pct = KM_OPTIES\.length > 1 \? \(index \/ \(KM_OPTIES\.length - 1\)\) \* 100 : 0;/);
  assert.match(pageSource, /function renderCampaignCompanyCount\(countOverride\)/);
  assert.match(pageSource, /Number\.isFinite\(Number\(countOverride\)\)/);
  assert.match(pageSource, /const response = await fetch\(getColdmailRecipientPreviewUrl\(\), \{[\s\S]*method: 'GET',[\s\S]*credentials: 'same-origin',[\s\S]*headers: \{ Accept: 'application\/json' \},[\s\S]*cache: 'no-store',[\s\S]*\}\);/);
  assert.match(pageSource, /const requestedCount = getCampaignRequestedCompanyCount\(\), requestedRadiusKm = getSelectedCampaignRadiusKm\(\), requestedTestMode = Boolean/);
  assert.match(pageSource, /requestedTestMode = Boolean\(window\.SoftoraCampaignTestMode && window\.SoftoraCampaignTestMode\.isEnabled\(\)\)/);
  assert.match(pageSource, /if \(requestedCount !== getCampaignRequestedCompanyCount\(\) \|\| requestedRadiusKm !== getSelectedCampaignRadiusKm\(\) \|\| requestedTestMode !== Boolean/);
  assert.match(pageSource, /const serverCount = Number\(data && data\.selected\) \|\| recipients\.length;/);
  assert.match(pageSource, /renderCampaignCompanyCount\(serverCount\);/);
  assert.match(pageSource, /if \(isPremiumAiLeadGeneratorPath\(\)\) renderCampaignCompanyCount\(0\);/);
  assert.match(pageSource, /0 bedrijven geselecteerd voor deze filters\./);
  assert.match(pageSource, /bedrijven geselecteerd, maar de namen konden niet geladen worden\./);
  assert.match(pageSource, /0 geldige ontvangers\. Eerste afgevallen bedrijf:/);
  assert.doesNotMatch(pageSource, /renderCampaignCompanyCount\(getCampaignRequestedCompanyCount\(\)\);/);
  assert.doesNotMatch(pageSource, /renderCampaignCompanyCount\(Number\(data && data\.selected\) \|\| recipients\.length\);/);
  assert.doesNotMatch(pageSource, /renderCampaignCompanyCount\(Number\(data\.candidates/);
  assert.match(pageSource, /Math\.max\(0, requestedCount\)/);
  assert.match(pageSource, /const specialActionSelect = document\.getElementById\('campaignSpecialAction'\), serviceKey = normalizeLowerText\(serviceSelect && serviceSelect\.value\)[\s\S]*specialAction = \(specialActionSelect && specialActionSelect\.value\) \|\| \(!isPremiumAiLeadGeneratorPath\(\) && \(serviceKey === 'websites' \|\| serviceKey === 'website'\) \? 'webdesign' : ''\);/);
  assert.match(pageSource, /specialAction,\s*durationDays: getSelectedCampaignDurationDays\(\),/);
  assert.match(pageSource, /window\.SoftoraCampaignTestMode\.appendRecipientParams\(params, isPremiumAiLeadGeneratorPath\(\)\);/);
  assert.match(pageSource, /testRecipientEmails: \(window\.SoftoraCampaignTestMode && typeof window\.SoftoraCampaignTestMode\.getPayloadRecipientEmails === 'function'/);
  assert.match(pageSource, /radiusKm: getSelectedCampaignRadiusKm\(\), testMode: Boolean\(window\.SoftoraCampaignTestMode && window\.SoftoraCampaignTestMode\.isEnabled\(\)\), testRecipientEmails:/);
  assert.match(sendCopySource, /return 'Testmail verstuurd naar ' \+ formatTestRecipientLabel\(sendResult\) \+ '\.';/);
  assert.match(testModeSource, /const TEST_RECIPIENT_EMAILS = \['servec321@gmail\.com', 'serve@softora\.nl'\];/);
  assert.match(testModeSource, /getRecipientEmails: function \(\) \{ return TEST_RECIPIENT_EMAILS\.slice\(\); \}/);
  assert.match(testModeSource, /appendRecipientParams,/);
  assert.match(testModeSource, /getPayloadRecipientEmails,/);
  assert.match(testModeSource, /button\.addEventListener\('click'/);
  assert.match(testModeSource, /hydrateCampaignCompanyCountFromSupabase/);
  assert.doesNotMatch(pageSource, /renderCampaignCompanyCount\(\);\s*void hydrateCampaignCompanyCountFromSupabase\(\);/);
  assert.match(pageSource, /initCampaignDatabaseAutoRefresh\(\);/);
  assert.match(pageSource, /const campaignBootTasks = \[/);
  assert.match(pageSource, /hydrateCampaignCompanyCountFromSupabase\(\),/);
  assert.match(pageSource, /setCampaignRecipientListOpen\(false\);/);
  assert.match(pageSource, /function configureCampaignVolumeControl\(\)/);
  assert.match(pageSource, /if \(slider\) slider\.value = String\(value\); if \(valueEl\) valueEl\.textContent = String\(value\);\s*renderCampaignCompanyCount\(value\);/);
  assert.match(pageSource, /configureCampaignVolumeControl\(\);\s*updateSlider\(document\.getElementById\('mail-slider'\)/);
  assert.match(pageSource, /if \(actualTotal <= 0\) \{[\s\S]*showToast\(firstFailure \|\| 'Er staan nog geen bedrijven met een klaar website-design voor deze campagne\.'\);[\s\S]*await hydrateCampaignCompanyCountFromSupabase\(\);[\s\S]*return;/);
  assert.match(pageSource, /if \(actualTotal < n\) showToast\(actualTotal \+ ' bedrijf' \+ \(actualTotal === 1 \? '' : 'en'\) \+ ' zijn klaar met website-design en worden meegenomen\.'\);/);
});

test('premium bevestigingsmails keeps unavailable services locked in the campaign selector', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const selectsPath = path.join(__dirname, '../../assets/premium-campaign-selects.js');
  const customSelectsCssPath = path.join(__dirname, '../../assets/custom-selects.css');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const selectsSource = fs.readFileSync(selectsPath, 'utf8');
  const customSelectsCssSource = fs.readFileSync(customSelectsCssPath, 'utf8');

  assert.match(pageSource, /<script src="assets\/premium-campaign-selects\.js\?v=20260511a"><\/script>/);
  assert.match(
    pageSource,
    /<select class="sel" id="service">\s*<option value="websites" selected>Website's<\/option>\s*<option value="voice_software" disabled>Voicesoftware<\/option>\s*<option value="business_software" disabled>Bedrijfssoftware<\/option>\s*<option value="ai_chatbots" disabled>AI Chatbots<\/option>\s*<\/select>/
  );
  assert.doesNotMatch(pageSource, /function enhanceCampaignSelect\(select\)/);
  assert.match(selectsSource, /const CAMPAIGN_SERVICE_LOCK_OPTION_VALUES = new Set\(\['voice_software', 'business_software', 'ai_chatbots'\]\);/);
  assert.match(selectsSource, /function createCampaignServiceLockElement\(\)/);
  assert.match(selectsSource, /const isLockedServiceOption = select\.id === 'service' && CAMPAIGN_SERVICE_LOCK_OPTION_VALUES\.has\(optionValue\);/);
  assert.match(selectsSource, /if \(isLockedServiceOption && !option\.disabled\) option\.disabled = true;/);
  assert.match(selectsSource, /optionButton\.disabled = isLockedOption;/);
  assert.match(selectsSource, /optionButton\.setAttribute\('aria-disabled', String\(isLockedOption\)\);/);
  assert.match(selectsSource, /optionButton\.classList\.add\('select-option--locked', 'is-disabled'\);/);
  assert.match(selectsSource, /if \(!isLockedOption\) \{[\s\S]*?optionButton\.addEventListener\('click'/);
  assert.match(customSelectsCssSource, /\.select-option--locked \{[\s\S]*?display: flex;[\s\S]*?gap: 8px;/);
});

test('premium bevestigingsmails toont mailinteresse op coldmailing zonder leads-pagina te mengen', () => {
  const root = path.join(__dirname, '../..');
  const pageSource = fs.readFileSync(path.join(root, 'premium-bevestigingsmails.html'), 'utf8');
  const followUpsSource = fs.readFileSync(path.join(root, 'assets/premium-coldmail-followups.js'), 'utf8');

  assert.match(pageSource, /assets\/premium-coldmail-followups\.js\?v=20260511a/);
  assert.doesNotMatch(pageSource, /id="coldmailFollowUps"/);
  assert.match(followUpsSource, /coldmailFollowUps/);
  assert.match(followUpsSource, /coldmailFollowUpsCount/);
  assert.match(followUpsSource, /Mailinteresse/);
  assert.match(followUpsSource, /html\[data-softora-lead-generator-alias="1"\] \.coldmail-followups\{display:none!important\}/);
  assert.match(followUpsSource, /\/api\/coldmailing\/replies\/follow-ups\?limit=8/);
  assert.match(followUpsSource, /isLeadGeneratorAlias/);
  assert.doesNotMatch(followUpsSource, /\/premium-leads/);
  assert.doesNotMatch(followUpsSource, /\/api\/agenda\/interested-leads/);
  assert.doesNotMatch(followUpsSource, /\/api\/agenda\/confirmation-tasks/);
});

test('premium bevestigingsmails hides mail onderwerp row only on lead-generator alias', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="mail-subj-row"/);
  assert.match(
    pageSource,
    /html\[data-softora-lead-generator-alias="1"\] #mail-subj-row \{ display: none !important; \}/
  );
});

test('premium bevestigingsmails removes mail and ai-instructions tabs while keeping settings access', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /onclick="switchMail\(1,this\)">Mail 1<\/button>/);
  assert.doesNotMatch(pageSource, /onclick="switchMail\(4,this\)">AI Instructies<\/button>/);
  assert.match(pageSource, /<button class="mail-tab mail-icon-tab" type="button" onclick="toggleMailSettings\(this\)" aria-label="Instellingen">/);
  assert.match(pageSource, /<div class="mail-panel active" id="mail-panel-1">/);
  assert.match(pageSource, /function toggleMailSettings\(el\) \{/);
  assert.match(pageSource, /if \(settingsPanel && settingsPanel\.classList\.contains\('active'\)\) \{[\s\S]*switchMail\(1, null\);/);
  assert.match(pageSource, /if \(el\) el\.classList\.add\('active'\);/);
  assert.match(pageSource, /#body1 \{ height: clamp\(420px, 52vh, 520px\); \}/);
  assert.match(pageSource, /function ensureLeadGeneratorSettingsBackRow/);
  assert.match(pageSource, /function ensureLeadGeneratorSettingsBackRow\(\) \{\s*return;\s*\}/);
  assert.doesNotMatch(pageSource, /lead-gen-back-to-script/);
  assert.doesNotMatch(pageSource, /Terug naar script/);
});

test('premium bevestigingsmails places sender dropdown in the campaign card and compact settings behind the gear', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /Agendalimiet/);
  assert.doesNotMatch(pageSource, /campaign-full-workdays/);
  assert.doesNotMatch(pageSource, /Start campagne tot 10 werkdagen vol staan\./);
  assert.doesNotMatch(pageSource, /Afzender naam/);
  assert.doesNotMatch(pageSource, /Afzender e-mail/);
  assert.doesNotMatch(pageSource, /Antwoordadres/);
  assert.doesNotMatch(pageSource, /Telefoonnummer/);
  assert.doesNotMatch(pageSource, /Bedrijfsnaam/);
  assert.doesNotMatch(pageSource, /Domein \/ website/);
  assert.doesNotMatch(pageSource, /Handtekening/);
  assert.doesNotMatch(pageSource, /Deze gegevens kun je later gebruiken als vaste afzenderinformatie voor alle coldmails\./);
  assert.doesNotMatch(pageSource, /Kies hoelang deze campagne loopt en welke speciale handeling erbij hoort\./);

  assert.match(pageSource, /html\[data-softora-lead-generator-alias="1"\] \.lead-generator-hidden-setting \{ display: none !important; \}/);
  assert.match(pageSource, /<div class="field lead-generator-hidden-setting">\s*<div class="field-label">Verzenden vanaf<\/div>\s*<select class="sel" id="campaignSenderEmail" aria-label="Verzenden vanaf e-mailadres">/);
  assert.doesNotMatch(pageSource, /<option value="ruben@softora\.nl"/);
  assert.match(pageSource, /<option value="serve@softora\.nl" selected>serve@softora\.nl<\/option>/);
  assert.match(pageSource, /<option value="martijn@softora\.nl">martijn@softora\.nl<\/option>/);
  assert.match(pageSource, /<option value="servec321@gmail\.com">servec321@gmail\.com<\/option>/);
  assert.match(pageSource, /<option value="martijnven123@gmail\.com">martijnven123@gmail\.com<\/option>/);
  assert.doesNotMatch(pageSource, /<option value="info@softora\.nl"/);
  assert.doesNotMatch(pageSource, /<option value="zakelijk@softora\.nl"/);
  assert.doesNotMatch(pageSource, /zakelijk@theimpactbox\.co/);
  assert.match(pageSource, /const allowedSenderEmails = new Set\(\['serve@softora\.nl', 'martijn@softora\.nl', 'servecreusen@softora\.nl', 'martijnvandeven@softora\.nl', 'servec321@gmail\.com', 'martijnven123@gmail\.com', 'serve290@gmail\.com', 'servecreusen7@gmail\.com', 'contact\.venvisuals@gmail\.com'\]\);/);
  assert.match(pageSource, /allowedSenderEmails\.has\(String\(email \|\| ''\)\.toLowerCase\(\)\)/);
  assert.doesNotMatch(pageSource, /<div class="mf-label">Campagne afgerond na<\/div>/);
  assert.doesNotMatch(pageSource, /<select class="mf-sel" id="campaignDurationDays" aria-label="Campagneduur">/);
  assert.match(pageSource, /<div class="mf-row lead-generator-hidden-setting">\s*<div class="mf-label">Speciale handeling<\/div>\s*<select class="mf-sel" id="campaignSpecialAction" aria-label="Speciale handeling">/);
  assert.match(pageSource, /<option value="" selected>Geen<\/option>\s*<option value="webdesign">Webdesign<\/option>/);
  assert.match(pageSource, /<script src="assets\/premium-bevestigingsmails-mail-blocklist\.js\?v=20260506a"><\/script>/);
  assert.doesNotMatch(pageSource, /id="delay1"/);
  assert.doesNotMatch(pageSource, /Antwoord snelheid/);
});

test('premium bevestigingsmails toont plaats en website als zichtbare variabelen', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const locationVariablePath = path.join(__dirname, '../../assets/premium-bevestigingsmails-location-variable.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const locationVariableSource = fs.readFileSync(locationVariablePath, 'utf8');

  assert.match(pageSource, /<script src="assets\/premium-bevestigingsmails-location-variable\.js\?v=20260612a"><\/script>/);
  assert.match(locationVariableSource, /\.mail-variable-note\{[\s\S]*color:var\(--crimson\);[\s\S]*border:1px solid rgba\(155,35,85,\.18\);/);
  assert.match(locationVariableSource, /function normalizeBodyTemplate\(value\)/);
  assert.match(locationVariableSource, /📍\[ \\t\]\*\)Haaren/);
  assert.match(locationVariableSource, /note\.setAttribute\('aria-label', 'Dynamische klantgegevens en afzender uit systeem'\);/);
  assert.match(locationVariableSource, /document\.querySelector\('#mail-panel-5 \.mail-fields'\)/);
  assert.match(locationVariableSource, /host\.appendChild\(note\);/);
  assert.doesNotMatch(locationVariableSource, /insertAdjacentElement\('afterend', note\)/);
  assert.match(locationVariableSource, /variable\.textContent = '\{\{stad\}\}';/);
  assert.match(locationVariableSource, /websiteVariable\.textContent = '\{\{website\}\}';/);
  assert.match(locationVariableSource, /senderVariable\.textContent = '\{\{afzender\}\}';/);
  assert.doesNotMatch(locationVariableSource, /senderLocationVariable/);
  assert.match(locationVariableSource, /\$1\{\{afzender\}\}\$2\{\{stad\}\}/);
  assert.match(locationVariableSource, /label\.textContent = 'Klantgegevens en afzender uit systeem';/);
  assert.match(locationVariableSource, /wrapGlobalFunction\('applyColdmailingSettings'/);
  assert.match(locationVariableSource, /wrapGlobalFunction\('getColdmailCampaignPayload'/);
});

test('premium bevestigingsmails bewaart settings dropdowns via Supabase ui-state', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const senderSettingsPath = path.join(__dirname, '../../assets/premium-campaign-sender-settings.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const senderSettingsSource = fs.readFileSync(senderSettingsPath, 'utf8');

  assert.match(pageSource, /const COLDMAILING_SETTINGS_SCOPE = 'premium_coldmailing_settings';/);
  assert.match(pageSource, /const COLDMAILING_SETTINGS_KEY = 'softora_coldmailing_settings_v1';/);
  assert.match(pageSource, /const LEAD_GENERATOR_SETTINGS_SCOPE = 'premium_ai_lead_generator_settings';/);
  assert.match(pageSource, /const LEAD_GENERATOR_SETTINGS_KEY = 'softora_ai_lead_generator_settings_v1';/);
  assert.match(pageSource, /assets\/premium-campaign-sender-settings\.js\?v=20260612a/);
  assert.match(pageSource, /<select class="mf-sel" id="ai-tone-style">/);
  assert.match(senderSettingsSource, /"martijnven123@gmail\.com": DEFAULT_WEBDESIGN_BODY/);
  assert.match(senderSettingsSource, /"contact\.venvisuals@gmail\.com": DEFAULT_WEBDESIGN_BODY/);
  assert.match(senderSettingsSource, /Afgelopen week kwam ik jullie website \(\{\{website\}\}\) tegen\./);
  assert.match(senderSettingsSource, /Je kunt het webdesign hier bekijken 👈/);
  assert.match(senderSettingsSource, /\{\{afzender\}\}/);
  assert.match(senderSettingsSource, /📍 \{\{stad\}\}/);
  assert.doesNotMatch(senderSettingsSource, /📍 \{\{afzenderPlaats\}\}/);
  assert.match(pageSource, /function getCampaignSettingsScope\(\) \{\s*return isPremiumAiLeadGeneratorPath\(\) \? LEAD_GENERATOR_SETTINGS_SCOPE : COLDMAILING_SETTINGS_SCOPE;\s*\}/);
  assert.match(pageSource, /function getCampaignSettingsKey\(\) \{\s*return isPremiumAiLeadGeneratorPath\(\) \? LEAD_GENERATOR_SETTINGS_KEY : COLDMAILING_SETTINGS_KEY;\s*\}/);
  assert.match(pageSource, /function getColdmailingSettingsController\(\)/);
  assert.match(pageSource, /SoftoraCampaignSenderSettings\.createController/);
  assert.match(pageSource, /function collectColdmailingSettings\(\)/);
  assert.match(pageSource, /controller \? controller\.collectSettings\(\) : \{\}/);
  assert.match(pageSource, /function hydrateColdmailingSettingsFromSupabase\(\)/);
  assert.match(pageSource, /function bindColdmailingSettingsPersistence\(\)/);
  assert.match(pageSource, /controller\.hydrate\(\)/);
  assert.match(pageSource, /controller\.bind\(\)/);
  assert.match(pageSource, /async function initColdmailingSettingsPersistence\(\) \{[\s\S]*const hydrated = await controller\.init\(\);[\s\S]*if \(!hydrated\) markColdmailingSettingsUnavailable\(\);[\s\S]*return hydrated;/);
  assert.match(pageSource, /function markColdmailingSettingsUnavailable\(\)/);
  assert.match(pageSource, /field\.disabled = false;/);
  assert.match(pageSource, /field\.placeholder = '';/);
  assert.match(pageSource, /startButton\.disabled = false;/);
  assert.doesNotMatch(pageSource, /Instellingen konden niet worden geladen/);
  assert.doesNotMatch(pageSource, /Prompt & AI instructies konden niet veilig worden geladen\./);
  assert.doesNotMatch(pageSource, /field\.value = '';/);
  assert.match(senderSettingsSource, /const DEFAULT_SCOPE = "premium_coldmailing_settings";/);
  assert.match(senderSettingsSource, /const DEFAULT_KEY = "softora_coldmailing_settings_v1";/);
  assert.match(senderSettingsSource, /senders\[senderEmail\]/);
  assert.match(senderSettingsSource, /if \(!Object\.keys\(senders\)\.length && senderEmail/);
  assert.match(senderSettingsSource, /state\.settings\.senders\[activeSender\] = normalizeProfile\(rawSettings, readDocumentDefaults\(\)\);/);
  assert.match(senderSettingsSource, /state\.needsMigrationPersist = true;/);
  assert.match(senderSettingsSource, /await persistNow\(state\.activeSenderEmail \|\| getCurrentSenderEmail\(\)\)\.catch\(\(\) => null\);/);
  assert.match(senderSettingsSource, /function switchSenderProfile\(\)/);
  assert.match(senderSettingsSource, /function getPreferredSenderEmail\(\)/);
  assert.match(senderSettingsSource, /getPreferredSenderEmail\(\) \|\| state\.settings\.senderEmail/);
  assert.match(senderSettingsSource, /function resolveAuthenticatedSenderEmail\(session, availableEmails\)/);
  assert.match(senderSettingsSource, /\/api\/auth\/session/);
  assert.match(senderSettingsSource, /authenticatedPreferredSenderEmail/);
  assert.match(senderSettingsSource, /state\.settings = buildSettingsSnapshot\(previousSender\);/);
  assert.match(senderSettingsSource, /\["subj1", "body1", "ai-instructies", "ai-tone-style"\]/);
  assert.match(senderSettingsSource, /senderSelect\.addEventListener\("change", \(\) => \{ void switchSenderProfile\(\); \}\);/);
  assert.match(senderSettingsSource, /state\.hydrationFailed = true;/);
  assert.match(senderSettingsSource, /return hydrated;/);
  assert.match(senderSettingsSource, /loadProfileForSender/);
  assert.match(senderSettingsSource, /SoftoraCampaignSenderSettings/);
  assert.doesNotMatch(pageSource, /setSelectValueIfAvailable\(document\.getElementById\('campaignSpecialAction'\), normalized\.specialAction\)/);
  assert.match(
    pageSource,
    /initColdmailingMailboxOptions\(\)\s*\.then\(initColdmailingSettingsPersistence\)\s*\.catch\(initColdmailingSettingsPersistence\)\s*\.finally\(initCampaignSelects\)/
  );
});

test('premium bevestigingsmails exposes coldcalling provider choice inside lead-generator settings', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const blocklistPath = path.join(__dirname, '../../assets/premium-ai-lead-generator-call-blocklist.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const blocklistSource = fs.readFileSync(blocklistPath, 'utf8');

  assert.match(pageSource, /<div class="mf-row lead-generator-provider-setting">/);
  assert.match(pageSource, /<select class="mf-sel" id="coldcallingStack" aria-label="Coldcalling provider">/);
  assert.match(pageSource, /<option value="retell_ai" selected>Retell AI<\/option>/);
  assert.match(pageSource, /<option value="gemini_flash_3_1_live">Gemini 3\.1 Live<\/option>/);
  assert.match(pageSource, /<script src="assets\/premium-ai-lead-generator-call-blocklist\.js\?v=20260429a"><\/script>/);
  assert.match(blocklistSource, /const FIELD_ID = 'coldcallingBlocklist';/);
  assert.match(blocklistSource, /label\.textContent = 'Bloklijst';/);
  assert.match(blocklistSource, /textarea\.setAttribute\('aria-label', 'Telefoonnummers die nooit gebeld mogen worden'\);/);
  assert.match(blocklistSource, /Deze nummers worden nooit meegenomen in de AI-coldcalling belrij/);
  assert.match(blocklistSource, /settings\.callBlocklist = getBlocklistText\(\);/);
  assert.match(blocklistSource, /blockedPhones=' \+ encodeURIComponent\(blockedPhones\)/);
  assert.match(blocklistSource, /payload\.mode = 'call';/);
  assert.match(blocklistSource, /payload\.blockedPhones = getBlocklistText\(\);/);
  assert.match(
    pageSource,
    /html:not\(\[data-softora-lead-generator-alias="1"\]\) \.lead-generator-provider-setting \{ display: none !important; \}/
  );
  assert.match(pageSource, /function initLeadGeneratorProviderSetting\(\)/);
  assert.match(pageSource, /select\.value = normalizeColdcallingStack\(select\.value\);/);
  assert.match(
    pageSource,
    /initCampaignDurationSetting\(\);\s*initLeadGeneratorProviderSetting\(\);\s*initCampaignDatabaseAutoRefresh\(\);\s*initColdmailReplyAutoSync\(\);\s*const campaignBootTasks = \[[\s\S]*hydrateCampaignCompanyCountFromSupabase\(\),[\s\S]*initColdmailingMailboxOptions\(\)[\s\S]*\.finally\(initCampaignSelects\),[\s\S]*\];\s*Promise\.allSettled\(campaignBootTasks\)\.finally\(finishPremiumShellBoot\);/
  );
  assert.match(pageSource, /providerLabel \+ ' wordt klaargezet voor deze campagne/);
  assert.match(pageSource, /Provider: ' \+ getSelectedColdcallingStackLabel\(\) \+ '\.'/);
});

test('premium bevestigingsmails exposes mail blocklist in settings and sends it with campaign payload', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const blocklistPath = path.join(__dirname, '../../assets/premium-bevestigingsmails-mail-blocklist.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const blocklistSource = fs.readFileSync(blocklistPath, 'utf8');

  assert.match(pageSource, /<script src="assets\/premium-bevestigingsmails-mail-blocklist\.js\?v=20260506a"><\/script>/);
  assert.match(blocklistSource, /const FIELD_ID = 'coldmailingEmailBlocklist';/);
  assert.match(blocklistSource, /label\.textContent = 'Bloklijst';/);
  assert.match(blocklistSource, /textarea\.setAttribute\('aria-label', 'Mailadressen die nooit gemaild mogen worden'\);/);
  assert.match(blocklistSource, /Deze adressen worden nooit meegenomen in de coldmailcampagne/);
  assert.match(blocklistSource, /settings\.emailBlocklist = getBlocklistText\(\);/);
  assert.match(blocklistSource, /blockedEmails=' \+ encodeURIComponent\(blockedEmails\)/);
  assert.match(blocklistSource, /payload\.blockedEmails = getBlocklistText\(\);/);
  assert.match(blocklistSource, /specialActionRow\.insertAdjacentElement\('afterend', row\);/);
});

test('premium bevestigingsmails hides campaign duration dropdown but keeps timeline fallback', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /<div class="mf-label">Campagne afgerond na<\/div>/);
  assert.doesNotMatch(pageSource, /<select class="mf-sel" id="campaignDurationDays" aria-label="Campagneduur">/);
  assert.match(pageSource, /function initCampaignDurationSetting\(\)/);
  assert.doesNotMatch(pageSource, /function updateCampaignDurationUi\(\)/);
  assert.match(pageSource, /return normalizeCampaignDurationDays\(select \? select\.value : 14\);/);
  assert.match(pageSource, /showToast\(durationDays === 0 \? 'Campagne afronding uitgeschakeld' : 'Campagne afgerond na ' \+ formatCampaignDurationLabel\(durationDays\)\);/);
  assert.match(pageSource, /function buildCampaignTimeline\(total, durationDays\) \{/);
  assert.match(pageSource, /const timelineDays = resolveCampaignTimelineDays\(durationDays\);/);
  assert.match(pageSource, /const totalDurationDays = getCampaignTimelineTotalDays\(\);/);
  assert.match(pageSource, /campaignTimeline = buildCampaignTimeline\(actualTotal, durationDays\);/);
  assert.match(pageSource, /timelineTitle\.textContent = durationDays === 0 \? 'Tijdlijn voorbeeld' : durationLabel \+ ' tijdlijn';/);
  assert.match(pageSource, /`Dag \$\{step\.day\} van \$\{totalDurationDays\}`/);
  assert.match(pageSource, /'✓ Dag ' \+ totalDurationDays \+ ' bereikt — campagne afgelopen'/);
  assert.doesNotMatch(pageSource, /<select class="sel" id="branche"/);
  assert.doesNotMatch(pageSource, /<div class="field-label">Branche<\/div>\s*<select class="sel"/);
});

test('premium ai lead generator alias replaces branche with belmethode', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const selectsPath = path.join(__dirname, '../../assets/premium-campaign-selects.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const selectsSource = fs.readFileSync(selectsPath, 'utf8');

  assert.match(pageSource, /html\[data-softora-lead-generator-alias="1"\] \.lead-generator-branch-field \{ display: none !important; \}/);
  assert.match(pageSource, /html:not\(\[data-softora-lead-generator-alias="1"\]\) \.lead-generator-belmethod-field \{ display: none !important; \}/);
  assert.match(pageSource, /<div class="field lead-generator-belmethod-field">\s*<div class="field-label">Belmethode<\/div>\s*<select class="sel" id="callDispatchMode">/);
  assert.doesNotMatch(pageSource, /id="callDispatchMode" data-native-select="true"/);
  assert.match(pageSource, /assets\/premium-campaign-selects\.js\?v=20260511a/);
  assert.match(selectsSource, /document\.querySelectorAll\('select\.sel, select\.mf-sel'\)\.forEach\(enhanceCampaignSelect\);/);
  assert.match(pageSource, /<option value="sequential" selected>Apart<\/option>/);
  assert.match(pageSource, /<option value="parallel">Alles tegelijk<\/option>/);
});

test('premium ai lead generator uses calling copy and the on-page prompt for coldcalling start', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const callStartPath = path.join(__dirname, '../../assets/premium-ai-lead-generator-call-start.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const callStartSource = fs.readFileSync(callStartPath, 'utf8');

  assert.match(pageSource, /assets\/premium-risky-action-pin\.js\?v=20260512a/);
  assert.match(pageSource, /assets\/premium-ai-lead-generator-call-start\.js\?v=20260512a/);
  assert.match(pageSource, /SoftoraAiLeadGeneratorCallStart\.getBusyLabel\(isPremiumAiLeadGeneratorPath\(\)\)/);
  assert.match(pageSource, /SoftoraAiLeadGeneratorCallStart\.getButtonLabel\(isPremiumAiLeadGeneratorPath\(\)\)/);
  assert.match(callStartSource, /return isAlias \? 'Bedrijven bellen' : 'Mails Versturen'/);
  assert.match(callStartSource, /return isAlias \? 'Bellen\.\.\.' : 'Verzenden\.\.\.'/);
  assert.match(callStartSource, /function getCampaignPayload\(count\) \{/);
  assert.match(callStartSource, /extraInstructions: body \? body\.value : ''/);
  assert.match(callStartSource, /testMode: isTestModeEnabled\(\)/);
  assert.match(callStartSource, /function buildTestCallCampaignResult\(\)/);
  assert.match(callStartSource, /function requestCallStartConfirmPin\(\)/);
  assert.match(callStartSource, /SoftoraRiskyActionPin\.requestPin/);
  assert.match(callStartSource, /startConfirmPin:\s*String\(startConfirmPin \|\| ''\)\.trim\(\)/);
  assert.match(callStartSource, /typeof global\.SoftoraCampaignTestMode\.getTestPhone === 'function'/);
  assert.match(callStartSource, /phone: testPhone \|\| '0629917185'/);
  assert.match(callStartSource, /return postColdcallingStart\(getCampaignPayload\(1\), buildTestCallLeads\(\), startConfirmPin\);/);
  assert.match(callStartSource, /fetch\('\/api\/coldcalling\/start'/);
  assert.match(callStartSource, /const original = global\.startCampagneImmediate;/);
  assert.match(callStartSource, /showToast\(isTestModeEnabled\(\) \? 'Testmodus wordt gestart\.\.\.' : 'Bedrijven bellen wordt gestart\.\.\.'\);/);
  assert.match(pageSource, /\? Number\(sendResult\.sent\) : Number\(recipientPreview && \(recipientPreview\.candidates \?\? recipientPreview\.selected \?\? previewRecipients\.length\)\);/);
});

test('premium bevestigingsmails sends real coldmail campaigns without opening timeline page', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="start-campaign-btn"/);
  assert.match(pageSource, />\s*Mails Versturen\s*<\/button>/);
  assert.match(pageSource, /function getColdmailCampaignPayload\(startConfirmPin\)/);
  assert.match(pageSource, /subject: document\.getElementById\('subj1'\)/);
  assert.match(pageSource, /body: document\.getElementById\('body1'\)/);
  assert.match(pageSource, /aiInstructions: senderProfile && senderProfile\.aiInstructions/);
  assert.match(pageSource, /toneStyle: senderProfile && senderProfile\.toneStyle/);
  assert.match(pageSource, /fetch\('\/api\/coldmailing\/campaigns\/send'/);
  assert.doesNotMatch(pageSource, /SoftoraRiskyActionPin\.requestMailSendPin/);
  assert.match(pageSource, /startConfirmPin: String\(startConfirmPin \|\| ''\)\.trim\(\)/);
  assert.match(pageSource, /async function startCampagne\(verifiedMailSendPin\)/);
  assert.match(pageSource, /async function startCampagneImmediate\(verifiedMailSendPin\)/);
  assert.match(pageSource, /let startConfirmPin = String\(verifiedMailSendPin \|\| ''\)\.trim\(\);/);
  assert.match(pageSource, /window\.SoftoraSecureActionPin\.confirmMailSend/);
  assert.match(pageSource, /sendResult = await sendColdmailCampaignNow\(startConfirmPin\);/);
  assert.match(pageSource, /credentials: 'same-origin'/);
  assert.match(pageSource, /function buildSendErrorMessage\(defaultMessage\)/);
  assert.match(pageSource, /payload && Array\.isArray\(payload\.failedItems\) && payload\.failedItems\[0\]/);
  assert.match(pageSource, /if \(!payload\.sent && payload\.failed\) \{/);
  assert.match(pageSource, /assets\/premium-coldmail-send-copy\.js\?v=20260527a/);
  assert.doesNotMatch(pageSource, /function buildColdmailSendSuccessMessage\(sendResult\)/);
  assert.match(pageSource, /showToast\(buildColdmailSendSuccessMessage\(sendResult\)\);\s*if \(window\.SoftoraColdmailLiveStats && typeof window\.SoftoraColdmailLiveStats\.refresh === 'function'\) await window\.SoftoraColdmailLiveStats\.refresh\(\)\.catch/);
  assert.match(pageSource, /await hydrateCampaignCompanyCountFromSupabase\(\);\s*return;/);
  assert.match(pageSource, /showScreen\('screen-campaign'\);/);
});

test('premium bevestigingsmails exposes a coldmail autopilot toggle with safe batch defaults', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const autopilotPath = path.join(__dirname, '../../assets/premium-coldmail-autopilot.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const autopilotSource = fs.readFileSync(autopilotPath, 'utf8');

  assert.match(pageSource, /assets\/premium-coldmail-autopilot\.js\?v=20260611a/);
  assert.match(autopilotSource, /const BATCH_SIZE = 1;/);
  assert.match(autopilotSource, /"campaignSenderEmail"/);
  assert.match(autopilotSource, /"start-campaign-btn"/);
  assert.match(autopilotSource, /data-coldmail-autopilot-enabled/);
  assert.match(autopilotSource, /startButton\.insertAdjacentElement\("afterend", row\)/);
  assert.match(autopilotSource, /coldmail-autopilot-today-card/);
  assert.match(autopilotSource, /Vandaag verstuurd/);
  assert.match(autopilotSource, /state\.todaySends/);
  assert.match(autopilotSource, /coldmailAutopilotTodayProgress/);
  assert.match(autopilotSource, /let statusLoaded = false;/);
  assert.match(autopilotSource, /let statusUnavailable = false;/);
  assert.match(autopilotSource, /coldmail-autopilot-toggle is-loading/);
  assert.match(autopilotSource, /aria-busy="true" data-autopilot-scope="team" disabled/);
  assert.match(autopilotSource, /Team autopilot controleren/);
  assert.match(autopilotSource, /const loading = !statusLoaded && !statusUnavailable;/);
  assert.match(autopilotSource, /if \(statusLoaded\) notifyAutopilotStatus\(state\)/);
  assert.match(autopilotSource, /statusUnavailable = !statusLoaded;/);
  assert.match(autopilotSource, /if \(busy \|\| !statusLoaded \|\| statusUnavailable\) return;/);
  assert.match(autopilotSource, /render\(\);\s*void refresh\(\);/);
  assert.doesNotMatch(autopilotSource, /coldmailAutopilotToggleLabel">Team autopilot uit/);
  assert.match(autopilotSource, /Team-autopilot staat aan voor iedereen van Softora\. Instellingen zijn bevroren\./);
  assert.match(autopilotSource, /Team autopilot aan/);
  assert.match(autopilotSource, /data-coldmail-autopilot-scope/);
  assert.match(autopilotSource, /global\.addEventListener\("focus", refresh\)/);
  assert.match(autopilotSource, /softora:coldmail-autopilot-status/);
  assert.match(autopilotSource, /dispatchEvent\(new CustomEvent\(AUTOPILOT_STATUS_EVENT/);
  assert.match(autopilotSource, /notifyAutopilotStatus\(state\)/);
  assert.match(autopilotSource, /\/api\/coldmailing\/autopilot\/status/);
  assert.match(autopilotSource, /\/api\/coldmailing\/autopilot\/settings/);
  assert.match(autopilotSource, /const senderEmails = getSenderEmails\(\)/);
  assert.match(autopilotSource, /senderProfiles: buildSenderProfiles\(payload, senderEmails\)/);
  assert.match(autopilotSource, /function getStoredSenderProfiles\(\)/);
  assert.match(autopilotSource, /controller\.collectSettings\(\)/);
  assert.match(autopilotSource, /function ensureLocationLine\(value\)/);
  assert.match(autopilotSource, /📍 \{\{stad\}\}/);
  assert.match(autopilotSource, /const storedProfile = storedProfiles\[email\]/);
  assert.match(autopilotSource, /if \(enabled\) \{/);
  assert.match(autopilotSource, /startHour: 7/);
  assert.match(autopilotSource, /endHour: 17/);
  assert.match(autopilotSource, /minIntervalMinutes: 5/);
  assert.match(autopilotSource, /senderMinIntervalMinutes: 60/);
  assert.match(autopilotSource, /senderMaxIntervalMinutes: 74/);
  assert.match(autopilotSource, /sendJitterMinSeconds: 45/);
  assert.match(autopilotSource, /sendJitterMaxSeconds: 240/);
  assert.doesNotMatch(autopilotSource, /Handmatige modus/);
  assert.doesNotMatch(autopilotSource, /Geen automatische verzending/);
  assert.doesNotMatch(autopilotSource, /parentNode\.insertBefore\(row, startButton\)/);
  assert.doesNotMatch(autopilotSource, /agenda_full_10_workdays/);
});

test('premium bevestigingsmails houdt succesvolle verzendmelding kort als extra kandidaten geen klaar webdesign hebben', () => {
  const assetPath = path.join(__dirname, '../../assets/premium-coldmail-send-copy.js');
  const assetSource = fs.readFileSync(assetPath, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(assetSource, context);

  const message = context.window.SoftoraColdmailSendCopy.buildColdmailSendSuccessMessage({
    sent: 1,
    failed: 107,
    failedItems: Array.from({ length: 107 }, () => ({
      error: 'Nog geen website-design klaar voor dit bedrijf.',
    })),
  });

  assert.equal(message, '✓ 1 mail verstuurd');
  assert.doesNotMatch(message, /107 overgeslagen/);
  assert.doesNotMatch(message, /107 mislukt/);
});

test('premium campaign test mode keeps mail copy and switches to call copy on the lead-generator alias', () => {
  const testModePath = path.join(__dirname, '../../assets/premium-campaign-test-mode.js');
  const testModeSource = fs.readFileSync(testModePath, 'utf8');

  assert.match(testModeSource, /document\.documentElement\.getAttribute\('data-softora-lead-generator-alias'\) === '1'/);
  assert.match(testModeSource, /const TEST_CALL_PHONE = '0629917185';/);
  assert.match(testModeSource, /shortLabel: 'Testmodus aan: testoproep naar ' \+ TEST_CALL_PHONE/);
  assert.match(testModeSource, /toast: 'Testmodus aan: testoproep gaat naar ' \+ TEST_CALL_PHONE \+ '\.'/);
  assert.match(testModeSource, /shortLabel: 'Testmodus aan: alleen naar ' \+ TEST_RECIPIENT_LABEL/);
  assert.match(testModeSource, /toast: 'Testmodus aan: verzending gaat alleen naar ' \+ TEST_RECIPIENT_LABEL \+ '\.'/);
  assert.doesNotMatch(testModeSource, /verzending gaat alleen naar '\s*\+\s*TEST_CALL_PHONE/);
  assert.doesNotMatch(testModeSource, /testoproep naar '\s*\+\s*TEST_RECIPIENT_EMAIL/);
});

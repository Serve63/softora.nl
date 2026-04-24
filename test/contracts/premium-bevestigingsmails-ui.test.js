const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium bevestigingsmails renders the current coldmailing dashboard shell without coldcalling bootstrap', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /<script[^>]+src=["']assets\/coldcalling-dashboard\.js[^"']*["'][^>]*>/);
  assert.match(
    pageSource,
    /<a href="\/premium-bevestigingsmails" class="sidebar-link magnetic active" data-sidebar-key="coldmailing"/
  );
  assert.match(pageSource, /<div class="page-section-inner">/);
  assert.doesNotMatch(pageSource, /<div class="zones-row">/);
  assert.doesNotMatch(pageSource, /id="z1-count"/);
  assert.doesNotMatch(pageSource, /id="z2-count"/);
  assert.doesNotMatch(pageSource, /id="z4-count"/);
  assert.doesNotMatch(pageSource, /id="z5-count"/);
  assert.doesNotMatch(pageSource, /id="conv-zone-pct"/);
  assert.match(pageSource, /<div class="card-title">Prompt & AI instructies<\/div>/);
  assert.match(pageSource, /<div class="campagne-title">Nieuwe Campagne<\/div>/);
  assert.match(pageSource, /<button class="btn-start" id="start-campaign-btn" onclick="startCampagne\(\)">/);
  assert.doesNotMatch(pageSource, /<!-- SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP -->/);
});

test('premium bevestigingsmails toont een aparte AI beheer pagina wanneer de modus op software staat', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const managementPath = path.join(__dirname, '../../assets/premium-bevestigingsmails-management.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const managementSource = fs.readFileSync(managementPath, 'utf8');

  assert.match(pageSource, /document\.documentElement\.setAttribute\("data-ai-management-mode", aiManagementMode\);/);
  assert.match(pageSource, /<script src="assets\/ai-management-mode\.js\?v=20260423a" defer><\/script>/);
  assert.match(pageSource, /id="screen-ai-management"/);
  assert.match(pageSource, /AI bepaalt zelf of coldmailing nu nodig is/);
  assert.match(pageSource, /AI is momenteel hier niet mee bezig\./);
  assert.match(pageSource, /html\[data-ai-management-mode="software"\] #screen-dashboard,/);
  assert.match(pageSource, /html\[data-ai-management-mode="software"\] #screen-ai-management \{ display: block !important; \}/);
  assert.match(pageSource, /<script src="assets\/premium-bevestigingsmails-management\.js\?v=20260423a" defer><\/script>/);
  assert.match(managementSource, /AI is momenteel hier niet mee bezig\./);
  assert.match(managementSource, /AI is hier actief bezig met coldmailing\./);
  assert.match(managementSource, /window\.addEventListener\('softora-ai-management-change', updateAiColdmailingWorkspace\);/);
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
    /function startCampagne\(\) \{[\s\S]*?isPremiumAiLeadGeneratorPath\(\)[\s\S]*?startCampagneWithLeadGeneratorBoot/
  );
});

test('premium bevestigingsmails campaign volume uses a fixed mail company label', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /field-label-nav/);
  assert.doesNotMatch(pageSource, /cycleCampaignCountMode/);
  assert.doesNotMatch(pageSource, /campaign-count-mode-label/);
  assert.doesNotMatch(pageSource, /Hoeveel afspraken inplannen\?/);
  assert.match(pageSource, /Hoeveel bedrijven mailen\?/);
  assert.doesNotMatch(pageSource, /Aantal te mailen bedrijven/);
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
  assert.match(pageSource, /<button class="mail-tab mail-icon-tab" type="button" onclick="switchMail\(5,this\)" aria-label="Instellingen">/);
  assert.match(pageSource, /<div class="mail-panel active" id="mail-panel-1">/);
  assert.match(pageSource, /function ensureLeadGeneratorSettingsBackRow/);
});

test('premium bevestigingsmails replaces sender detail fields with compact dropdown settings', () => {
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

  assert.match(pageSource, /<select class="mf-sel" id="campaignSenderEmail" aria-label="Verzenden vanaf e-mailadres">/);
  assert.match(pageSource, /<option value="info@softora\.nl" selected>info@softora\.nl<\/option>/);
  assert.match(pageSource, /<select class="mf-sel" id="campaignSpecialAction" aria-label="Speciale handeling">/);
  assert.match(pageSource, /<option value="webdesign" selected>Webdesign<\/option>/);
  assert.doesNotMatch(pageSource, /id="delay1"/);
  assert.doesNotMatch(pageSource, /Antwoord snelheid/);
});

test('premium bevestigingsmails exposes coldcalling provider choice inside lead-generator settings', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<div class="mf-row lead-generator-provider-setting">/);
  assert.match(pageSource, /<select class="mf-sel" id="coldcallingStack" aria-label="Coldcalling provider">/);
  assert.match(pageSource, /<option value="retell_ai" selected>Retell AI<\/option>/);
  assert.match(pageSource, /<option value="gemini_flash_3_1_live">Gemini 3\.1 Live<\/option>/);
  assert.match(
    pageSource,
    /html:not\(\[data-softora-lead-generator-alias="1"\]\) \.lead-generator-provider-setting \{ display: none !important; \}/
  );
  assert.match(pageSource, /function initLeadGeneratorProviderSetting\(\)/);
  assert.match(pageSource, /select\.value = normalizeColdcallingStack\(select\.value\);/);
  assert.match(
    pageSource,
    /initCampaignDurationSetting\(\);\s*initLeadGeneratorProviderSetting\(\);\s*initColdmailingMailboxOptions\(\)\.finally\(initCampaignSelects\);/
  );
  assert.match(pageSource, /providerLabel \+ ' wordt klaargezet voor deze campagne/);
  assert.match(pageSource, /Provider: ' \+ getSelectedColdcallingStackLabel\(\) \+ '\.'/);
});

test('premium bevestigingsmails exposes campaign duration choices and uses them in the timeline copy', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<select class="mf-sel" id="campaignDurationDays" aria-label="Campagneduur">/);
  assert.match(pageSource, /<option value="5">5 dagen<\/option>/);
  assert.match(pageSource, /<option value="7">7 dagen<\/option>/);
  assert.match(pageSource, /<option value="14" selected>14 dagen<\/option>/);
  assert.match(pageSource, /function initCampaignDurationSetting\(\)/);
  assert.doesNotMatch(pageSource, /function updateCampaignDurationUi\(\)/);
  assert.match(pageSource, /showToast\('Campagne afgerond na ' \+ formatCampaignDurationLabel\(durationDays\)\);/);
  assert.match(pageSource, /function buildCampaignTimeline\(total, durationDays\) \{/);
  assert.match(pageSource, /const timelineDays = resolveCampaignTimelineDays\(durationDays\);/);
  assert.match(pageSource, /const totalDurationDays = getCampaignTimelineTotalDays\(\);/);
  assert.match(pageSource, /campaignTimeline = buildCampaignTimeline\(actualTotal, durationDays\);/);
  assert.match(pageSource, /timelineTitle\.textContent = durationLabel \+ ' tijdlijn';/);
  assert.match(pageSource, /`Dag \$\{step\.day\} van \$\{totalDurationDays\}`/);
  assert.match(pageSource, /'✓ Dag ' \+ totalDurationDays \+ ' bereikt — campagne afgelopen'/);
});

test('premium bevestigingsmails keeps the branche filter as the native belmethode-style select', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<select class="sel" id="branche" data-native-select="true">/);
  assert.match(pageSource, /if \(String\(select\.dataset\.nativeSelect \|\| ''\)\.trim\(\) === 'true'\) return;/);
});

test('premium bevestigingsmails sends real coldmail campaigns through the backend before showing timeline', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="start-campaign-btn"/);
  assert.match(pageSource, />\s*Mails Versturen\s*<\/button>/);
  assert.match(pageSource, /function getColdmailCampaignPayload\(\)/);
  assert.match(pageSource, /subject: document\.getElementById\('subj1'\)/);
  assert.match(pageSource, /body: document\.getElementById\('body1'\)/);
  assert.match(pageSource, /fetch\('\/api\/coldmailing\/campaigns\/send'/);
  assert.match(pageSource, /credentials: 'same-origin'/);
  assert.match(pageSource, /sendResult = await sendColdmailCampaignNow\(\);/);
  assert.match(pageSource, /bedrijven = sendResult\.sentItems\.map/);
});

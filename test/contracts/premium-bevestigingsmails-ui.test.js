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
  assert.match(pageSource, /<div class="zones-row">/);
  assert.match(pageSource, /id="z1-count"/);
  assert.match(pageSource, /id="z2-count"/);
  assert.match(pageSource, /id="z4-count"/);
  assert.match(pageSource, /id="z5-count"/);
  assert.match(pageSource, /id="conv-zone-pct"/);
  assert.match(pageSource, /<div class="card-title">Prompt & AI instructies<\/div>/);
  assert.match(pageSource, /<div class="campagne-title">Nieuwe Campagne<\/div>/);
  assert.match(pageSource, /<button class="btn-start" onclick="startCampagne\(\)">/);
  assert.doesNotMatch(pageSource, /<!-- SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP -->/);
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

test('premium bevestigingsmails keeps the zone cards above the dashboard grid', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /\.zones-row \{ display: grid;[\s\S]*gap: 12px;/);
  assert.match(pageSource, /\.bottom-grid \{ display: grid; grid-template-columns: 1fr 360px; gap: 20px;/);
  assert.match(pageSource, /<div class="zones-row">[\s\S]*<\/div>\s*<div style="padding-top:20px" class="bottom-grid">/);
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

test('premium bevestigingsmails campaign volume label toggles mail vs appointments with arrow controls', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="campaign-count-mode-label"/);
  assert.match(pageSource, /function cycleCampaignCountMode/);
  assert.match(pageSource, /Hoeveel bedrijven mailen\?/);
  assert.match(pageSource, /Hoeveel afspraken inplannen\?/);
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

test('premium bevestigingsmails hides mail 1 and ai instructies tabs on lead-generator alias', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(
    pageSource,
    /html\[data-softora-lead-generator-alias="1"\] \.mail-tab-group > \.mail-tab:not\(\.mail-icon-tab\) \{ display: none !important; \}/
  );
  assert.match(pageSource, /function ensureLeadGeneratorSettingsBackRow/);
});

test('premium bevestigingsmails keeps the 10-workdays campaign toggle inside instellingen instead of mail 1', () => {
  const pagePath = path.join(__dirname, '../../premium-bevestigingsmails.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(
    pageSource,
    /<div class="mail-panel active" id="mail-panel-1">[\s\S]*campaign-full-workdays[\s\S]*<!-- AI INSTRUCTIES -->/
  );
  assert.match(
    pageSource,
    /<div class="mail-panel" id="mail-panel-5">[\s\S]*<div class="mf-label">Agendalimiet<\/div>[\s\S]*<input type="checkbox" id="campaign-full-workdays">[\s\S]*Start campagne tot 10 werkdagen vol staan\./
  );
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
  assert.doesNotMatch(pageSource, /localStorage/);
  assert.match(
    pageSource,
    /initCampaignDurationSetting\(\);\s*initLeadGeneratorProviderSetting\(\);\s*initCampaignSelects\(\);/
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
  assert.match(pageSource, /campaignTimeline = buildCampaignTimeline\(n, durationDays\);/);
  assert.match(pageSource, /timelineTitle\.textContent = durationLabel \+ ' tijdlijn';/);
  assert.match(pageSource, /`Dag \$\{step\.day\} van \$\{totalDurationDays\}`/);
  assert.match(pageSource, /'✓ Dag ' \+ totalDurationDays \+ ' bereikt — campagne afgelopen'/);
});

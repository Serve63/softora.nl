const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium ai lead generator renders campaign controls before dashboard bootstrap runs', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-lead-generator.html');
  const dashboardPath = path.join(__dirname, '../../assets/coldcalling-dashboard.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(pageSource, /<div class="form-group form-group--lead-list" id="leadListControlWrap">/);
  assert.match(pageSource, /<script src="assets\/coldcalling-dashboard\.js\?v=20260410i" defer><\/script>/);
  assert.match(
    pageSource,
    /<button type="button" class="form-input magnetic" id="openLeadListModalBtn" onclick="window\.openLeadDatabaseModalFromCampaign && window\.openLeadDatabaseModalFromCampaign\(\)"/
  );
  assert.match(pageSource, /<div class="form-group form-group--dispatch" id="callDispatchControlWrap">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="callDispatchMode">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="regio" data-force-change-value="custom">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="statusPill" data-select-variant="pill" data-dot-color="accent" aria-label="Business modus">/);
  assert.match(pageSource, /<option value="websites" data-dot-color="accent" selected>Website's<\/option>/);
  assert.match(pageSource, /<option value="voice_software" data-dot-color="green" disabled>🔒 Voicesoftware<\/option>/);
  assert.match(pageSource, /<option value="business_software" data-dot-color="blue" disabled>🔒 Bedrijfssoftware<\/option>/);
  assert.match(pageSource, /<option value="unlimited" selected>Geen limiet<\/option>/);
  assert.match(pageSource, /<option value="custom">Aangepast<\/option>/);
  assert.match(pageSource, /window\.openSiteInputDialog = openSiteInputDialog;/);
  assert.match(pageSource, /\.topbar-right \.site-select--pill\[data-dot-color="accent"\] \.site-select-trigger::before \{[\s\S]*background:\s*var\(--accent-light\);/);
  assert.match(pageSource, /\.topbar-right \.site-select--pill\[data-dot-color="blue"\] \.site-select-trigger::before \{[\s\S]*background:\s*#2563eb;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--lead-list\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--dispatch\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*4;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--branche\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--regio\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*4;/);
  assert.match(dashboardSource, /let controlWrap = byId\('leadListControlWrap'\);[\s\S]*if \(!controlWrap\)/);
  assert.match(dashboardSource, /let dispatchWrap = byId\('callDispatchControlWrap'\);[\s\S]*if \(!dispatchWrap\)/);
  assert.match(
    dashboardSource,
    /<th[\s\S]*>Bedrijf<\/th>[\s\S]*<th[\s\S]*>Adres<\/th>[\s\S]*<th[\s\S]*>Telefoonnummer<\/th>[\s\S]*<th[\s\S]*>Website<\/th>/
  );
  assert.doesNotMatch(dashboardSource, /Contactpersoon|Webiste/);
  assert.match(
    dashboardSource,
    /function promptForManualLeadDetails\(defaults = \{\}\) \{[\s\S]*Lead handmatig toevoegen[\s\S]*Bedrijf[\s\S]*Adres[\s\S]*Telefoonnummer[\s\S]*Website/
  );
  assert.doesNotMatch(dashboardSource, /Voer telefoonnummer in \(NL formaat, bijv\. 0612345678 of \+31612345678\)\./);
  assert.doesNotMatch(dashboardSource, /Geen handmatige lead toegevoegd\./);
  assert.match(dashboardSource, /statusEl\.style\.margin = '14px 0 18px';/);
  assert.match(dashboardSource, /\/api\/coldcalling\/call-detail\?callId=\$\{encodeURIComponent\(normalizedCallId\)\}/);
  assert.match(dashboardSource, /function prewarmLeadDatabase\(options = \{\}\) \{/);
  assert.match(dashboardSource, /if \(!hasLeadDatabaseSnapshot\(\)\) \{\s*await prewarmLeadDatabase\(\);/);
  assert.match(dashboardSource, /void leadDatabaseModal\.prewarmLeadDatabase\(\);/);
  assert.match(dashboardSource, /function prewarmLeadDatabaseCallDetails\(limit = 1\) \{/);
  assert.match(dashboardSource, /prewarmLeadDatabaseCallDetails\(1\);/);
  assert.match(dashboardSource, /looksLikeDirectSpeechConversationSummary/);
  assert.match(dashboardSource, /Eindig altijd met een volledige zin en nooit met ellips of afgebroken tekst/);
  assert.match(dashboardSource, /const SHARED_CALL_SUMMARY_CACHE_STORAGE_KEY = 'softora_shared_call_summary_cache_v5';/);
  assert.match(dashboardSource, /Samenvatting wordt opgesteld op basis van de transcriptie\./);
  assert.match(dashboardSource, /family=Barlow\+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600/);
  assert.match(dashboardSource, /<div class="lead-db-toolbar">[\s\S]*leadDatabaseRefreshInfo[\s\S]*leadDatabaseTemplateBtn[\s\S]*leadDatabaseAddManualBtn[\s\S]*leadDatabaseImportBtn/);
  assert.match(dashboardSource, /<div id="leadDatabaseSummaryCards" class="lead-db-stats"><\/div>/);
  assert.match(dashboardSource, /class="lead-db-table-card"/);
  assert.doesNotMatch(dashboardSource, /<div class="lead-db-logo">Softora\.nl<\/div>/);
  assert.doesNotMatch(dashboardSource, /<div class="lead-db-footer">Softora\.nl<\/div>/);
  assert.doesNotMatch(dashboardSource, /id="leadDatabaseRefreshBtn"/);
  assert.doesNotMatch(dashboardSource, /id="leadDatabaseFilterPills"/);
  assert.match(
    dashboardSource,
    /function buildLeadDatabaseCallSummarySourceText\(call, insight, interestedLead, remoteDetail = null\) \{[\s\S]*remoteDetail\?\.transcript[\s\S]*call\?\.transcriptFull[\s\S]*remoteDetail\?\.summary[\s\S]*call\?\.summary[\s\S]*insight\?\.summary[\s\S]*interestedLead\?\.summary/
  );
  assert.doesNotMatch(
    dashboardSource,
    /function buildLeadDatabaseCallSummarySourceText\(call, insight, interestedLead\) \{[\s\S]*insight\?\.followUpReason[\s\S]*interestedLead\?\.whatsappInfo/
  );
  assert.match(dashboardSource, /bevestigingsmail sturen/);
  assert.match(dashboardSource, /function openLeadDatabaseFromCampaignControl\(\) \{[\s\S]*ensureLeadDatabaseModal\(\)[\s\S]*dbModal\.openLeadDatabaseModal\(\);/);
  assert.match(dashboardSource, /function bindLeadDatabaseOpenControl\(\) \{[\s\S]*window\.openLeadDatabaseModalFromCampaign = openLeadDatabaseFromCampaignControl;[\s\S]*button\.dataset\.dbOpenBound !== '1'/);
  assert.match(dashboardSource, /bindLeadDatabaseOpenControl\(\);\s*void bootstrapColdcallingUi\(\);/);
  assert.match(dashboardSource, /const CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY = 'softora_campaign_regio_custom_km';/);
  assert.match(dashboardSource, /const DEFAULT_CAMPAIGN_REGIO_VALUE = 'unlimited';/);
  assert.match(dashboardSource, /function formatCampaignCustomRegioLabel\(km\) \{/);
  assert.match(dashboardSource, /async function promptForCustomCampaignRegioKm\(initialValue = ''\) \{/);
  assert.match(dashboardSource, /savedRegio === CUSTOM_CAMPAIGN_REGIO_VALUE[\s\S]*applyCampaignRegioSelection\(regioEl, CUSTOM_CAMPAIGN_REGIO_VALUE, savedCustomRegioKm\);/);
  assert.match(dashboardSource, /if \(selectedValue === CUSTOM_CAMPAIGN_REGIO_VALUE\) \{[\s\S]*const customKm = await promptForCustomCampaignRegioKm\(initialCustomKm\);/);
  assert.match(pageSource, /const activeDotColor = String\([\s\S]*selectedOption\?\.dataset\?\.dotColor[\s\S]*wrapper\.dataset\.dotColor = activeDotColor;/);
});

test('premium ai lead generator persists dashboard config and stats through Supabase-only flows', () => {
  const dashboardPath = path.join(__dirname, '../../assets/coldcalling-dashboard.js');
  const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(dashboardSource, /const BUSINESS_MODE_STORAGE_KEY = 'softora_business_mode';/);
  assert.match(dashboardSource, /const REMOTE_UI_STATE_SCOPE_PREFERENCES = 'coldcalling_preferences';/);
  assert.match(dashboardSource, /async function loadSavedStatusPillModeFromSupabase\(\) \{[\s\S]*fetchUiStateGetWithFallback\(REMOTE_UI_STATE_SCOPE_PREFERENCES\)[\s\S]*source !== 'supabase'/);
  assert.match(dashboardSource, /async function persistStatusPillModeToSupabase\(mode\) \{[\s\S]*fetchUiStateSetWithFallback\(REMOTE_UI_STATE_SCOPE_PREFERENCES[\s\S]*source !== 'supabase'/);
  assert.match(dashboardSource, /if \(patchKeys\.length === 0\) \{[\s\S]*remoteUiStateLastSource === 'supabase'[\s\S]*Dashboardconfiguratie is nog niet vanuit Supabase geladen\./);
  assert.match(dashboardSource, /async function resetStatsRowToZero\(\) \{[\s\S]*setStatsResetBaselineState\(latestStatsSummary\)[\s\S]*const saveResult = await persistRemoteUiStateNow\(\)[\s\S]*Dashboard-reset is opgeslagen in Supabase\./);
  assert.match(dashboardSource, /button\.addEventListener\('click', async \(event\) => \{[\s\S]*await resetStatsRowToZero\(\);/);
  assert.match(dashboardSource, /function buildDashboardStatsSummaryFromPersistedSources\(data\) \{/);
  assert.match(dashboardSource, /if \(!dashboardStatsPollTimer\) \{[\s\S]*refreshDashboardStatsFromSupabase\(\{ silent: true \}\)[\s\S]*12000/);
  assert.match(dashboardSource, /const stateSaveResult = await persistRemoteUiStateNow\(\);[\s\S]*Dashboardconfiguratie staat nog niet veilig in Supabase\./);
  assert.match(dashboardSource, /async function bootstrapColdcallingUi\(\) \{[\s\S]*activeBusinessMode = await loadSavedStatusPillModeFromSupabase\(\);[\s\S]*const uiStateLoaded = await loadRemoteUiState\(\);[\s\S]*remoteUiStateLastSource !== 'supabase'[\s\S]*Dashboardconfiguratie kon niet uit Supabase geladen worden\./);
});

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
  assert.match(pageSource, /<!-- SOFTORA_COLDCALLING_DASHBOARD_BOOTSTRAP -->/);
  assert.match(pageSource, /<script src="assets\/coldcalling-dashboard\.js\?v=20260416c" defer><\/script>/);
  assert.match(pageSource, /id="statCalled"><!-- SOFTORA_COLDCALLING_STAT_CALLED --><\/div>/);
  assert.match(pageSource, /id="statBooked"[\s\S]*<!-- SOFTORA_COLDCALLING_STAT_BOOKED --><\/div>/);
  assert.match(pageSource, /id="statInterested"[\s\S]*<!-- SOFTORA_COLDCALLING_STAT_INTERESTED --><\/div>/);
  assert.match(pageSource, /id="statConversion"><!-- SOFTORA_COLDCALLING_STAT_CONVERSION --><\/div>/);
  assert.match(
    pageSource,
    /<button type="button" class="form-input magnetic" id="openLeadListModalBtn" onclick="window\.openLeadDatabaseModalFromCampaign && window\.openLeadDatabaseModalFromCampaign\(\)"/
  );
  assert.match(pageSource, /<div class="form-group form-group--dispatch" id="callDispatchControlWrap">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="callDispatchMode">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="regio">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="statusPill" data-select-variant="pill" data-dot-color="accent" aria-label="Business modus">/);
  assert.match(pageSource, /<option value="websites" data-dot-color="accent" selected>Website's<\/option>/);
  assert.match(pageSource, /<option value="voice_software" data-dot-color="green" disabled>🔒 Voicesoftware<\/option>/);
  assert.match(pageSource, /<option value="business_software" data-dot-color="blue" disabled>🔒 Bedrijfssoftware<\/option>/);
  assert.match(pageSource, /<option value="ai_chatbots" data-dot-color="accent" disabled>🔒 AI Chatbots<\/option>/);
  assert.match(pageSource, /<option value="unlimited" selected>Geen limiet<\/option>/);
  assert.doesNotMatch(pageSource, /<option value="custom">Aangepast<\/option>/);
  assert.match(
    pageSource,
    /<div class="slider-labels">\s*<span data-slider-label-value="1">1<\/span>\s*<span data-slider-label-value="50">50<\/span>\s*<span data-slider-label-value="100">100<\/span>\s*<span data-slider-label-value="150">150<\/span>\s*<span data-slider-label-value="200">200<\/span>\s*<span class="slider-label-infinity" data-slider-label-value="250">&infin;<\/span>\s*<\/div>/
  );
  assert.match(pageSource, /window\.openSiteInputDialog = openSiteInputDialog;/);
  assert.match(pageSource, /\.slider-labels\s*\{[\s\S]*position:\s*relative;[\s\S]*height:\s*1\.4rem;/);
  assert.match(pageSource, /\.slider-labels span\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*var\(--slider-label-position, 0%\);[\s\S]*transform:\s*translateX\(-50%\);/);
  assert.match(pageSource, /\.slider-labels span:last-child\s*\{[\s\S]*left:\s*100%;[\s\S]*transform:\s*translateX\(-100%\);/);
  assert.match(pageSource, /\.topbar-right \.site-select--pill\[data-dot-color="accent"\] \.site-select-trigger::before \{[\s\S]*background:\s*var\(--accent-light\);/);
  assert.match(pageSource, /\.topbar-right \.site-select--pill\[data-dot-color="blue"\] \.site-select-trigger::before \{[\s\S]*background:\s*#2563eb;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--lead-list\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--dispatch\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*4;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--branche\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--regio\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*4;/);
  assert.match(dashboardSource, /let controlWrap = byId\('leadListControlWrap'\);[\s\S]*if \(!controlWrap\)/);
  assert.match(dashboardSource, /let dispatchWrap = byId\('callDispatchControlWrap'\);[\s\S]*if \(!dispatchWrap\)/);
  assert.match(dashboardSource, /let coldcallingDashboardBootstrapPayload = null;/);
  assert.match(dashboardSource, /function readColdcallingDashboardBootstrapPayload\(\) \{[\s\S]*softoraColdcallingDashboardBootstrap/);
  assert.match(dashboardSource, /function primeStatsFromBootstrap\(\) \{/);
  assert.match(dashboardSource, /if \(statsResetBaseline\) \{\s*setStatsResetBaselineState\(statsResetBaseline\);\s*\}/);
  assert.match(dashboardSource, /primeStatsFromBootstrap\(\);\s*setStatusPill\('idle', ''\);\s*setStatusMessage\('', ''\);\s*activeBusinessMode = await loadSavedStatusPillModeFromSupabase\(\);/);
  assert.match(
    dashboardSource,
    /<span>Bedrijf<\/span>[\s\S]*<span>Adres<\/span>[\s\S]*<span>Telefoonnummer<\/span>[\s\S]*<span>Website<\/span>/
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
  assert.match(dashboardSource, /function prewarmLeadDatabaseFromCampaignControl\(options = \{\}\) \{[\s\S]*ensureLeadDatabaseModal\(\)[\s\S]*dbModal\.prewarmLeadDatabase\(options\);/);
  assert.match(dashboardSource, /opening:\s*false,[\s\S]*openRequestId:\s*0,/);
  assert.match(
    dashboardSource,
    /const busy = state\.importing \|\| state\.loading \|\| state\.opening;[\s\S]*: state\.loading \|\| state\.opening[\s\S]*Database laden\.\.\./
  );
  assert.match(dashboardSource, /\(state\.loading \|\| state\.opening\) && state\.records\.length === 0/);
  assert.match(
    dashboardSource,
    /async function openModal\(\) \{[\s\S]*modal\.style\.display = 'flex';[\s\S]*if \(!hadSnapshot\) \{[\s\S]*state\.opening = true;[\s\S]*render\(\);[\s\S]*await loadRemoteUiState\(\);[\s\S]*state\.opening = false;[\s\S]*await loadData\(true\);/
  );
  assert.match(dashboardSource, /void leadDatabaseModal\.prewarmLeadDatabase\(\);/);
  assert.match(dashboardSource, /function prewarmLeadDatabaseCallDetails\(limit = 1\) \{/);
  assert.match(dashboardSource, /prewarmLeadDatabaseCallDetails\(4\);/);
  assert.match(
    dashboardSource,
    /function syncSequentialClientDispatchButtonState\(\) \{[\s\S]*setButtonLoading\(true, 'Coldcalling bezig\.\.\.'\);[\s\S]*setButtonLoading\(false\);/
  );
  assert.match(
    dashboardSource,
    /function clearCompletedSequentialClientDispatchUi\(\) \{[\s\S]*setStatusPill\('idle', ''\);[\s\S]*setStatusMessage\('', ''\);/
  );
  assert.match(
    dashboardSource,
    /function isTerminalCallUpdateForSequentialClient\(update\) \{[\s\S]*const endedAt = String\(update\.endedAt \|\| ''\)\.trim\(\);[\s\S]*if \(endedAt\) return true;/
  );
  assert.match(
    dashboardSource,
    /function updateSequentialClientDispatchStatus\(\) \{[\s\S]*setStatusPill\('loading', 'Coldcalling bezig'\);[\s\S]*setStatusMessage\('', ''\);/
  );
  assert.match(
    dashboardSource,
    /messageType: 'direct\.call\.status',[\s\S]*endedAt: String\(data\.endedAt \|\| ''\)\.trim\(\),[\s\S]*durationSeconds: Number\(data\.durationSeconds \|\| 0\) \|\| 0/
  );
  assert.match(
    dashboardSource,
    /function setButtonLoading\(isLoading, label = 'Coldcalling bezig\.\.\.'\) \{/
  );
  assert.match(
    dashboardSource,
    /setButtonLoading\(true, 'Coldcalling bezig\.\.\.'\);[\s\S]*setStatusPill\('loading', 'Coldcalling bezig'\);[\s\S]*setStatusMessage\('', ''\);/
  );
  assert.match(
    dashboardSource,
    /setStatusPill\('loading', '1 voor 1 actief'\);[\s\S]*setStatusMessage\('', ''\);[\s\S]*await advanceSequentialClientDispatch\('start-request'\);/
  );
  assert.match(
    dashboardSource,
    /addUiLog\(\s*'success',[\s\S]*Coldcalling afgerond[\s\S]*activeSequentialClientDispatch = null;[\s\S]*clearCompletedSequentialClientDispatchUi\(\);/
  );
  assert.doesNotMatch(dashboardSource, /Bezig met coldcallen via \$\{stackLabel\}\.\.\./);
  assert.doesNotMatch(dashboardSource, /Wacht tot het huidige gesprek is afgelopen/);
  assert.doesNotMatch(dashboardSource, /Volgende call wordt voorbereid\.\.\./);
  assert.doesNotMatch(dashboardSource, /Eerste call wordt voorbereid\.\.\./);
  assert.doesNotMatch(dashboardSource, /Campagne wordt gestart via \$\{stackLabel\}\.\.\./);
  assert.doesNotMatch(dashboardSource, /Campagne starten\.\.\./);
  assert.match(
    dashboardSource,
    /const campaign = collectCampaignFormData\(\);[\s\S]*const stackLabel = String\([\s\S]*campaign\.coldcallingStackLabel \|\| getColdcallingStackLabel\(campaign\.coldcallingStack\) \|\| ''[\s\S]*\)\.trim\(\);/
  );
  assert.match(dashboardSource, /via \$\{escapeHtml\(stackLabel \|\| 'onbekende provider'\)\}\./);
  assert.match(dashboardSource, /looksLikeDirectSpeechConversationSummary/);
  assert.match(dashboardSource, /Eindig altijd met een volledige zin en nooit met ellips of afgebroken tekst/);
  assert.match(dashboardSource, /const sharedCallSummaryCacheByCallId = Object\.create\(null\);/);
  assert.match(dashboardSource, /function positionLeadSliderLabels\(sliderEl = leadSlider\) \{/);
  assert.match(dashboardSource, /labelEl\.style\.setProperty\('--slider-label-position', `\$\{ratio \* 100\}%`\);/);
  assert.match(dashboardSource, /positionLeadSliderLabels\(\);\s*renderLeadAmountDisplay\(\);/);
  assert.match(dashboardSource, /function readSharedCallSummaryCache\(\) \{\s*return sharedCallSummaryCacheByCallId;\s*\}/);
  assert.match(dashboardSource, /Noem de medewerker van Softora bij naam als Ruben Nijhuis wanneer die in de samenvatting voorkomt\./);
  assert.match(dashboardSource, /Gebruik nooit het woord "agent"\./);
  assert.match(dashboardSource, /function shouldRefreshLeadDatabaseCallDetailPayload\(detail\) \{/);
  assert.match(dashboardSource, /function buildLeadDatabaseTranscriptFallbackSummary\(call, insight, interestedLead, remoteDetail = null\) \{/);
  assert.match(dashboardSource, /function stripActionableFollowUpSummarySentence\(value\) \{/);
  assert.doesNotMatch(dashboardSource, /De logische vervolgstap is om de afspraak te bevestigen en intern op te volgen/);
  assert.doesNotMatch(dashboardSource, /wat de logische vervolgstap is als die echt is besproken/);
  assert.match(
    dashboardSource,
    /function getLeadDatabaseCallSummaryFallback\(call, insight, interestedLead\) \{[\s\S]*cachedDetail\?\.conversationSummary[\s\S]*callDetailSummaryByCallId\.get\(normalizedCallId\)/
  );
  assert.match(
    dashboardSource,
    /async function ensureLeadDatabaseCallSummary\(call\) \{[\s\S]*remoteDetail\?\.conversationSummary[\s\S]*remoteDetail\?\.summary/
  );
  assert.match(
    dashboardSource,
    /function openCallDetail\(callId\) \{[\s\S]*const immediateSummary = getLeadDatabaseCallSummaryFallback\(call, insight, interestedLead\);[\s\S]*renderCallDetail\(\);/
  );
  assert.match(
    dashboardSource,
    /function renderCallDetail\(\) \{[\s\S]*const immediateFallbackSummary = getLeadDatabaseCallSummaryFallback\(call, insight, interestedLead\);[\s\S]*pickReadableConversationSummary\(\s*immediateFallbackSummary,\s*callDetailSummaryByCallId\.get\(normalizedCallId\),\s*getSharedCallSummary\(normalizedCallId\)\s*\)/
  );
  assert.doesNotMatch(dashboardSource, /return 'Samenvatting wordt opgesteld op basis van de transcriptie\.';/);
  assert.match(dashboardSource, /family=Barlow\+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600/);
  assert.match(dashboardSource, /<div class="lead-db-toolbar">[\s\S]*leadDatabaseRefreshInfo[\s\S]*leadDatabaseAddManualBtn[\s\S]*leadDatabaseImportBtn/);
  assert.match(dashboardSource, /<div id="leadDatabaseSummaryCards" class="lead-db-stats"><\/div>/);
  assert.match(dashboardSource, /class="lead-db-table-card"/);
  assert.match(dashboardSource, /lead-db-table-summary[\s\S]*Unieke mensen gebeld[\s\S]*Totale beltijd/);
  assert.match(
    dashboardSource,
    /\.lead-db-table-summary\s*\{[\s\S]*align-items:\s*center;[\s\S]*gap:\s*8px;[\s\S]*padding:\s*12px 20px;[\s\S]*background:\s*rgba\(155, 35, 85, 0\.03\);/
  );
  assert.match(
    dashboardSource,
    /\.lead-db-table-summary-item\s*\{[\s\S]*min-width:\s*156px;[\s\S]*padding:\s*8px 12px;[\s\S]*border-radius:\s*8px;[\s\S]*background:\s*rgba\(255, 255, 255, 0\.58\);/
  );
  assert.match(
    dashboardSource,
    /\.lead-db-table-summary-label\s*\{[\s\S]*margin-bottom:\s*3px;[\s\S]*font-size:\s*8px;[\s\S]*letter-spacing:\s*1\.3px;/
  );
  assert.match(
    dashboardSource,
    /\.lead-db-table-summary-value\s*\{[\s\S]*font-family:\s*'Barlow', sans-serif;[\s\S]*font-size:\s*20px;[\s\S]*line-height:\s*1\.1;/
  );
  assert.match(dashboardSource, /<button type="button" id="leadDatabaseCancelBtn" class="lead-db-close-btn" aria-label="Sluiten" title="Sluiten">×<\/button>/);
  assert.doesNotMatch(dashboardSource, /<div class="lead-db-logo">Softora\.nl<\/div>/);
  assert.doesNotMatch(dashboardSource, /<div class="lead-db-footer">Softora\.nl<\/div>/);
  assert.doesNotMatch(dashboardSource, /leadDatabaseTemplateBtn/);
  assert.doesNotMatch(dashboardSource, /Template download/);
  assert.doesNotMatch(dashboardSource, /downloadLeadDatabaseTemplate/);
  assert.doesNotMatch(dashboardSource, /id="leadDatabaseRefreshBtn"/);
  assert.doesNotMatch(dashboardSource, /id="leadDatabaseFilterPills"/);
  assert.doesNotMatch(dashboardSource, /<button type="button" id="leadDatabaseCancelBtn" class="lead-db-btn">Sluiten<\/button>/);
  assert.doesNotMatch(dashboardSource, /lead-db-company-avatar/);
  assert.match(dashboardSource, /function hasAlertPhoneConversationSignal\(value\) \{/);
  assert.match(dashboardSource, /function hasOtherPhoneConversationSignal\(value\) \{/);
  assert.match(dashboardSource, /function hasOutOfServicePhoneConversationSignal\(value\) \{/);
  assert.match(dashboardSource, /\{ label: 'Alert', cls: 'lead-db-status-pill lead-db-status-pill--alert' \}/);
  assert.match(dashboardSource, /\{ label: 'Buiten gebruik', cls: 'lead-db-status-pill lead-db-status-pill--buiten' \}/);
  assert.match(dashboardSource, /\{ label: 'Niet bereikbaar', cls: 'lead-db-status-pill lead-db-status-pill--niet-bereikbaar' \}/);
  assert.match(dashboardSource, /\{ label: 'Overig', cls: 'lead-db-status-pill lead-db-status-pill--belt' \}/);
  assert.doesNotMatch(dashboardSource, /\{ label: 'Gebeld', cls: 'lead-db-status-pill lead-db-status-pill--belt' \}/);
  assert.doesNotMatch(dashboardSource, /\{ label: 'Actuele bellijst', cls: 'lead-db-status-pill lead-db-status-pill--belt' \}/);
  assert.match(dashboardSource, /function getConversationRecordOccurredAt\(record\) \{/);
  assert.match(dashboardSource, /sort\(\(a, b\) => getConversationRecordOccurredMs\(b\) - getConversationRecordOccurredMs\(a\)\)/);
  assert.match(dashboardSource, /formatConversationTimestamp\(getConversationRecordOccurredAt\(record\)\)/);
  assert.match(dashboardSource, /function buildLeadDatabaseCallSummaryStats\(calls\) \{/);
  assert.match(dashboardSource, /function formatLeadDatabaseAggregateDuration\(totalSeconds\) \{/);
  assert.match(dashboardSource, /const sortedUpdates = entry\.updates[\s\S]*sort\(\(a, b\) => getConversationRecordOccurredMs\(b\) - getConversationRecordOccurredMs\(a\)\)/);
  assert.match(dashboardSource, /const rows = \(Array\.isArray\(state\.calls\) \? state\.calls : \[\]\)[\s\S]*sort\(\(a, b\) => getConversationRecordOccurredMs\(b\) - getConversationRecordOccurredMs\(a\)\)/);
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
  assert.match(
    dashboardSource,
    /function bindLeadDatabaseOpenControl\(\) \{[\s\S]*window\.openLeadDatabaseModalFromCampaign = openLeadDatabaseFromCampaignControl;[\s\S]*button\.dataset\.dbOpenBound !== '1'[\s\S]*button\.addEventListener\('pointerenter', warmupLeadDatabase, \{ passive: true \}\);[\s\S]*button\.addEventListener\('focus', warmupLeadDatabase\);[\s\S]*button\.addEventListener\('touchstart', warmupLeadDatabase, \{ passive: true \}\);/
  );
  assert.match(dashboardSource, /bindLeadDatabaseOpenControl\(\);\s*void bootstrapColdcallingUi\(\);/);
  assert.match(dashboardSource, /const CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY = 'softora_campaign_regio_custom_km';/);
  assert.match(dashboardSource, /const DEFAULT_CAMPAIGN_REGIO_VALUE = 'unlimited';/);
  assert.match(dashboardSource, /function formatCampaignCustomRegioLabel\(km\) \{/);
  assert.match(dashboardSource, /async function promptForCustomCampaignRegioKm\(initialValue = ''\) \{/);
  assert.match(dashboardSource, /savedRegio === CUSTOM_CAMPAIGN_REGIO_VALUE[\s\S]*applyCampaignRegioSelection\(regioEl, CUSTOM_CAMPAIGN_REGIO_VALUE, savedCustomRegioKm\);/);
  assert.match(dashboardSource, /if \(selectedValue === CUSTOM_CAMPAIGN_REGIO_VALUE\) \{[\s\S]*const customKm = await promptForCustomCampaignRegioKm\(initialCustomKm\);/);
  assert.match(pageSource, /const activeDotColor = String\([\s\S]*selectedOption\?\.dataset\?\.dotColor[\s\S]*wrapper\.dataset\.dotColor = activeDotColor;/);
  assert.doesNotMatch(dashboardSource, /window\.localStorage/);
  assert.doesNotMatch(dashboardSource, /window\.sessionStorage/);
});

test('premium ai lead generator includes a live Retell cost counter', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-lead-generator.html');
  const costWidgetPath = path.join(__dirname, '../../assets/retell-cost-widget.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const costWidgetSource = fs.readFileSync(costWidgetPath, 'utf8');

  assert.match(pageSource, /<span class="topbar-select-label">Totale kosten coldcalling<\/span>/);
  assert.match(pageSource, /<div class="topbar-cost-group" data-retell-cost-root>/);
  assert.match(pageSource, /<div class="topbar-cost-value" data-retell-cost-value>€0,00<\/div>/);
  assert.match(pageSource, /<script src="assets\/retell-cost-widget\.js\?v=20260415b" defer><\/script>/);
  assert.doesNotMatch(pageSource, /topbar-cost-dot/);
  assert.doesNotMatch(pageSource, /data-retell-cost-meta/);
  assert.match(costWidgetSource, /const CALL_UPDATES_ENDPOINT = '\/api\/coldcalling\/call-updates\?limit=500';/);
  assert.match(costWidgetSource, /const DEFAULT_RETELL_ESTIMATED_COST_PER_MINUTE_USD = 0\.07;/);
  assert.match(costWidgetSource, /const DEFAULT_USD_TO_EUR_RATE = 0\.92;/);
  assert.match(costWidgetSource, /function convertUsdToEur\(amountUsd\)/);
  assert.match(costWidgetSource, /function buildRetellCostSummary\(updates\)/);
  assert.match(costWidgetSource, /function formatEurCost\(amount\)/);
  assert.match(costWidgetSource, /return `€\$\{safeAmount\.toLocaleString\('nl-NL'/);
  assert.match(costWidgetSource, /window\.refreshRetellCostSummary = refreshRetellCostSummary;/);
  assert.match(
    costWidgetSource,
    /window\.setInterval\(function \(\) \{[\s\S]*refreshRetellCostSummary\(\{ silent: true \}\);[\s\S]*\}, POLL_INTERVAL_MS\);/
  );
});

test('premium ai lead generator persists dashboard config and stats through Supabase-only flows', () => {
  const dashboardPath = path.join(__dirname, '../../assets/coldcalling-dashboard.js');
  const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(dashboardSource, /const BUSINESS_MODE_STORAGE_KEY = 'softora_business_mode';/);
  assert.match(dashboardSource, /const REMOTE_UI_STATE_SCOPE_PREFERENCES = 'coldcalling_preferences';/);
  assert.match(dashboardSource, /async function loadSavedStatusPillModeFromSupabase\(\) \{[\s\S]*fetchUiStateGetWithFallback\(REMOTE_UI_STATE_SCOPE_PREFERENCES\)[\s\S]*source !== 'supabase'/);
  assert.match(dashboardSource, /async function persistStatusPillModeToSupabase\(mode\) \{[\s\S]*fetchUiStateSetWithFallback\(REMOTE_UI_STATE_SCOPE_PREFERENCES[\s\S]*source !== 'supabase'/);
  assert.match(dashboardSource, /if \(patchKeys\.length === 0\) \{[\s\S]*remoteUiStateLastSource === 'supabase'[\s\S]*Dashboardconfiguratie is nog niet vanuit Supabase geladen\./);
  assert.match(dashboardSource, /async function resetStatsRowToZero\(\) \{[\s\S]*setStatsResetBaselineState\(latestStatsSummary\)[\s\S]*const saveResult = await persistRemoteUiStateNow\(\)[\s\S]*setStatusPill\('success', 'Reset opgeslagen'\);[\s\S]*setStatusMessage\('', ''\);/);
  assert.doesNotMatch(dashboardSource, /Dashboard-reset is opgeslagen in Supabase\./);
  assert.match(dashboardSource, /button\.addEventListener\('click', async \(event\) => \{[\s\S]*await resetStatsRowToZero\(\);/);
  assert.match(dashboardSource, /function buildDashboardStatsSummaryFromPersistedSources\(data\) \{/);
  assert.match(dashboardSource, /if \(!dashboardStatsPollTimer\) \{[\s\S]*refreshDashboardStatsFromSupabase\(\{ silent: true \}\)[\s\S]*12000/);
  assert.match(dashboardSource, /const stateSaveResult = await persistRemoteUiStateNow\(\);[\s\S]*Dashboardconfiguratie staat nog niet veilig in Supabase\./);
  assert.match(dashboardSource, /async function bootstrapColdcallingUi\(\) \{[\s\S]*activeBusinessMode = await loadSavedStatusPillModeFromSupabase\(\);[\s\S]*const uiStateLoaded = await loadRemoteUiState\(\);[\s\S]*remoteUiStateLastSource !== 'supabase'[\s\S]*Dashboardconfiguratie kon niet uit Supabase geladen worden\./);
});

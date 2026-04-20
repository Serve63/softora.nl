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
  assert.match(pageSource, /<script src="assets\/coldcalling-dashboard\.js\?v=20260420a" defer><\/script>/);
  assert.match(pageSource, /id="leadAmountQuestionLabel"/);
  assert.match(pageSource, /Hoeveel mensen wil je bellen\?/);
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
  assert.match(pageSource, /<label class="form-label form-label--regio" for="regio">/);
  assert.match(
    pageSource,
    /<label class="form-label form-label--regio" for="regio">[\s\S]*?<span class="form-label-regio-heading">Omstreken Oisterwijk<\/span><span id="campaignRegioLeadCount"/
  );
  assert.match(
    pageSource,
    /<\/label>\s*<span class="form-label-tip form-label-tip--info" id="campaignRegioTip">[\s\S]*?<\/span>\s*<select class="form-select magnetic" id="regio">/
  );
  assert.match(pageSource, /if \(select\.id === 'regio'\) \{[\s\S]*?getElementById\('campaignRegioTip'\)/);
  assert.match(pageSource, /<select class="form-select magnetic" id="statusPill" data-select-variant="pill" data-dot-color="accent" aria-label="Business modus">/);
  assert.match(pageSource, /<option value="websites" data-dot-color="accent" selected>Website's<\/option>/);
  assert.match(pageSource, /<option value="voice_software" data-dot-color="green" disabled>Voicesoftware<\/option>/);
  assert.match(pageSource, /<option value="business_software" data-dot-color="blue" disabled>Bedrijfssoftware<\/option>/);
  assert.match(pageSource, /<option value="ai_chatbots" data-dot-color="accent" disabled>AI Chatbots<\/option>/);
  assert.match(pageSource, /serviceLockOptionValues = new Set\(\['voice_software', 'business_software', 'ai_chatbots'\]\)/);
  assert.match(pageSource, /class="sidebar-link-lock-icon"/);
  assert.match(pageSource, /<option value="unlimited" selected>Geen limiet<\/option>/);
  assert.match(pageSource, /<option value="auto">Automatisch<\/option>/);
  assert.match(pageSource, /<option value="150km">150 km<\/option>/);
  assert.match(pageSource, /<option value="250km">250 km<\/option>/);
  assert.match(pageSource, /<option value="200km">200 km<\/option>/);
  assert.match(pageSource, /<option value="30km">30 km<\/option>/);
  assert.doesNotMatch(pageSource, /<option value="custom">Aangepast<\/option>/);
  assert.match(
    pageSource,
    /<div class="slider-labels">\s*<span data-slider-label-value="1">1<\/span>\s*<span data-slider-label-value="50">50<\/span>\s*<span data-slider-label-value="100">100<\/span>\s*<span data-slider-label-value="150">150<\/span>\s*<span data-slider-label-value="200">200<\/span>\s*<span class="slider-label-infinity" data-slider-label-value="250">&infin;<\/span>\s*<\/div>/
  );
  assert.match(pageSource, /<div class="slider-container" id="leadSliderStage" data-slider-ready="0" aria-hidden="true">/);
  assert.match(pageSource, /window\.openSiteInputDialog = openSiteInputDialog;/);
  assert.match(pageSource, /\.slider-container\[data-slider-ready="0"\]\s*\{[\s\S]*visibility:\s*hidden;[\s\S]*pointer-events:\s*none;/);
  assert.match(pageSource, /\.slider-labels\s*\{[\s\S]*position:\s*relative;[\s\S]*height:\s*1\.4rem;/);
  assert.match(pageSource, /\.slider-labels span\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*var\(--slider-label-position, 0%\);[\s\S]*transform:\s*translateX\(-50%\);/);
  assert.match(pageSource, /\.slider-labels span:last-child\s*\{[\s\S]*left:\s*100%;[\s\S]*transform:\s*translateX\(-100%\);/);
  assert.match(pageSource, /\.topbar-right \.site-select--pill\[data-dot-color="accent"\] \.site-select-trigger::before \{[\s\S]*background:\s*var\(--accent-light\);/);
  assert.match(pageSource, /\.topbar-right \.site-select--pill\[data-dot-color="blue"\] \.site-select-trigger::before \{[\s\S]*background:\s*#2563eb;/);
  assert.match(
    pageSource,
    /<div class="form-group form-group--agenda-capacity">[\s\S]*<input type="checkbox" id="campaignFillAgendaWorkdays"[\s\S]*Start Campagne tot 10 werkdagen vooruit is volgepland\./
  );
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--agenda-capacity\s*\{[\s\S]*grid-column:\s*1 \/ -1;[\s\S]*grid-row:\s*2;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--slider\s*\{[\s\S]*grid-column:\s*1 \/ -1;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--lead-list\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*4;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--dispatch\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*5;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--branche\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*4;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--regio\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*5;/);
  assert.match(dashboardSource, /function ensureStartCampaignConfirmModal\(\)/);
  assert.match(dashboardSource, /startConfirmPin:\s*startConfirmPin/);
  assert.match(dashboardSource, /openStartCampaignConfirmModal\(\);/);
  assert.match(
    dashboardSource,
    /const CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY = 'softora_campaign_fill_agenda_10_workdays';/
  );
  assert.match(
    dashboardSource,
    /const fillAgendaEl = byId\('campaignFillAgendaWorkdays'\);[\s\S]*readStorage\(CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY\)/
  );
  assert.match(
    dashboardSource,
    /CAMPAIGN_AMOUNT_QUESTION_MODE_STORAGE_KEY = 'softora_campaign_amount_question_mode'/
  );
  assert.match(dashboardSource, /function bindLeadAmountQuestionNav\(\) \{/);
  assert.match(dashboardSource, /function getLeadAmountQuestionLabelText\(\) \{/);
  assert.match(
    dashboardSource,
    /writeStorage\(CAMPAIGN_FILL_AGENDA_10_WORKDAYS_STORAGE_KEY, fillAgendaEl\.checked \? '1' : '0'\)/
  );
  assert.match(dashboardSource, /function syncCampaignFillAgendaSliderVisibility\(\)[\s\S]*agendaCapGroup\.style\.gridRow = '2'/);
  assert.match(
    dashboardSource,
    /bindCampaignFormStatePersistence\(\);\s*syncCampaignFillAgendaSliderVisibility\(\);/
  );
  assert.match(dashboardSource, /function paintRegioLeadCountOnCustomSelectValue\(\)/);
  assert.match(dashboardSource, /const countHost = byId\('campaignRegioLeadCount'\);/);
  assert.match(dashboardSource, /valueEl\.innerHTML = safeLabel;/);
  assert.match(dashboardSource, /function hookRegioLeadCountCustomSelectSync\(\)/);
  assert.match(dashboardSource, /const AUTO_CAMPAIGN_REGIO_VALUE = 'auto';/);
  assert.match(dashboardSource, /const MAX_CAMPAIGN_REGIO_KM_CHOICE = 250;/);
  assert.match(dashboardSource, /function resolveAutomaticCampaignRegioKm\(/);
  assert.match(dashboardSource, /function getCampaignRegioLabelForApi\(/);
  assert.match(dashboardSource, /function syncRegioToAutoIfFillAgendaWorkdaysEnabled\(/);
  assert.match(dashboardSource, /function refreshCampaignRegioTipLabel\(/);
  assert.match(dashboardSource, /let controlWrap = byId\('leadListControlWrap'\);[\s\S]*if \(!controlWrap\)/);
  assert.match(dashboardSource, /let dispatchWrap = byId\('callDispatchControlWrap'\);[\s\S]*if \(!dispatchWrap\)/);
  assert.match(dashboardSource, /let coldcallingDashboardBootstrapPayload = null;/);
  assert.match(dashboardSource, /function readColdcallingDashboardBootstrapPayload\(\) \{[\s\S]*softoraColdcallingDashboardBootstrap/);
  assert.match(dashboardSource, /function primeStatsFromBootstrap\(\) \{/);
  assert.match(dashboardSource, /if \(statsResetBaseline\) \{\s*setStatsResetBaselineState\(statsResetBaseline\);\s*\}/);
  assert.match(
    dashboardSource,
    /SoftoraDialogs\.confirm\(message, \{\s*title:\s*'Statistieken resetten'/
  );
  assert.match(dashboardSource, /primeStatsFromBootstrap\(\);\s*setStatusPill\('idle', ''\);\s*setStatusMessage\('', ''\);\s*activeBusinessMode = await loadSavedStatusPillModeFromSupabase\(\);/);
  assert.match(dashboardSource, /function setLeadSliderReadyState\(isReady\) \{[\s\S]*sliderStage\.dataset\.sliderReady = isReady \? '1' : '0';/);
  assert.match(dashboardSource, /const uiStateLoaded = await loadRemoteUiState\(\);[\s\S]*ensureLeadListPanel\(\);\s*setLeadSliderReadyState\(true\);/);
  assert.match(dashboardSource, /resetRemoteUiStateForModeSwitch\(\);[\s\S]*setLeadSliderReadyState\(false\);[\s\S]*await loadRemoteUiState\(\);/);
  assert.match(dashboardSource, /restoreCampaignFormStateFromStorage\(\);\s*renderLeadAmountDisplay\(\);\s*updateLeadListHint\(\);\s*updateAiNotebookHint\(\);\s*setLeadSliderReadyState\(true\);/);
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
  assert.match(dashboardSource, /no_answer:\s*'Niet opgenomen'/);
  assert.match(dashboardSource, /\{\s*key:\s*'no_answer',\s*label:\s*'NIET OPGENOMEN'/);
  assert.match(dashboardSource, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
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

test('premium ai lead generator omits topbar Retell cost; widget asset stays for other pages', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-lead-generator.html');
  const costWidgetPath = path.join(__dirname, '../../assets/retell-cost-widget.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const costWidgetSource = fs.readFileSync(costWidgetPath, 'utf8');

  assert.doesNotMatch(pageSource, /Geschatte coldcalling kosten/);
  assert.doesNotMatch(pageSource, /data-retell-cost-root/);
  assert.doesNotMatch(pageSource, /retell-cost-widget\.js/);
  assert.doesNotMatch(pageSource, /topbar-cost-dot/);
  assert.doesNotMatch(pageSource, /data-retell-cost-meta/);
  assert.match(costWidgetSource, /const COST_SUMMARY_ENDPOINT = '\/api\/coldcalling\/cost-summary\?scope=all_time';/);
  assert.match(costWidgetSource, /async function fetchRetellCostSummary\(\)/);
  assert.match(costWidgetSource, /const summary = await fetchRetellCostSummary\(\);/);
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readActiveOrdersSources() {
  const pagePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const scriptPath = path.join(__dirname, '../../assets/premium-actieve-opdrachten.js');
  const assignmentToggleStylePath = path.join(__dirname, '../../assets/premium-active-order-assignment-toggle.css');
  const assignmentToggleScriptPath = path.join(__dirname, '../../assets/premium-active-order-assignment-toggle.js');
  const openLeadsScriptPath = path.join(__dirname, '../../assets/premium-active-order-open-leads.js');
  const customSelectsScriptPath = path.join(__dirname, '../../assets/premium-active-order-custom-selects.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  const assignmentToggleStyleSource = fs.readFileSync(assignmentToggleStylePath, 'utf8');
  const assignmentToggleScriptSource = fs.readFileSync(assignmentToggleScriptPath, 'utf8');
  const openLeadsScriptSource = fs.readFileSync(openLeadsScriptPath, 'utf8');
  const customSelectsScriptSource = fs.readFileSync(customSelectsScriptPath, 'utf8');
  return {
    pageSource,
    scriptSource,
    openLeadsScriptSource,
    customSelectsScriptSource,
    assignmentToggleStyleSource,
    assignmentToggleScriptSource,
    combinedSource: `${pageSource}\n${scriptSource}\n${openLeadsScriptSource}\n${customSelectsScriptSource}\n${assignmentToggleStyleSource}\n${assignmentToggleScriptSource}`,
  };
}

test('premium actieve opdrachten tonen geen losse naam-badge meer en gebruiken bevestigde factuur-betaald flow', () => {
  const { pageSource, scriptSource, combinedSource: source } = readActiveOrdersSources();

  assert.match(pageSource, /<script src="assets\/premium-actieve-opdrachten\.js\?v=20260511a"><\/script>/);
  assert.match(pageSource, /assets\/premium-active-order-custom-selects\.js\?v=20260526a/);
  assert.match(pageSource, /assets\/premium-active-order-open-leads\.js\?v=20260526c/);
  assert.doesNotMatch(pageSource, /const PREVIEW_HTML_PREFIX = /);
  assert.doesNotMatch(pageSource, /function normalizeOrderStatus\(value\) \{/);
  assert.doesNotMatch(pageSource, /function applyOrderUiStateToCard\(id\) \{/);
  assert.doesNotMatch(pageSource, /function bindDynamicOrderCard\(card\) \{/);
  assert.doesNotMatch(pageSource, /function normalizeAgendaLeadOption\(item\) \{/);
  assert.doesNotMatch(pageSource, /function renderCreateOrderAgendaLeadOptions\(selectedId\) \{/);
  assert.doesNotMatch(pageSource, /function handleCreateOrderSubmit\(event\) \{/);
  assert.doesNotMatch(pageSource, /function selectActiveOrderId\(explicitId\) \{/);
  assert.doesNotMatch(pageSource, /function openOrderDossier\(id, options = \{\}\) \{/);
  assert.doesNotMatch(pageSource, /function normalizeClaimEmployeeName\(value\) \{/);
  assert.doesNotMatch(pageSource, /async function markOrderAsPaid\(id, options = \{\}\) \{/);
  assert.doesNotMatch(pageSource, /function buildFallbackSitePrompt\(meta, customOrder\) \{/);
  assert.doesNotMatch(pageSource, /async function postEstimateSiteCostRequest\(payload\) \{/);
  assert.doesNotMatch(pageSource, /function getProgressStepForPct\(pct\) \{/);
  assert.doesNotMatch(pageSource, /function startOrderProgressSimulation\(id\) \{/);
  assert.doesNotMatch(pageSource, /async function postGenerateSiteRequest\(payload\) \{/);
  assert.doesNotMatch(pageSource, /async function postLaunchSiteRequest\(payload\) \{/);
  assert.doesNotMatch(pageSource, /function setClaimOrderMessage\(message, type\) \{/);
  assert.doesNotMatch(pageSource, /function executeOrder\(id\) \{/);
  assert.doesNotMatch(pageSource, /function formatModalDateTime\(value\) \{/);
  assert.doesNotMatch(pageSource, /function renderModalOverviewHtml\(id\) \{/);
  assert.doesNotMatch(pageSource, /function openModal\(id\) \{/);
  assert.doesNotMatch(pageSource, /function closeModal\(\) \{/);
  assert.doesNotMatch(pageSource, /async function removeProjectFromSystem\(id\) \{/);
  assert.doesNotMatch(pageSource, /function bindActiveOrdersPageUi\(\) \{/);
  assert.doesNotMatch(pageSource, /async function initializeActiveOrdersPageState\(\) \{/);
  assert.doesNotMatch(pageSource, /function initActiveOrdersCursor\(\) \{/);
  assert.doesNotMatch(pageSource, /Cursor \(robust\)/);
  assert.match(scriptSource, /function normalizeOrderStatus\(value\) \{/);
  assert.match(scriptSource, /function persistOrdersRuntime\(\) \{/);
  assert.match(scriptSource, /function applyOrderUiStateToCard\(id\) \{/);
  assert.match(scriptSource, /function createCustomOrderCardElement\(record\) \{/);
  assert.match(scriptSource, /function bindDynamicOrderCard\(card\) \{/);
  assert.match(scriptSource, /function loadCustomOrderCards\(\) \{/);
  assert.match(scriptSource, /function setCreateOrderMessage\(message, type\) \{/);
  assert.match(scriptSource, /function normalizeAgendaLeadOption\(item\) \{/);
  assert.match(source, /function normalizeOpenLeadOption\(item\) \{/);
  assert.match(source, /function isOpenLeadFollowUpTask\(item\) \{/);
  assert.match(source, /function renderOpenLeadCards\(\) \{/);
  assert.match(source, /function openOpenLeadActionModal\(lead\) \{/);
  assert.match(source, /function submitOpenLeadConversion\(event\) \{/);
  assert.match(source, /Uit systeem halen/);
  assert.match(source, /Bekijk dossier/);
  assert.match(source, /Verplaatsen naar actieve opdrachten/);
  assert.match(source, /openLeadDossierModal/);
  assert.match(source, /function renderOpenLeadDossier\(lead\) \{/);
  assert.match(source, /\.open-lead-action-grid \{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[\s\S]*align-items:\s*stretch;/);
  assert.match(source, /\.open-lead-action-grid \.modal-btn \{[\s\S]*min-height:\s*8\.75rem;[\s\S]*height:\s*100%;/);
  assert.match(source, /\.open-lead-card \.order-main \{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(24rem, 0\.78fr\);[\s\S]*align-items:\s*stretch;/);
  assert.match(source, /\.open-lead-card-meta \{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(source, /appendTextElement\(valueMeta, 'div', 'open-lead-card-meta-label', 'Leadwaarde'\);/);
  assert.match(source, /appendTextElement\(statusMeta, 'div', 'open-lead-card-meta-label', 'Status'\);/);
  assert.match(source, /appendTextElement\(assigneeMeta, 'div', 'open-lead-card-meta-label', 'Toegewezen aan'\);/);
  assert.match(source, /appendOpenLeadDossierItem\(grid, 'Notities \/ transcript', lead\.postCallNotesTranscript/);
  assert.match(source, /appendOpenLeadDossierItem\(grid, 'Bouwprompt', lead\.postCallPrompt \|\| buildPromptFromOpenLead/);
  assert.match(source, /Opname toevoegen/);
  assert.match(source, /function revealConvertedOpenLeadOrder\(order\) \{/);
  assert.match(source, /window\.appendCustomOrderCard/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.match(source, /\/api\/agenda\/confirmation-tasks\/\$\{encodeURIComponent\(String\(lead\.id\)\)\}\/mark-cancelled/);
  assert.match(source, /\/api\/agenda\/appointments\/\$\{encodeURIComponent\(String\(lead\.id\)\)\}\/add-active-order/);
  assert.match(source, /status: 'actieve_opdracht'/);
  assert.match(source, /\/api\/agenda\/confirmation-tasks\?limit=250&quick=1&fresh=1/);
  assert.match(source, /data-order-filter="open_leads"/);
  assert.match(source, /id="filterCountOpenLeads"/);
  assert.match(source, /let activeOrderFilter = 'open_leads';/);
  assert.match(scriptSource, /function syncOrderClaimsFromAgendaOwners\(\) \{/);
  assert.match(scriptSource, /function renderCreateOrderAgendaLeadOptions\(selectedId\) \{/);
  assert.match(scriptSource, /function handleCreateOrderSubmit\(event\) \{/);
  assert.match(scriptSource, /function selectActiveOrderId\(explicitId\) \{/);
  assert.match(scriptSource, /function openOrderDossier\(id, options = \{\}\) \{/);
  assert.match(scriptSource, /function normalizeClaimEmployeeName\(value\) \{/);
  assert.match(scriptSource, /async function markOrderAsPaid\(id, options = \{\}\) \{/);
  assert.match(scriptSource, /function buildFallbackSitePrompt\(meta, customOrder\) \{/);
  assert.match(scriptSource, /async function postEstimateSiteCostRequest\(payload\) \{/);
  assert.match(scriptSource, /async function postActiveOrderJsonWithFallback\(endpoints, payload, options = \{\}\) \{/);
  assert.match(scriptSource, /function getProgressStepForPct\(pct\) \{/);
  assert.match(scriptSource, /function startOrderProgressSimulation\(id\) \{/);
  assert.match(scriptSource, /async function postGenerateSiteRequest\(payload\) \{/);
  assert.match(scriptSource, /async function postLaunchSiteRequest\(payload\) \{/);
  assert.match(scriptSource, /function setClaimOrderMessage\(message, type\) \{/);
  assert.match(scriptSource, /function appendClaimOrderSummaryRow\(fragment, label, value\) \{/);
  assert.match(scriptSource, /function executeOrder\(id\) \{/);
  assert.match(scriptSource, /function formatModalDateTime\(value\) \{/);
  assert.match(scriptSource, /function normalizeModalLinkUrl\(value\) \{/);
  assert.match(scriptSource, /function renderModalOverview\(container, id\) \{/);
  assert.match(scriptSource, /function openModal\(id\) \{/);
  assert.match(scriptSource, /function closeModal\(\) \{/);
  assert.match(scriptSource, /function handleModalPrimaryAction\(\) \{/);
  assert.match(scriptSource, /function handleModalDeleteAction\(\) \{/);
  assert.match(scriptSource, /async function removeProjectFromSystem\(id\) \{/);
  assert.match(scriptSource, /function setOpenDossierButtonContent\(btnEl\) \{/);
  assert.match(scriptSource, /function bindActiveOrdersPageUi\(\) \{/);
  assert.match(scriptSource, /async function initializeActiveOrdersPageState\(\) \{/);
  assert.match(scriptSource, /function initActiveOrdersCursor\(\) \{/);
  assert.match(scriptSource, /async function showActiveOrderAlert\(message, options = \{\}\) \{/);
  assert.match(scriptSource, /async function confirmActiveOrderAction\(message, options = \{\}\) \{/);
  assert.doesNotMatch(scriptSource, /window\.alert\(/);
  assert.doesNotMatch(scriptSource, /window\.confirm\(/);
  assert.equal((scriptSource.match(/new AbortController/g) || []).length, 1);
  assert.doesNotMatch(scriptSource, /window\.setTimeout\(\(\) => controller\.abort\(\), (30000|480000|600000)\)/);
  assert.doesNotMatch(source, /const claimHtml = /);
  assert.doesNotMatch(source, /<div class="order-claim"/);
  assert.match(source, /const actions = document\.createElement\('div'\);[\s\S]*actions\.className = 'order-actions';/);
  assert.match(source, /executeBtn\.dataset\.order = String\(id\);[\s\S]*setOpenDossierButtonContent\(executeBtn\);/);
  assert.match(source, /if \(!ui\.isBuilt\) \{[\s\S]*completeBtn\.dataset\.orderComplete = String\(id\);[\s\S]*completeBtn\.textContent = 'Factuur betaald';/);
  assert.match(source, /const assignee = appendTextElement\(actions, 'div', 'order-assignee', claimInfo\.by \|\| 'Nog niet geclaimd'\);[\s\S]*assignee\.id = `assignee-\$\{id\}`;/);
  assert.match(source, /completeBtnEl\.textContent = 'Factuur betaald';/);
  assert.match(source, /completeBtnEl\.hidden = isDelivered;/);
  assert.match(source, /completeBtnEl\.style\.display = isDelivered \? 'none' : '';/);
  assert.match(source, /assigneeEl\.textContent = claimInfo\.by \|\| 'Nog niet geclaimd';/);
  assert.match(source, /setOpenDossierButtonContent\(btnEl\);/);
  assert.doesNotMatch(source, /btnEl\.innerHTML = '<svg/);
  assert.doesNotMatch(source, /wrapper\.innerHTML = renderCustomOrderCardHtml/);
  assert.doesNotMatch(source, /function renderCustomOrderCardHtml\(record\) \{/);
  assert.match(source, /renderClaimOrderSummary\(summaryEl, activeId\);/);
  assert.doesNotMatch(source, /summaryEl\.innerHTML = renderClaimOrderSummary/);
  assert.match(source, /renderModalOverview\(overview, id\);/);
  assert.match(source, /container\.replaceChildren\(grid\);/);
  assert.match(source, /return url\.protocol === 'http:' \|\| url\.protocol === 'https:' \? url\.href : '';/);
  assert.match(source, /select\.replaceChildren\(\.\.\.options\);/);
  assert.match(source, /document\.getElementById\('modalBtn'\)\?\.addEventListener\('click', handleModalPrimaryAction\);/);
  assert.match(source, /document\.getElementById\('modalDeleteBtn'\)\?\.addEventListener\('click', handleModalDeleteAction\);/);
  assert.doesNotMatch(source, /overview\.innerHTML = renderModalOverviewHtml/);
  assert.doesNotMatch(source, /function renderModalOverviewHtml\(id\) \{/);
  assert.doesNotMatch(source, /item\.raw/);
  assert.doesNotMatch(source, /function escapeHtml\(str\) \{/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /\.onclick\s*=/);
  assert.match(source, /const isPaidOrder = Boolean\(paidAt\) \|\| status\.key === 'betaald';[\s\S]*if \(isPaidOrder\) \{[\s\S]*nextStatus = 'betaald';/);
  assert.match(source, /async function handleOrderPaymentAction\(id\) \{[\s\S]*if \(ui\.isPaid \|\| ui\.isBuilt\) return false;[\s\S]*return markOrderAsPaid\(id, \{ confirm: true \}\);/);
  assert.match(source, /const confirmed = await confirmActiveOrderAction\(invoicePaidReviewReminder,[\s\S]*Factuur betaald bevestigen/);
  assert.match(
    source,
    /Vergeet niet om de klant op een vriendelijk en natuurlijk moment te vragen[\s\S]*bodyHtml:\s*invoicePaidConfirmBodyHtml/
  );
  assert.match(source, /await persistRequiredUiStateKeysOrThrow\(\s*\[CUSTOM_ORDERS_KEY, ORDER_RUNTIME_KEY\],/);
  assert.match(source, /const completeBtn = card\.querySelector\('\.complete-btn\[data-order-complete\]'\);[\s\S]*void handleOrderPaymentAction\(id\);/);
  assert.match(source, /window\.addEventListener\('pagehide', \(\) => \{[\s\S]*void flushRemoteUiStateSave\(\);/);
  assert.match(source, /leadOwnerName: String\(item\?\.leadOwnerName \|\| item\?\.leadOwnerFullName \|\| ''\)\.trim\(\),/);
  assert.match(source, /const linkedLeadOwnerName = resolveLinkedLeadOwnerNameForOrder\(customOrder\);[\s\S]*const claimedBy = normalizeClaimEmployeeName\(customOrder\.claimedBy \|\| runtime\.claimedBy \|\| linkedLeadOwnerName \|\| ''\);/);
  assert.match(source, /const selectedAssignee = normalizeOrderAssignee\(data\.get\('assignee'\) \|\| linkedLeadOwnerName\);/);
  assert.match(source, /if \(!selectedAssignee \|\| !ORDER_ASSIGNEE_OPTIONS\.includes\(selectedAssignee\)\) \{[\s\S]*Kies wie deze opdracht krijgt toegewezen\./);
  assert.match(source, /claimedBy: selectedAssignee \|\| null,/);
  assert.match(source, /claimedAt: claimedAtIso,/);
  assert.match(source, /companyName,\s*contactName: contactPerson,\s*contactPhone: linkedContactPhone,\s*contactEmail: linkedContactEmail,/);
  assert.match(source, /const companyName = String\(item\?\.companyName \|\| ''\)\.trim\(\);/);
  assert.match(source, /const contactName = String\(item\?\.contactName \|\| ''\)\.trim\(\);/);
  assert.match(pageSource, /assets\/premium-active-order-assignment-toggle\.css\?v=20260511a/);
  assert.match(pageSource, /assets\/premium-active-order-assignment-toggle\.js\?v=20260511a/);
  assert.match(source, /const toggleId = 'myAssignmentsOnlyToggle';[\s\S]*const labelText = 'Enkel mijn toewijzingen bekijken';/);
  assert.match(source, /\.assignment-toggle-box::after \{[\s\S]*border-right:\s*2px solid #fff;[\s\S]*border-bottom:\s*2px solid #fff;/);
  assert.match(source, /const shouldHide = \(activeOrderFilter !== 'all' && group !== activeOrderFilter\) \|\| \(typeof window\.SoftoraActiveOrdersFilter\?\.shouldHideCard === 'function' && window\.SoftoraActiveOrdersFilter\.shouldHideCard\(card\)\);/);
  assert.match(source, /filter\.shouldHideCard = function shouldHideCard\(card\) \{[\s\S]*return normalizeAssignee\(getClaimInfo\(orderId\)\?\.by \|\| ''\) !== currentAssignee;/);
  assert.match(source, /topbarRight\.insertBefore\(label, topbarRight\.firstChild\);[\s\S]*if \(typeof window\.applyOrderFilter === 'function'\) window\.applyOrderFilter\(\);/);
});

test('premium actieve opdrachten gebruiken expliciete customer identity voor koppeling naar klanten', () => {
  const { combinedSource: source } = readActiveOrdersSources();

  assert.match(source, /const explicitCompany = String\(record\?\.companyName \|\| ''\)\.trim\(\);/);
  assert.match(source, /const explicitContact = String\(record\?\.contactName \|\| ''\)\.trim\(\);/);
  assert.match(source, /return `\$\{normalizeMatchValue\(company\)\}\|\$\{normalizeMatchValue\(name\)\}\|\$\{normalizeMatchValue\(explicitPhone\)\}`;/);
});

test('premium actieve opdrachten tonen create-order modal zonder sample-design en domeinvelden', () => {
  const { combinedSource: source } = readActiveOrdersSources();

  assert.match(source, /<label class="create-order-label" for="newOrderAssignee">Toegewezen aan<\/label>/);
  assert.match(source, /<select class="create-order-select" id="newOrderAssignee" name="assignee" data-custom-select="true" required>/);
  assert.match(source, /<option value="">Kies medewerker<\/option>\s*<option value="Martijn">Martijn<\/option>\s*<option value="Servé">Servé<\/option>/);
  assert.match(source, /const SELECTOR = \[[\s\S]*'select\.create-order-select'[\s\S]*'\.create-order-select-wrap select'[\s\S]*'\.create-order-form select'[\s\S]*'\.create-order-dialog select'[\s\S]*'#openLeadCreateModal select'[\s\S]*'\[data-open-lead-create-modal\] select'[\s\S]*\]\.join\(', '\);/);
  assert.match(source, /function hydrate\(root = document\) \{[\s\S]*select\.dataset\.customSelect = 'true';[\s\S]*window\.initCustomFormSelects\(root\);/);
  assert.match(source, /function observe\(\) \{[\s\S]*new MutationObserver\(\(mutations\) => \{[\s\S]*hydrate\(select\)\);/);
  assert.match(source, /\.create-order-dialog \.site-select-menu \{[\s\S]*box-shadow:\s*0 18px 45px rgba\(8, 8, 12, 0\.18\)/);
  assert.match(source, /\.create-order-dialog \.site-select-option\.is-selected::before \{[\s\S]*border-color:\s*var\(--accent-light\);/);
  assert.match(source, /const ORDER_ASSIGNEE_OPTIONS = Object\.freeze\(\['Martijn', 'Servé'\]\);/);
  assert.match(source, /function normalizeOrderAssignee\(value\) \{[\s\S]*const words = normalized\.split\(\/\[\^a-z\]\+\/\)\.filter\(Boolean\);[\s\S]*if \(words\.includes\('serve'\)\) return 'Servé';[\s\S]*if \(words\.includes\('martijn'\)\) return 'Martijn';/);
  assert.match(source, /function normalizeClaimEmployeeName\(value\) \{[\s\S]*const canonicalAssignee = normalizeOrderAssignee\(value\);[\s\S]*if \(canonicalAssignee\) return canonicalAssignee;/);
  assert.match(source, /\.modal-btn\.danger \{[\s\S]*color:\s*var\(--accent-light\);/);
  assert.match(source, /\.modal-btn\.danger:hover \{[\s\S]*color:\s*var\(--accent-light\);/);
  assert.doesNotMatch(source, /Voorbeelddesign meenemen als basis/);
  assert.doesNotMatch(source, /Gebruik dit als je de stijl\/richting van het voorbeelddesign wilt doorzetten in de echte build\./);
  assert.doesNotMatch(source, /Domeinnaam \(voor live launch\)/);
  assert.doesNotMatch(source, /Optioneel, maar nodig als je ook domein-koppeling\/registratie wilt automatiseren\./);
  assert.doesNotMatch(source, /id="newOrderIncludeSampleDesign"/);
  assert.doesNotMatch(source, /id="newOrderDomain"/);
});

test('premium opdrachtdossier laadt eerst een bestaand cache-item voordat opus opnieuw genereert', () => {
  const filePath = path.join(__dirname, '../../premium-opdracht-dossier.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const DOSSIER_CACHE_KEY = 'softora_order_dossier_cache_v1';/);
  assert.match(source, /const DOSSIER_LAYOUT_SCHEMA_VERSION = '20260417a';/);
  assert.match(source, /function buildDossierCacheFingerprint\(baseData\) \{/);
  assert.match(source, /layoutVersion: DOSSIER_LAYOUT_SCHEMA_VERSION,/);
  assert.match(source, /function getCachedDossierLayoutResponse\(rawValue, orderId, fingerprint\) \{/);
  assert.match(source, /const expectedFingerprint = String\(fingerprint \|\| ''\)\.trim\(\);[\s\S]*if \(!entryFingerprint \|\| !expectedFingerprint \|\| entryFingerprint !== expectedFingerprint\) \{[\s\S]*return null;/);
  assert.match(source, /function buildShortOpusPrompt\(baseData\) \{/);
  assert.match(source, /function extractWebsiteStyleHintFromBaseData\(baseData\) \{/);
  assert.match(
    source,
    /return `Bouw een premium, moderne en volledig responsieve website voor \$\{label\}\$\{domainPart\}\$\{styleHint\};/
  );
  assert.match(source, /function shouldHideLegacyDossierBlockTitle\(value\) \{[\s\S]*normalized === 'uitvoerplan'[\s\S]*normalized === 'uitvoerfocus'[\s\S]*normalized\.startsWith\('ontbrekende informatie'\)[\s\S]*normalized\.startsWith\('praktische aandachtspunten'\)/);
  assert.match(source, /function normalizeDossierPairLabel\(value\) \{[\s\S]*normalized === 'accounthouder softora' \|\| normalized === 'softora contactpersoon'[\s\S]*return ''[\s\S]*normalized === 'geclaimd door' \? 'Aangewezen aan' : label;/);
  assert.match(source, /const prompt = buildShortOpusPrompt\(baseData\);/);
  assert.match(source, /label: 'Aangewezen aan', value: baseData\.claimedBy \|\| '—'/);
  assert.match(source, /const cacheMap = parseDossierCacheMap\(rawValue\);[\s\S]*const entry = cacheMap\[String\(orderId\)\];/);
  assert.doesNotMatch(source, /window\.localStorage/);
  assert.doesNotMatch(source, /window\.sessionStorage/);
  assert.match(source, /async function persistDossierCache\(rawValue, orderId, fingerprint, layoutResponse\) \{/);
  assert.match(source, /await fetchUiStateSetWithFallback\(REMOTE_SCOPE, \{/);
  assert.match(source, /const cachedLayoutResponse = getCachedDossierLayoutResponse\(/);
  assert.match(source, /const opusFromLayout = clipText\(String\(rawLayout\.opusPrompt \|\| ''\)\.trim\(\), 22000\);/);
  assert.match(source, /const opusPrompt = opusFromLayout \|\| buildShortOpusPrompt\(baseData\);/);
  assert.match(source, /if \(shouldHideLegacyDossierBlockTitle\(title\)\) return null;/);
  assert.match(source, /if \(cachedLayoutResponse\) \{[\s\S]*renderDossier\(baseData, cachedLayoutResponse\);/);
  assert.match(source, /void persistDossierCache\(values\?\.\[DOSSIER_CACHE_KEY\], orderId, dossierFingerprint, layoutResponse\);/);
  assert.doesNotMatch(source, /source-chip/);
  assert.doesNotMatch(source, /Dynamisch via/);
  assert.doesNotMatch(source, /Klantwensen \(bron\):/);
  assert.doesNotMatch(source, /Werk praktisch en concreet, zonder vage algemeenheden\./);
  assert.doesNotMatch(source, /title: 'Uitvoerfocus'/);
});

test('server opdrachtdossier filtert legacy planningsblokken en zet een echte bouwprompt', () => {
  const filePath = path.join(__dirname, '../../server/services/order-dossier.js');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /function buildShortOrderDossierOpusPrompt\(options = \{\}\) \{/);
  assert.match(source, /function extractWebsiteStyleHintFromOrderInput\(input\) \{/);
  assert.match(
    source,
    /return `Bouw een premium, moderne en volledig responsieve website voor \$\{label\}\$\{domainPart\}\$\{styleHint\};/
  );
  assert.match(source, /function shouldHideOrderDossierBlockTitle\(value\) \{[\s\S]*normalized === 'uitvoerplan'[\s\S]*normalized === 'uitvoerfocus'[\s\S]*normalized\.startsWith\('ontbrekende informatie'\)[\s\S]*normalized\.startsWith\('praktische aandachtspunten'\)/);
  assert.match(source, /function normalizeOrderDossierPairLabel\(value\) \{[\s\S]*normalized === 'accounthouder softora'[\s\S]*normalized === 'softora contactpersoon'[\s\S]*return ''[\s\S]*normalized === 'geclaimd door' \? 'Aangewezen aan' : label;/);
  assert.match(source, /const promptText = buildShortOrderDossierOpusPrompt\(input\);/);
  assert.match(source, /const opusFromLayout = clipText\(normalizeString\(rawLayout\.opusPrompt \|\| ''\), 20000\);/);
  assert.match(source, /const opusPrompt = opusFromLayout \|\| fallback\.opusPrompt;/);
  assert.match(source, /if \(shouldHideOrderDossierBlockTitle\(title\)\) return null;/);
  assert.match(source, /label: 'Aangewezen aan', value: input\.claimedBy \|\| '—'/);
  assert.match(source, /Gebruik geen bloktitels zoals "Uitvoerplan", "Ontbrekende informatie" of "Praktische aandachtspunten"\./);
  assert.match(source, /Voeg geen interne velden toe zoals "Accounthouder Softora" of "Softora-contactpersoon"\./);
  assert.match(source, /Laat interne Softora-contactvelden zoals account- of contactpersoonlabels weg\./);
  assert.match(source, /- opusPrompt moet een echte bouwprompt zijn/);
  assert.doesNotMatch(source, /Klantwensen \(bron\):/);
  assert.doesNotMatch(source, /title: 'Uitvoerfocus'/);
});

test('premium opdrachtdossier toont de pdf-knop rechtsboven en laat de pagina volledig uitlopen', () => {
  const filePath = path.join(__dirname, '../../premium-opdracht-dossier.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /Uitvoerdossier voor uitvoering/);
  assert.doesNotMatch(source, /Dynamisch uitvoerdossier op basis van actuele opdrachtinformatie\./);
  assert.match(source, /\.dossier-wrap \{[\s\S]*align-items:\s*stretch;/);
  assert.match(
    source,
    /\.page-toolbar \{[\s\S]*justify-content:\s*flex-end;[\s\S]*background:\s*transparent;[\s\S]*backdrop-filter:\s*none;/
  );
  assert.match(source, /\.toolbar-actions \{[\s\S]*justify-content:\s*flex-end;[\s\S]*margin-left:\s*auto;/);
  assert.match(source, /\.paper-stage \{[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  assert.match(source, /\.dossier-page \{[\s\S]*position:\s*relative;[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  assert.match(source, /\.page-body \{[\s\S]*overflow:\s*visible;/);
  assert.match(source, /root\.innerHTML = `\s*<div class="page-toolbar screen-only" id="pageToolbar" style="justify-content: flex-end;">[\s\S]*<div class="paper-shell" id="paperShell">/);
  assert.match(
    source,
    /function syncPaperScale\(\) \{[\s\S]*paperShell\.style\.setProperty\('--paper-scale', String\(s\)\);/
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readActiveOrdersSources() {
  const pagePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const bootScriptPath = path.join(__dirname, '../../assets/premium-active-orders-boot.js');
  const scriptPath = path.join(__dirname, '../../assets/premium-actieve-opdrachten.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const bootScriptSource = fs.readFileSync(bootScriptPath, 'utf8');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  return {
    bootScriptSource,
    pageSource,
    scriptSource,
    combinedSource: `${pageSource}\n${bootScriptSource}\n${scriptSource}`,
  };
}

test('premium actieve opdrachten tonen geen losse naam-badge meer en gebruiken bevestigde factuur-betaald flow', () => {
  const { pageSource, scriptSource, combinedSource: source } = readActiveOrdersSources();

  assert.match(pageSource, /<!-- SOFTORA_ACTIVE_ORDERS_BOOTSTRAP --><script src="assets\/premium-active-orders-boot\.js\?v=20260501a"><\/script><script src="assets\/premium-actieve-opdrachten\.js\?v=20260501c"><\/script>/);
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
  assert.match(scriptSource, /function renderModalOverview\(container, id\) \{/);
  assert.match(scriptSource, /function openModal\(id\) \{/);
  assert.match(scriptSource, /function closeModal\(\) \{/);
  assert.match(scriptSource, /function handleModalPrimaryAction\(\) \{/);
  assert.match(scriptSource, /function handleModalDeleteAction\(\) \{/);
  assert.match(scriptSource, /async function removeProjectFromSystem\(id\) \{/);
  assert.match(scriptSource, /function setOpenDossierButtonContent\(btnEl\) \{/);
  assert.match(scriptSource, /function bindActiveOrdersPageUi\(\) \{/);
  assert.match(scriptSource, /async function initializeActiveOrdersPageState\(options = \{\}\) \{/);
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
  assert.match(source, /function renderModalOverview\(container, id\) \{[\s\S]*container\.replaceChildren\(\);[\s\S]*container\.hidden = true;/);
  assert.doesNotMatch(scriptSource, /Foto-bijlagen preview|Geen foto-bijlagen gekoppeld\.|AI bouwprompt|Omschrijving opdracht|Meeting notities|Domeinmelding|Laatste build run/);
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
    /Vergeet niet om de klant op een goed moment te vragen om een revieuw achter te laten![\s\S]*bodyHtml:\s*invoicePaidConfirmBodyHtml/
  );
  assert.match(source, /reviewBadgeGoogleUrl = 'https:\/\/www\.google\.com\/search\?q=Softora\.nl\+Google\+Reviews'/);
  assert.match(source, /reviewBadgeTrustpilotUrl = 'https:\/\/www\.trustpilot\.com\/review\/softora\.nl'/);
  assert.match(source, /softora-dialog-badge-row--reviews/);
  assert.match(source, /aria-label="Google Reviews openen"/);
  assert.match(source, /aria-label="Trustpilot openen"/);
  assert.match(source, /width="184" height="46"/);
  assert.match(source, /REVIEWPROFIEL/);
  assert.match(source, /REVIEWS/);
  assert.doesNotMatch(source, /reviewBadgeGoogleUrl = 'https:\/\/www\.google\.com\/maps'/);
  assert.doesNotMatch(source, /reviewBadgeTrustpilotUrl = 'https:\/\/www\.trustpilot\.com'/);
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
});

test('premium actieve opdrachten start snel met server-bootstrap en korte boot-loader', () => {
  const { bootScriptSource, scriptSource } = readActiveOrdersSources();

  assert.match(bootScriptSource, /const ACTIVE_ORDERS_BOOTSTRAP_SCRIPT_ID = 'softoraActiveOrdersBootstrap';/);
  assert.match(bootScriptSource, /const ACTIVE_ORDERS_BOOT_MIN_MS = 650;/);
  assert.match(bootScriptSource, /function readChunkedStateValue\(values, baseKey\) \{/);
  assert.match(bootScriptSource, /function hydrateRemoteUiStateFromBootstrap\(currentCache, setCache\) \{/);
  assert.match(bootScriptSource, /root\.SoftoraPremiumBoot\.setShellBooting\(false\)/);
  assert.match(bootScriptSource, /releasePremiumDashboardBootShellAfterMinimum\(startedAt, ACTIVE_ORDERS_BOOT_MIN_MS\)/);
  assert.match(scriptSource, /boot\.startWatchdog\?\.\(\);/);
  assert.match(scriptSource, /boot\.hydrateRemoteUiStateFromBootstrap\(remoteUiStateCache,/);
  assert.match(scriptSource, /await initializeActiveOrdersPageState\(\{ loadRemote: !hadBootstrap \}\);/);
  assert.match(scriptSource, /boot\.releaseAfterMinimum/);
  assert.match(scriptSource, /loadRemoteUiState\(\{ force: true \}\)\.then/);
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
  assert.match(source, /<select class="create-order-select" id="newOrderAssignee" name="assignee" required>/);
  assert.match(source, /<option value="">Kies medewerker<\/option>\s*<option value="Martijn">Martijn<\/option>\s*<option value="Servé">Servé<\/option>/);
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

function loadDatabaseImportClient() {
  const importScriptPath = path.join(__dirname, '../../assets/premium-database-import.js');
  const source = fs.readFileSync(importScriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseImport;
}

function loadDatabaseDeepSearchClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-deep-search.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = {
    window: {},
    Buffer,
    setTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, rows: [] }) }),
  };
  sandbox.window.confirm = () => true;
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseDeepSearch;
}

function readDefaultDeepSearchTargetLines(source) {
  const match = source.match(/const DEFAULT_TARGET_TEXT_BASE64 = \[([\s\S]*?)\]\.join\(""\);/);
  assert.ok(match, 'DEFAULT_TARGET_TEXT_BASE64 should be present');
  const chunks = Array.from(match[1].matchAll(/"([^"]*)"/g), (chunk) => chunk[1]);
  assert.ok(chunks.length > 1, 'DEFAULT_TARGET_TEXT_BASE64 should be chunked');
  return Buffer.from(chunks.join(''), 'base64').toString('utf8').split(/\r?\n/).filter(Boolean);
}

test('premium database page bootstraps customer rows before async sync runs', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->/);
  assert.match(pageSource, /function readCustomersBootstrapPayload\(\)/);
  assert.match(pageSource, /document\.getElementById\("softoraCustomersBootstrap"\)/);
  assert.match(pageSource, /function resolveBootstrapCustomers\(\)/);
  assert.match(
    pageSource,
    /const initialBootstrapCustomers = resolveBootstrapCustomers\(\);[\s\S]*state\.klanten = initialBootstrapCustomers;[\s\S]*renderPage\(\);/
  );
  assert.match(pageSource, /const hadBootstrapCustomers = state\.klanten\.length > 0;/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /function deriveCustomersFromOrders\(orders\)/);
});

  test('premium database page renders the dedicated database UI while preserving persistence hooks', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const importScriptPath = path.join(__dirname, '../../assets/premium-database-import.js');
  const photoBatchScriptPath = path.join(__dirname, '../../assets/premium-database-photo-batch.js');
  const deepSearchScriptPath = path.join(__dirname, '../../assets/premium-database-deep-search.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const importScriptSource = fs.readFileSync(importScriptPath, 'utf8');
  const photoBatchScriptSource = fs.readFileSync(photoBatchScriptPath, 'utf8');
  const deepSearchScriptSource = fs.readFileSync(deepSearchScriptPath, 'utf8');

  assert.match(pageSource, /<title>Softora \| Database<\/title>/);
  assert.match(pageSource, /family=Inter:wght@300;400;500;600&family=Oswald:wght@400;500;600;700/);
  assert.match(pageSource, /--bg: #080808;/);
  assert.match(pageSource, /--card: #0d0d0d;/);
  assert.match(pageSource, /font-family: 'Inter', sans-serif;/);
  assert.match(pageSource, /\.page-title \{[\s\S]*font-family: 'Oswald', sans-serif;/);
  assert.match(pageSource, /table-layout: fixed;/);
  assert.match(pageSource, /thead th \{[\s\S]*padding: 10px 9px;[\s\S]*letter-spacing: 1\.1px;/);
  assert.match(pageSource, /thead th:nth-child\(1\), tbody td:nth-child\(1\) \{ width: 14%; \}/);
  assert.match(pageSource, /thead th:nth-child\(8\), tbody td:nth-child\(8\) \{ width: 9%; \}/);
  assert.match(pageSource, /thead th:nth-child\(9\), tbody td:nth-child\(9\) \{[\s\S]*width: 5%;[\s\S]*padding-left: 7px;[\s\S]*padding-right: 7px;/);
  assert.match(pageSource, /\.photo-drop \{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(pageSource, /\.photo-remove \{[\s\S]*width: 14px;[\s\S]*height: 14px;/);
  assert.match(pageSource, /text-overflow: ellipsis;/);
  assert.match(pageSource, /\.company-edit/);
  assert.match(pageSource, /\.company-edit \{[\s\S]*width: 22px;[\s\S]*height: 22px;[\s\S]*border: none;[\s\S]*background: none;[\s\S]*color: var\(--light\);/);
  assert.match(pageSource, /\.company-edit:hover \{[\s\S]*color: var\(--crimson\);/);
  assert.match(pageSource, /\.photo-remove/);
  assert.match(pageSource, /\.photo-remove \{[\s\S]*position: absolute;[\s\S]*right: 2px;/);
  assert.match(pageSource, /class="result-count-stack" aria-label="Aantal resultaten"/);
  assert.match(pageSource, /id="photoCostLabel" aria-label="Kosten voor AI-foto's"/);
  assert.match(pageSource, /const WEBSITE_PHOTO_COST_EUR = 0\.21;/);
  assert.match(pageSource, /<strong>€0,00<\/strong>/);
  assert.match(pageSource, /\.photo-cost-label/);
  assert.match(pageSource, /<div class="modal-bg" id="photoBatchModal" aria-hidden="true">/);
  assert.match(pageSource, /id="photoBatchTitle">AI-foto's maken<\/div>/);
  assert.match(pageSource, /data-photo-batch-mode="all"/);
  assert.match(pageSource, /data-photo-batch-mode="custom"/);
  assert.match(pageSource, /id="photoBatchLimitInput" type="number" inputmode="numeric" min="1" step="1"/);
  assert.match(pageSource, /id="photoBatchSummary" aria-live="polite"/);
  assert.match(pageSource, /\.photo-batch-option\.is-active/);
  assert.match(pageSource, /function isWebdesignPhotoEligible\(customer\)/);
  assert.match(pageSource, /function formatEuroCost\(value\)/);
  assert.match(pageSource, /function renderPhotoCostLabel\(customers\)/);
  assert.match(pageSource, /eligibleCount \* WEBSITE_PHOTO_COST_EUR/);
  assert.match(pageSource, /nodes\.photoCostLabel\.innerHTML = "<strong>" \+ formatEuroCost\(totalCost\) \+ "<\/strong>";/);
  assert.match(pageSource, /URL-scan kost €0,00/);
  assert.match(pageSource, /id="generatePhotosButton"/);
  assert.match(pageSource, /class="result-count-icon"/);
  assert.match(pageSource, /<div class="page-title">Database<\/div>/);
  assert.doesNotMatch(pageSource, /AI-database/i);
  assert.doesNotMatch(pageSource, /ai-database-badge/);
  assert.match(pageSource, /<button class="btn prim has-caret" id="addButton" type="button" aria-haspopup="menu" aria-expanded="false">[\s\S]*Acties/);
  assert.match(pageSource, /<div class="add-actions-menu" id="addActionsMenu" role="menu">[\s\S]*Volgende locatie doorzoeken[\s\S]*AI werkt de huidige plek automatisch af/);
  assert.doesNotMatch(pageSource, /100 bedrijven toevoegen/);
  assert.doesNotMatch(pageSource, />Uploaden</);
  assert.doesNotMatch(pageSource, />Google Sheet koppelen</);
  assert.doesNotMatch(pageSource, />Handmatig toevoegen</);
  assert.doesNotMatch(pageSource, /id="addWebdesignButton"/);
  assert.match(pageSource, /<input type="text" id="q" placeholder="Zoek op bedrijfsnaam…">/);
  assert.doesNotMatch(pageSource, /id="f-branche"/);
  assert.doesNotMatch(pageSource, /class="filter-select-group"/);
  assert.doesNotMatch(pageSource, /nodes\.branch/);
  assert.doesNotMatch(pageSource, /activeBranch/);
  assert.doesNotMatch(pageSource, /<th data-sort-key="branche">Branche<\/th>/);
  assert.match(pageSource, /<th data-sort-key="email">Mailadres<\/th>/);
  assert.match(pageSource, /<th data-sort-key="tel">Telefoonnummer<\/th>/);
  assert.match(pageSource, /<th data-sort-key="dom">Website<\/th>/);
  assert.match(pageSource, /const websiteValue = normalizeString\(customer\.website \|\| customer\.dom\) \|\| "—";/);
  assert.match(pageSource, /class=\\"website-link\\"/);
  assert.match(pageSource, /target=\\"_blank\\" rel=\\"noopener\\"/);
  assert.match(pageSource, /escapeHtml\(customer\.email \|\| "—"\)/);
  assert.match(pageSource, /escapeHtml\(formatPhoneNumber\(customer\.tel\)\)/);
  assert.match(pageSource, /formatPhoneNumber\(raw && \(raw\.tel \|\| raw\.telefoon \|\| raw\.contactPhone\)\)/);
  assert.match(pageSource, /class=\\"company-edit\\"/);
  assert.match(pageSource, /data-edit-id=\\"/);
  assert.match(pageSource, /<th>Foto<\/th>/);
  assert.match(pageSource, /colspan=\\"9\\"/);
  assert.match(pageSource, /<input type="file" id="photoFileInput" accept="image\/\*" hidden>/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_SCOPE = "premium_database_photos";/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_KEY = "softora_database_photos_v1";/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_DATA_PREFIX = "softora_database_photo_data_v1_";/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_CHUNK_SIZE = 180000;/);
  assert.match(pageSource, /websitePhoto: normalizeString\(raw && \(raw\.websitePhoto \|\| raw\.photo \|\| raw\.websiteImage\)\)/);
  assert.match(pageSource, /function shouldShowWebsitePhoto\(customer\)/);
  assert.match(pageSource, /normalizeDatabaseStatus\(customer && customer\.status, customer\) !== "klant"/);
  assert.match(pageSource, /function renderWebsitePhotoDrop\(customer\)/);
  assert.match(pageSource, /if \(!shouldShowWebsitePhoto\(customer\)\) return "";/);
  assert.match(pageSource, /class=\\"photo-drop\\"/);
  assert.match(pageSource, /class=\\"photo-remove\\"/);
  assert.match(pageSource, /data-remove-photo-id=\\"/);
  assert.match(pageSource, /data-has-photo=\\"/);
  assert.match(pageSource, /function openWebsitePhotoPreview\(customerId\)/);
  assert.match(pageSource, /function prepareWebsitePhotoForStorage\(dataUrl, fileName\)/);
  assert.match(pageSource, /function removeWebsitePhotoForCustomer\(customerId\)/);
  assert.match(pageSource, /websitePhoto: ""/);
  assert.match(pageSource, /await persistCustomerPhotos\(state\.klanten\)/);
  assert.match(pageSource, /function buildCustomerPhotoDataKey\(customerId\)/);
  assert.match(pageSource, /function buildCustomerPhotoStorage\(customers\)/);
  assert.match(pageSource, /photoKey \+ "_" \+ index/);
  assert.match(pageSource, /chunkCount: chunks\.length/);
  assert.match(pageSource, /function persistCustomerPhotos\(customers\)/);
  assert.match(pageSource, /function mergeCustomersWithPhotos\(customers, photoMap\)/);
  assert.match(pageSource, /function loadCustomerPhotoMap\(\)/);
  assert.match(pageSource, /compressWebsitePhotoDataUrl\(original\.dataUrl, original\.fileName, 2160, 3840, 0\.9\)/);
  assert.match(pageSource, /compressWebsitePhotoDataUrl\(original\.dataUrl, original\.fileName, 1024, 1536, 0\.82\)/);
  assert.match(pageSource, /<div class="photo-preview" id="photoPreview"/);
  assert.match(pageSource, /function readImageFileAsDataUrl\(file\)/);
  assert.match(pageSource, /function saveWebsitePhotoForCustomer\(customerId, file\)/);
  assert.match(pageSource, /function normalizeWebsiteCandidateUrl\(value\)/);
  assert.match(pageSource, /parsed\.hostname\.indexOf\("\."\) === -1/);
  assert.match(pageSource, /function isGeneratedFallbackDomain\(customer, value\)/);
  assert.match(pageSource, /domain === slugifyDomain\(websiteText\)\.toLowerCase\(\)/);
  assert.doesNotMatch(pageSource, /domain === slugifyDomain\(customer && customer\.bedrijf\)/);
  assert.match(pageSource, /const websiteUrl = normalizeWebsiteCandidateUrl\(customer && customer\.website\);/);
  assert.match(pageSource, /!isGeneratedFallbackDomain\(customer, customer && customer\.dom\)/);
  assert.match(pageSource, /function buildWebsitePreviewUrlCandidates\(customer\)/);
  assert.match(pageSource, /withWww\.hostname = "www\." \+ parsed\.hostname;/);
  assert.match(pageSource, /function getWebdesignPhotoTargets\(limit\)/);
  assert.match(pageSource, /targets\.slice\(0, Math\.min\(parsedLimit, targets\.length\)\)/);
  assert.match(pageSource, /assets\/premium-database-photo-batch\.js\?v=20260427a/);
  assert.match(pageSource, /assets\/premium-database-deep-search\.js\?v=20260427e/);
  assert.match(pageSource, /const photoBatchController = window\.SoftoraDatabasePhotoBatch\.createController\(\{/);
  assert.match(photoBatchScriptSource, /function createController\(options\)/);
  assert.match(photoBatchScriptSource, /function open\(\)/);
  assert.match(photoBatchScriptSource, /function resolveSelection\(\)/);
  assert.match(photoBatchScriptSource, /void generate\(selection\.limit\);/);
  assert.match(pageSource, /function generateWebdesignPhotos\(limit\)/);
  assert.match(pageSource, /return isWebdesignPhotoEligible\(customer\);/);
  assert.match(pageSource, /Webdesign maken voor " \+ target\.bedrijf/);
  assert.doesNotMatch(pageSource, /AI-foto maken voor " \+ target\.bedrijf/);
  assert.match(pageSource, /Geen AI-foto's opgeslagen: /);
  assert.match(pageSource, /fetch\("\/api\/website-preview\/generate"/);
  assert.match(pageSource, /company: customer\.bedrijf/);
  assert.match(pageSource, /source: "premium-database"/);
  assert.match(pageSource, /action: "webdesign"/);
  assert.match(pageSource, /nodes\.generatePhotosButton\.addEventListener\("click"/);
  assert.match(pageSource, /photoBatchController\.open\(\);/);
  assert.match(pageSource, /photoBatchController\.bind\(\);/);
  assert.match(photoBatchScriptSource, /nodes\.startPhotoBatchButton\.addEventListener\("click", start\);/);
  assert.match(pageSource, /function openEditCustomerModal\(customerId\)/);
  assert.match(pageSource, /function updateCustomerFromModal\(customerId, bedrijf\)/);
  assert.match(pageSource, /state\.modalEditId/);
  assert.match(pageSource, /nodes\.modalTitle\.textContent = "Bedrijf aanpassen"/);
  assert.match(pageSource, /nodes\.saveModalButton\.textContent = "Opslaan"/);
  assert.match(pageSource, /openEditCustomerModal\(editButton\.getAttribute\("data-edit-id"\)\)/);
  assert.match(pageSource, /removeWebsitePhotoForCustomer\(removePhotoButton\.getAttribute\("data-remove-photo-id"\)\)/);
  assert.match(pageSource, /nodes\.tbody\.addEventListener\("drop"/);
  assert.match(pageSource, /<tbody id="tbody"><\/tbody>/);
  assert.match(pageSource, /<div class="panel" id="panel" aria-hidden="true">/);
  assert.match(pageSource, /<textarea class="p-ta" id="p-nota"/);
  assert.doesNotMatch(pageSource, /class=\\"c-domain\\"/);
  assert.doesNotMatch(pageSource, /<div class="p-s-title">Gegevens<\/div>/);
  assert.doesNotMatch(pageSource, /<div class="p-s-title">Status wijzigen<\/div>/);
  assert.doesNotMatch(pageSource, /<div class="p-s-title">Tijdlijn<\/div>/);
  assert.match(pageSource, /<select class="msel" id="m-responsible">[\s\S]*Servé[\s\S]*Martijn/);
  assert.match(pageSource, /function parseResponsibleValue\(value\)/);
  assert.match(pageSource, /function normalizeResponsibleValue\(value\)/);
  assert.match(pageSource, /function formatResponsibleDisplayName\(value\)/);
  assert.match(pageSource, /function getResponsibleSourceValue\(raw\)/);
  assert.match(pageSource, /function openPanel\(id\)/);
  assert.match(pageSource, /nodes\.panelSub\.textContent = customer\.stad;/);
  assert.doesNotMatch(pageSource, /nodes\.panelSub\.textContent = customer\.dom \+ " · " \+ customer\.stad;/);
  assert.match(
    pageSource,
    /nodes\.topSub\.innerHTML = "De AI koppelt alle data slim aan elkaar, zodat klanten, lopende gesprekken en mensen die geen interesse hebben<br>of niet meer benaderd willen worden automatisch worden uitgesloten van dubbele of onnodige opvolging\.";/
  );
  assert.match(pageSource, /function saveNota\(\)/);
  assert.doesNotMatch(pageSource, /function applyPanelStatus\(\)/);
  assert.match(pageSource, /function addCustomerFromModal\(\)/);
  assert.match(pageSource, /<script src="assets\/premium-database-import\.js\?v=20260427b"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-database-deep-search\.js\?v=20260427e"><\/script>/);
  assert.match(pageSource, /<input type="file" id="importFileInput" accept="\.csv,text\/csv,\.tsv,text\/tab-separated-values,\.xlsx,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet" hidden>/);
  assert.match(pageSource, /const CUSTOMER_DB_SYNC_KEY = "softora_customers_database_sync_v1";/);
  assert.match(pageSource, /const CUSTOMER_DB_DEEP_SEARCH_KEY = "softora_customers_deep_search_v1";/);
  assert.match(pageSource, /const CUSTOMER_DB_SYNC_INTERVAL_MS = 60 \* 1000;/);
  assert.match(pageSource, /<div class="modal-bg" id="deepSearchModal" aria-hidden="true">/);
  assert.doesNotMatch(pageSource, /id="deepSearchListInput"/);
  assert.match(pageSource, /id="deepSearchCost"/);
  assert.match(pageSource, /id="deepSearchStartButton" type="button">Locatie starten<\/button>/);
  assert.doesNotMatch(pageSource, /deepSearchDoneButton/);
  assert.doesNotMatch(pageSource, /Deze plek afronden/);
  assert.doesNotMatch(pageSource, /deepSearchResetButton/);
  assert.doesNotMatch(pageSource, /Leegmaken/);
  assert.doesNotMatch(pageSource, />Sluiten<\/button>/);
  assert.match(pageSource, /class="deep-search-close" id="closeDeepSearchButton" type="button" aria-label="Sluit bedrijvenlijst"/);
  assert.match(pageSource, /id="deepSearchTitle">Bedrijvenlijst<\/div>/);
  assert.match(pageSource, /\.deep-search-target\.is-done span \{[\s\S]*text-decoration: line-through;/);
  assert.match(pageSource, /id="deepSearchSources"/);
  assert.match(pageSource, /const pickRecordValue = window\.SoftoraDatabaseImport\.pickRecordValue;/);
  assert.match(pageSource, /const databaseImportController = window\.SoftoraDatabaseImport\.createController\(\{/);
  assert.match(pageSource, /syncRows: syncCustomersFromRows/);
  assert.match(pageSource, /syncKey: CUSTOMER_DB_SYNC_KEY/);
  assert.match(pageSource, /nodes\.importFileInput\.addEventListener\("change", databaseImportController\.handleFileChange\)/);
  assert.doesNotMatch(pageSource, /nodes\.addSyncButton\.addEventListener\("click"/);
  assert.doesNotMatch(pageSource, /addRealBusinessesButton: document\.getElementById\("addRealBusinessesButton"\)/);
  assert.match(pageSource, /realBusinessButton: null/);
  assert.match(pageSource, /const databaseDeepSearchController = window\.SoftoraDatabaseDeepSearch\.createController\(\{/);
  assert.match(pageSource, /stateKey: CUSTOMER_DB_DEEP_SEARCH_KEY/);
  assert.match(pageSource, /importRows: importCustomersFromRows/);
  assert.match(pageSource, /databaseDeepSearchController\.bind\(\);/);
  assert.match(pageSource, /nodes\.deepSearchButton\.addEventListener\("click"/);
  assert.match(pageSource, /databaseDeepSearchController\.open\(\);/);
  assert.match(deepSearchScriptSource, /function parseTargetLines\(raw\)/);
  assert.match(deepSearchScriptSource, /DEFAULT_TARGET_TEXT/);
  assert.match(deepSearchScriptSource, /DEFAULT_TARGET_TEXT_BASE64/);
  assert.match(deepSearchScriptSource, /function decodeBase64Utf8\(value\)/);
  const defaultTargetLines = readDefaultDeepSearchTargetLines(deepSearchScriptSource);
  assert.equal(defaultTargetLines.length, 2501);
  assert.equal(defaultTargetLines[0], 'Nederland | Noord-Brabant | Altena | Almkerk');
  assert.ok(defaultTargetLines.includes('Nederland | Noord-Brabant | Altena | Woudrichem'));
  assert.ok(defaultTargetLines.includes('Nederland | Zuid-Holland | Zwijndrecht | Zwijndrecht'));
  assert.match(deepSearchScriptSource, /fetch\("\/api\/premium-database\/deep-search-businesses"/);
  assert.match(deepSearchScriptSource, /DEEP_SEARCH_BATCH_SIZE = 100/);
  assert.match(deepSearchScriptSource, /count: DEEP_SEARCH_BATCH_SIZE/);
  assert.match(deepSearchScriptSource, /function runTargetBatch\(target\)/);
  assert.match(deepSearchScriptSource, /function runTargetUntilComplete\(target\)/);
  assert.match(deepSearchScriptSource, /REQUIRED_EMPTY_COMPLETION_ROUNDS = 1/);
  assert.match(deepSearchScriptSource, /function isTargetCompletionConfirmed\(target, result\)/);
  assert.match(deepSearchScriptSource, /AI gaat automatisch door met dezelfde locatie/);
  assert.match(deepSearchScriptSource, /AI gaf al klaar aan/);
  assert.match(deepSearchScriptSource, /Deze locatie loopt al\. Wacht tot de AI hem automatisch afrondt\./);
  assert.doesNotMatch(deepSearchScriptSource, /100 bedrijven toevoegen/);
  assert.match(deepSearchScriptSource, /\? "Nu: " \+ target\.label/);
  assert.doesNotMatch(deepSearchScriptSource, /"Nu: " \+ target\.label \+ " · " \+ target\.batches/);
  assert.doesNotMatch(deepSearchScriptSource, /STATUS_LABELS/);
  assert.doesNotMatch(deepSearchScriptSource, /item\.batches \+ "x/);
  assert.doesNotMatch(deepSearchScriptSource, /item\.added \+ " nieuw/);
  assert.match(deepSearchScriptSource, /Geschatte API-kosten/);
  assert.match(deepSearchScriptSource, /function formatUsdAsEuro\(value\)/);
  assert.match(deepSearchScriptSource, /USD_TO_EUR_RATE = 0\.93/);
  assert.match(deepSearchScriptSource, /ESTIMATED_BATCH_PRICING/);
  assert.match(deepSearchScriptSource, /function advanceCompletedTarget\(target\)/);
  assert.match(deepSearchScriptSource, /Boolean\(body && body\.placeComplete\)/);
  assert.doesNotMatch(deepSearchScriptSource, /function markCurrentDone\(\)/);
  assert.doesNotMatch(deepSearchScriptSource, /resetState/);
  assert.match(deepSearchScriptSource, /source: "premium-database-deep-search"/);
  assert.match(importScriptSource, /function readRealBusinessRows\(query\)/);
  assert.match(importScriptSource, /fetch\("\/api\/premium-database\/add-real-businesses"/);
  assert.match(importScriptSource, /count: 100/);
  assert.match(importScriptSource, /function handleRealBusinessAdd\(\)/);
  assert.doesNotMatch(pageSource, /nodes\.addRealBusinessesButton\.addEventListener\("click"/);
  assert.doesNotMatch(pageSource, /databaseImportController\.handleRealBusinessAdd\(\)/);
  assert.match(pageSource, /void databaseImportController\.startAutoSync\(\);/);
  assert.match(pageSource, /record, \["bedrijf", "bedrijfsnaam", "company", "company name", "organisatie", "naam bedrijf"\]/);
  assert.match(pageSource, /record, \["telefoonnummer", "telefoon", "tel", "phone", "phone number"\]/);
  assert.match(importScriptSource, /function detectDelimitedSeparator\(text, preferredSeparator\)/);
  assert.match(importScriptSource, /function parseDelimitedRows\(raw, preferredSeparator\)/);
  assert.match(importScriptSource, /function pickRecordValue\(record, keys\)/);
  assert.match(importScriptSource, /function isExcelImportFile\(file\)/);
  assert.match(importScriptSource, /function readLinkedSpreadsheetRows\(sourceUrl\)/);
  assert.match(importScriptSource, /fetch\("\/api\/premium-database\/sync-spreadsheet"/);
  assert.match(importScriptSource, /function mergeCustomers\(existingCustomers, importedCustomers, options\)/);
  assert.match(importScriptSource, /function handleSyncConnect\(\)/);
  assert.match(importScriptSource, /function startAutoSync\(\)/);
  assert.match(importScriptSource, /fetch\("\/api\/premium-database\/import-spreadsheet"/);
  assert.match(importScriptSource, /resolve\(Array\.isArray\(body\.rows\) \? body\.rows : \[\]\)/);
  assert.match(pageSource, /function exportCSV\(\)/);
  assert.match(pageSource, /function renderUsedChannelTags\(customer\)/);
  assert.match(pageSource, /const COLDMAIL_TEST_COMPANIES = \["mcv e-commerce"\];/);
  assert.match(pageSource, /function isColdmailTestCompany\(customer\)/);
  assert.match(pageSource, /storedStatus === "gemaild" \? "benaderbaar" : storedStatus/);
  assert.match(pageSource, /if \(isColdmailTestCompany\(customer\)\) return false;/);
  assert.match(pageSource, /Cold calling/);
  assert.match(pageSource, /Cold mailing/);
  assert.match(pageSource, /Nog geen acties/);
  assert.match(pageSource, /Testversie/);
  assert.doesNotMatch(pageSource, />Bellen<\/span>/);
  assert.doesNotMatch(pageSource, />Mailen<\/span>/);
  assert.match(pageSource, /fetchUiStateSetWithFallback\(CUSTOMER_DB_SCOPE/);
  assert.match(pageSource, /source: "premium-database"/);
  assert.match(pageSource, /actor: "Premium database"/);
  assert.match(pageSource, /Database-voorbeeld uit actieve opdrachten\. Voeg klanten toe om ze permanent op te slaan\./);
  assert.doesNotMatch(pageSource, /await persistCustomerList\(importedCustomers\)/);
  assert.doesNotMatch(pageSource, /id="restoreKnownCustomersButton"/);
  assert.doesNotMatch(pageSource, /Vaste klanten herstellen/);
  assert.doesNotMatch(pageSource, /function restoreKnownCustomers\(\)/);
  assert.doesNotMatch(pageSource, /function syncKnownCustomerStatuses\(customers\)/);
  assert.doesNotMatch(pageSource, /const statusSync = syncKnownCustomerStatuses\(customersWithPhotos\);/);
  assert.doesNotMatch(pageSource, /Bekende klantstatussen opslaan mislukt/);
  assert.doesNotMatch(pageSource, /let syncedCount = 0;/);
  assert.doesNotMatch(pageSource, /label: "Status hersteld"/);
  assert.doesNotMatch(pageSource, /function isKnownBadOrderFallbackCustomer\(customer\)/);
  assert.doesNotMatch(pageSource, /Vaste klanten hersteld, statussen bijgewerkt en verkeerde rijen verwijderd\./);
});

test('premium database page exposes interesse as a lead-status step', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(
    pageSource,
    /<button class="sf-btn act" data-s="alle" type="button">Alle<\/button>\s*<button class="sf-btn" data-s="klant" type="button">Klant<\/button>\s*<button class="sf-btn" data-s="gebeld" type="button">Gebeld<\/button>\s*<button class="sf-btn" data-s="gemaild" type="button">Gemaild<\/button>\s*<button class="sf-btn" data-s="afspraak" type="button">Afspraak<\/button>\s*<button class="sf-btn" data-s="interesse" type="button">Interesse<\/button>\s*<button class="sf-btn" data-s="afgehaakt" type="button">Afgehaakt<\/button>\s*<button class="sf-btn" data-s="geengehoor" type="button">Geen gehoor<\/button>\s*<button class="sf-btn" data-s="benaderbaar" type="button">Benaderbaar<\/button>\s*<button class="sf-btn" data-s="buiten" type="button">Buiten gebruik<\/button>\s*<button class="sf-btn" data-s="geblokkeerd" type="button">Geen interesse<\/button>/
  );
  assert.match(pageSource, /<option value="interesse">Interesse<\/option>/);
  assert.match(pageSource, /<option value="afgehaakt">Afgehaakt<\/option>/);
  assert.match(pageSource, /const DATABASE_STATUS_OPTIONS = \[[^\]]*"interesse"[^\]]*\];/);
  assert.match(pageSource, /const DATABASE_STATUS_OPTIONS = \[[^\]]*"afgehaakt"[^\]]*\];/);
  assert.match(pageSource, /interesse: "Interesse getoond"/);
  assert.match(pageSource, /afgehaakt: "Afgehaakt na interesse"/);
  assert.match(pageSource, /interesse: "Interesse"/);
  assert.match(pageSource, /afgehaakt: "Afgehaakt"/);
  assert.match(pageSource, /\.s-interesse \.s-label \{ color: var\(--green\); font-weight: 700; \}/);
  assert.match(pageSource, /\.s-afgehaakt \.s-label \{ color: var\(--red\); font-weight: 700; \}/);
});

test('premium database sync merge updates contact fields and preserves CRM fields', () => {
  const importClient = loadDatabaseImportClient();
  const existingCustomers = [
    {
      id: 'customer-1',
      bedrijf: 'Acme BV',
      naam: 'Acme BV',
      dom: 'old-acme.nl',
      website: 'https://old-acme.nl',
      tel: '06 12 34 56 78',
      email: 'oud@acme.nl',
      branche: 'Overig',
      stad: 'Breda',
      service: 'website',
      verantwoordelijk: 'Serve',
    },
  ];
  const importedCustomers = [
    {
      bedrijf: 'Acme BV',
      naam: 'Acme Team',
      dom: 'acme.nl',
      website: 'https://www.acme.nl/nieuw',
      tel: '0612345678',
      email: 'info@acme.nl',
      branche: 'Bouw',
      stad: 'Breda',
      service: 'software',
      verantwoordelijk: 'Martijn',
    },
    {
      bedrijf: 'Acme BV',
      dom: 'acme.nl',
      website: 'https://www.acme.nl/nieuw',
      tel: '',
      email: 'info@acme.nl',
      stad: '',
      verantwoordelijk: 'Martijn',
    },
  ];

  const result = importClient.mergeCustomers(existingCustomers, importedCustomers, {
    updateExisting: true,
  });

  assert.equal(result.addedCount, 0);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0].id, 'customer-1');
  assert.equal(result.customers[0].email, 'info@acme.nl');
  assert.equal(result.customers[0].website, 'https://www.acme.nl/nieuw');
  assert.equal(result.customers[0].naam, 'Acme BV');
  assert.equal(result.customers[0].branche, 'Overig');
  assert.equal(result.customers[0].service, 'website');
  assert.equal(result.customers[0].verantwoordelijk, 'Serve');
});

test('premium database deep search client keeps a clean ordered target list', () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();

  assert.deepEqual(
    Array.from(deepSearchClient.parseTargetLines(
      [
        '1. Nederland | Noord-Brabant | Altena | Almkerk',
        '- Nederland | Noord-Brabant | Altena | Woudrichem',
        'Nederland | Noord-Brabant | Altena | Almkerk',
        '',
      ].join('\n')
    )),
    [
      'Nederland | Noord-Brabant | Altena | Almkerk',
      'Nederland | Noord-Brabant | Altena | Woudrichem',
    ]
  );
});

test('premium database deep search client finishes the current location automatically', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const calls = [];
  const messages = [];
  const customers = [];
  const persisted = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Almkerk Test BV', 'Kerkstraat 1, Almkerk', 'info@almkerktest.nl', '0183 123 456', 'almkerktest.nl'],
  ];
  const responses = [
    {
      ok: true,
      rows,
      businesses: [{ bedrijfsnaam: 'Almkerk Test BV', email: 'info@almkerktest.nl', website: 'almkerktest.nl' }],
      found: 1,
      placeComplete: true,
      cost: { estimatedUsd: 0.12 },
      sources: [],
    },
    {
      ok: true,
      rows: [rows[0]],
      businesses: [],
      found: 0,
      placeComplete: true,
      cost: { estimatedUsd: 0.08 },
      sources: [],
    },
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchList: {},
      deepSearchSources: {},
      deepSearchStartButton: {},
      deepSearchStats: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    autoContinueDelayMs: 0,
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.push(...receivedRows.slice(1).map((row) => ({ bedrijf: row[0], email: row[2], website: row[4] })));
    },
    readDeepSearchRows: async (payload) => {
      calls.push(payload);
      return responses.shift();
    },
    setStatusMessage: (message) => {
      messages.push(message);
    },
    setUiState: async (_scope, payload) => {
      persisted.push(payload);
      return { ok: true };
    },
  });

  const result = await controller.runCurrentSearch();

  assert.equal(result, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].target, 'Nederland | Noord-Brabant | Altena | Almkerk');
  assert.equal(calls[0].count, 100);
  assert.equal(calls[0].batchNumber, 1);
  assert.equal(calls[1].target, calls[0].target);
  assert.equal(calls[1].batchNumber, 2);
  assert.equal(customers.length, 1);
  assert.match(messages.join('\n'), /AI gaf al klaar aan/);
  assert.match(messages.join('\n'), /Deze plaats is automatisch afgerond/);
  assert.ok(persisted.length >= 2);
});

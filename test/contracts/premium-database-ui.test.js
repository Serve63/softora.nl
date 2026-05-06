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

function loadDatabaseDeepSearchClient(options = {}) {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-deep-search.js');
  const distanceScriptPath = path.join(__dirname, '../../assets/premium-database-distance.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const distanceSource = fs.readFileSync(distanceScriptPath, 'utf8');
  const sandbox = {
    window: {},
    Buffer,
    setTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, rows: [] }) }),
  };
  if (options.document) sandbox.window.document = options.document;
  sandbox.window.confirm = () => true;
  vm.runInNewContext(distanceSource, sandbox);
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseDeepSearch;
}

function loadDatabasePhotoStorageClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-photo-storage.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabasePhotoStorage;
}

function loadDatabaseDistanceClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-distance.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraPremiumDatabaseDistance;
}

function readDefaultDeepSearchTargetLines(source) {
  const match = source.match(/const DEFAULT_TARGET_TEXT_BASE64 = \[([\s\S]*?)\]\.join\(""\);/);
  assert.ok(match, 'DEFAULT_TARGET_TEXT_BASE64 should be present');
  const chunks = Array.from(match[1].matchAll(/"([^"]*)"/g), (chunk) => chunk[1]);
  assert.ok(chunks.length > 1, 'DEFAULT_TARGET_TEXT_BASE64 should be chunked');
  return Buffer.from(chunks.join(''), 'base64').toString('utf8').split(/\r?\n/).filter(Boolean);
}

function getStoredTargetProgress(storedState, index = 0) {
  assert.ok(Array.isArray(storedState.targetProgress), 'deep-search state should use compact targetProgress');
  return storedState.targetProgress.find((target) => target.index === index);
}

function createClassListNode() {
  const classes = new Set();
  return {
    attributes: {},
    disabled: false,
    innerHTML: '',
    textContent: '',
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
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
    /const initialBootstrapCustomers = resolveBootstrapCustomers\(\);[\s\S]*state\.klanten = sortCustomers\(initialBootstrapCustomers\);[\s\S]*renderPage\(\);/
  );
  assert.match(pageSource, /const hadBootstrapCustomers = state\.klanten\.length > 0;/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /function isDerivedOrderPlaceholderCustomer\(customer\)/);
  assert.match(pageSource, /customersBootstrapPayload && customersBootstrapPayload\.source\) === "orders"[\s\S]*return \[\];/);
});

test('premium database page keeps customers fixed from Oisterwijk nearby to far away', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const distanceClient = loadDatabaseDistanceClient();

  const sorted = distanceClient.sortCustomersByDistance([
    { bedrijf: 'Roosendaal Zaak', stad: 'Markt 1, 4701 PE Roosendaal' },
    { bedrijf: 'Oisterwijk Winkel', stad: 'Dorpsstraat 1, 5061 AA Oisterwijk' },
    { bedrijf: 'Chaam Garage', stad: 'Florijnstraat 2, 4861 BW Chaam' },
    { bedrijf: 'Alphen Service', stad: 'Baarleseweg 69, 5131 BB Alphen (N.Br)' },
    { bedrijf: 'Onbekend Ver Weg', stad: 'Onbekend' },
  ]);

  assert.deepEqual(
    sorted.map((customer) => customer.bedrijf),
    ['Oisterwijk Winkel', 'Alphen Service', 'Chaam Garage', 'Roosendaal Zaak', 'Onbekend Ver Weg']
  );
  assert.match(pageSource, /assets\/premium-database-distance\.js\?v=20260506a/);
  assert.match(pageSource, /sortKey: "distance"/);
  assert.match(pageSource, /function sortCustomers\(list\) \{\s*return window\.SoftoraPremiumDatabaseDistance/);
  assert.match(pageSource, /function getSortedCustomers\(customers\) \{\s*return sortCustomers\(customers\);/);
  assert.match(pageSource, /state\.klanten = sortCustomers\(state\.klanten\.concat\(\[customer\]\)\);/);
  assert.match(pageSource, /state\.klanten = sortCustomers\(mergeResult\.customers\);/);
  assert.match(pageSource, /const normalizedCustomers = sortCustomers\(customers\)\.filter/);
  assert.doesNotMatch(pageSource, /sortKey: "manual"/);
});

  test('premium database page renders the dedicated database UI while preserving persistence hooks', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const importScriptPath = path.join(__dirname, '../../assets/premium-database-import.js');
  const photoBatchScriptPath = path.join(__dirname, '../../assets/premium-database-photo-batch.js');
  const webdesignActionScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-action.js');
  const apiCostLedgerScriptPath = path.join(__dirname, '../../assets/softora-api-cost-ledger.js');
  const photoStorageScriptPath = path.join(__dirname, '../../assets/premium-database-photo-storage.js');
  const webdesignMockupScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-mockup.js');
  const deepSearchScriptPath = path.join(__dirname, '../../assets/premium-database-deep-search.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const importScriptSource = fs.readFileSync(importScriptPath, 'utf8');
  const photoBatchScriptSource = fs.readFileSync(photoBatchScriptPath, 'utf8');
  const webdesignActionScriptSource = fs.readFileSync(webdesignActionScriptPath, 'utf8');
  const apiCostLedgerScriptSource = fs.readFileSync(apiCostLedgerScriptPath, 'utf8');
  const photoStorageScriptSource = fs.readFileSync(photoStorageScriptPath, 'utf8');
  const webdesignMockupScriptSource = fs.readFileSync(webdesignMockupScriptPath, 'utf8');
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
  assert.match(pageSource, /thead th:nth-child\(3\), tbody td:nth-child\(3\) \{ width: 15%; \}/);
  assert.match(pageSource, /thead th:nth-child\(6\), tbody td:nth-child\(6\) \{ width: 12%; \}/);
  assert.match(pageSource, /thead th:nth-child\(9\), tbody td:nth-child\(9\) \{[\s\S]*width: 7%;[\s\S]*padding-left: 7px;[\s\S]*padding-right: 7px;/);
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
  assert.match(pageSource, /id="photoBatchTitle">Webdesigns maken<\/div>/);
  assert.match(pageSource, /data-photo-batch-mode="all"/);
  assert.match(pageSource, />Alle bedrijven<\/span>/);
  assert.match(pageSource, /data-photo-batch-mode="custom"/);
  assert.match(pageSource, /id="photoBatchLimitInput" type="text" inputmode="numeric" pattern="\[0-9\]\*"/);
  assert.doesNotMatch(pageSource, /id="photoBatchLimitInput" type="number"/);
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
  assert.match(pageSource, /<button class="add-actions-item" id="deepSearchButton" type="button" role="menuitem">Bedrijven toevoegen<\/button>/);
  assert.doesNotMatch(pageSource, /Volgende locatie doorzoeken/);
  assert.doesNotMatch(pageSource, /AI werkt de huidige plek automatisch af/);
  assert.doesNotMatch(pageSource, /100 bedrijven toevoegen/);
  assert.doesNotMatch(pageSource, />Uploaden</);
  assert.doesNotMatch(pageSource, />Google Sheet koppelen</);
  assert.doesNotMatch(pageSource, />Handmatig toevoegen</);
  assert.doesNotMatch(pageSource, /id="addWebdesignButton"/);
  assert.match(pageSource, /<input type="text" id="q" placeholder="Zoek op bedrijfsnaam…">/);
  assert.doesNotMatch(pageSource, /id="f-branche"/);
  assert.doesNotMatch(pageSource, /id="m-branche"/);
  assert.doesNotMatch(pageSource, /id="m-responsible"/);
  assert.doesNotMatch(pageSource, /<label class="mlabel" for="m-branche">Branche<\/label>/);
  assert.doesNotMatch(pageSource, /<label class="mlabel" for="m-responsible">Toegewezen aan<\/label>/);
  assert.doesNotMatch(pageSource, /class="filter-select-group"/);
  assert.doesNotMatch(pageSource, /nodes\.branch/);
  assert.doesNotMatch(pageSource, /nodes\.modalBranch/);
  assert.doesNotMatch(pageSource, /nodes\.fieldResponsible/);
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
  assert.match(pageSource, /websiteMockup: normalizeString\(raw && \(raw\.websiteMockup \|\| raw\.mockup \|\| raw\.websiteMockupImage\)\)/);
  assert.match(pageSource, /function shouldShowWebsitePhoto\(customer\)/);
  assert.match(pageSource, /normalizeDatabaseStatus\(customer && customer\.status, customer\) !== "klant"/);
  assert.match(pageSource, /function renderWebsitePhotoDrop\(customer\)/);
  assert.match(pageSource, /return webdesignActionController\.render\(customer\);/);
  assert.match(pageSource, /window\.SoftoraDatabaseWebdesignAction\.createController\(\{/);
  assert.match(pageSource, /photoRestorePending: true/);
  assert.match(webdesignActionScriptSource, /if \(!shouldShowWebsitePhoto\(customer\)\) return "";/);
  assert.match(webdesignActionScriptSource, /class=\\"photo-drop/);
  assert.match(webdesignActionScriptSource, /class=\\"photo-generate-icon\\"/);
  assert.match(webdesignActionScriptSource, /photo-drop\.is-generating,\.photo-drop\.is-restoring\{cursor:wait\}/);
  assert.doesNotMatch(webdesignActionScriptSource, /photo-drop\.is-generating,\.photo-drop\.is-restoring\{cursor:wait;width:58px;height:58px\}/);
  assert.match(webdesignActionScriptSource, /photo-generate-spinner\{width:18px;height:18px/);
  assert.doesNotMatch(webdesignActionScriptSource, /class=\\"photo-generate-cost\\"/);
  assert.match(webdesignActionScriptSource, /className = "photo-generate-charge-label";/);
  assert.match(webdesignActionScriptSource, /function updateChargeLabelPositions\(\)/);
  assert.match(webdesignActionScriptSource, /querySelectorAll\("\.photo-generate-charge-label"\)/);
  assert.match(webdesignActionScriptSource, /global\.document\.body\.appendChild\(label\)/);
  assert.doesNotMatch(webdesignActionScriptSource, /CHARGE_LABEL_ID/);
  assert.match(webdesignActionScriptSource, /class=\\"photo-generate-spinner\\"/);
  assert.match(webdesignActionScriptSource, /const MOCKUP_ICON = "<svg class=\\"photo-mockup-icon\\"/);
  assert.match(webdesignActionScriptSource, /data-mockup-photo-id=\\"/);
  assert.doesNotMatch(webdesignActionScriptSource, /const mockupSlot = hasPhoto \?/);
  assert.match(webdesignActionScriptSource, /const canUseMockup = hasPhoto \|\| hasMockup;/);
  assert.match(webdesignActionScriptSource, /data-mockup-disabled=\\"/);
  assert.match(pageSource, /if \(mockupDrop\.getAttribute\("data-can-generate"\) !== "true"\) return;/);
  assert.match(webdesignMockupScriptSource, /global\.SoftoraDatabaseWebdesignMockup =/);
  assert.match(webdesignMockupScriptSource, /Laptop - iPad - iPhone/);
  assert.match(webdesignMockupScriptSource, /ensureVisibleMockups/);
  assert.doesNotMatch(webdesignActionScriptSource, /\.photo-drop:hover \.photo-generate-cost/);
  assert.match(webdesignActionScriptSource, /function formatCentCost\(value\)/);
  assert.match(webdesignActionScriptSource, /label\.textContent = formatCentCost\(costEur\);/);
  assert.match(webdesignActionScriptSource, /showChargeLabel\(\);/);
  assert.doesNotMatch(webdesignActionScriptSource, /AI-kosten/);
  assert.doesNotMatch(webdesignActionScriptSource, /Webdesign maken, kost/);
  assert.match(pageSource, /formatEuroCost, costEur: WEBSITE_PHOTO_COST_EUR/);
  assert.match(webdesignActionScriptSource, /@keyframes photoGenerateSpin/);
  assert.match(webdesignActionScriptSource, /data-can-generate=\\"/);
  assert.match(webdesignActionScriptSource, /const LIGHTNING_ICON = "<svg class=\\"photo-generate-icon\\"/);
  assert.match(webdesignActionScriptSource, /const LOADING_ICON = "<span class=\\"photo-generate-spinner\\"/);
  assert.match(webdesignActionScriptSource, /const pendingIds = new Set\(\);/);
  assert.match(webdesignActionScriptSource, /const pollTimers = new Map\(\);/);
  assert.match(webdesignActionScriptSource, /const isRestoringPhotos = typeof options\.isRestoringPhotos === "function"/);
  assert.match(webdesignActionScriptSource, /state && state\.photoRestorePending/);
  assert.match(webdesignActionScriptSource, /const isRestoring = !hasPhoto && !isPending && Boolean\(isRestoringPhotos\(customer\)\);/);
  assert.match(webdesignActionScriptSource, /const canGenerate = !hasPhoto && !isLoading && Boolean\(resolveCustomerWebsiteUrl\(customer\)\);/);
  assert.match(webdesignActionScriptSource, /const isPending = pendingIds\.has\(customer\.id\);/);
  assert.match(webdesignActionScriptSource, /if \(pendingIds\.has\(target\.id\)\) \{/);
  assert.match(webdesignActionScriptSource, /if \(isRestoringPhotos\(target\)\) \{/);
  assert.match(webdesignActionScriptSource, /schedulePoll\(job\.id, 0\);/);
  assert.doesNotMatch(webdesignActionScriptSource, /Er wordt al een webdesign gemaakt/);
  assert.match(webdesignActionScriptSource, /photo-drop" \+ \(isLoading \? " is-generating" : ""\) \+ \(isRestoring \? " is-restoring" : ""\)/);
  assert.match(webdesignActionScriptSource, /class=\\"photo-remove\\"/);
  assert.match(webdesignActionScriptSource, /data-remove-photo-id=\\"/);
  assert.match(webdesignActionScriptSource, /data-has-photo=\\"/);
  assert.match(pageSource, /function openWebsitePhotoPreview\(customerId, kind\)/);
  assert.match(pageSource, /function prepareWebsitePhotoForStorage\(dataUrl, fileName\)/);
  assert.match(pageSource, /function removeWebsitePhotoForCustomer\(customerId\)/);
  assert.match(pageSource, /websitePhoto: ""/);
  assert.match(pageSource, /websiteMockup: ""/);
  assert.match(pageSource, /persistCustomerPhotos\(state\.klanten, \{ removeCustomerIds: \[customerId\] \}\)/);
  assert.match(pageSource, /window\.SoftoraDatabasePhotoStorage\.createController\(\{/);
  assert.match(photoStorageScriptSource, /function normalizeIdSet\(values\)/);
  assert.match(photoStorageScriptSource, /function buildCurrentStorage\(customers, onlyCustomerIds\)/);
  assert.match(photoStorageScriptSource, /function loadPersistState\(\)/);
  assert.match(photoStorageScriptSource, /Databasefoto's opslaan via Supabase mislukt/);
  assert.match(photoStorageScriptSource, /persistOptions && persistOptions\.onlyCustomerIds/);
  assert.match(photoStorageScriptSource, /const removalKey = options\.removalKey \|\| \(key \+ "_removed_v1"\);/);
  assert.match(photoStorageScriptSource, /\[removalKey\]: JSON\.stringify\(removeIds\)/);
  assert.match(pageSource, /removalKey: "softora_database_photos_removed_v1"/);
  assert.match(photoStorageScriptSource, /photoKey \+ "_" \+ chunkIndex/);
  assert.match(photoStorageScriptSource, /chunkCount: chunks\.length/);
  assert.match(photoStorageScriptSource, /function mergePhotoMaps\(existing, current, removeIds\)/);
  assert.match(pageSource, /function persistCustomerPhotos\(customers, options\)/);
  assert.match(pageSource, /function mergeCustomersWithPhotos\(customers, photoMap, fallbackCustomers\)/);
  assert.match(pageSource, /fallbackPhotosById/);
  assert.match(pageSource, /websiteMockup: normalizeString\(photo\.websiteMockup \|\| normalized\.websiteMockup\)/);
  assert.match(pageSource, /mergeCustomersWithPhotos\(enrichedCustomers, photoMap, state\.klanten\)/);
  assert.match(pageSource, /function loadCustomerPhotoMap\(customers\)/);
  assert.match(pageSource, /function serializeWebsitePhotoForDiff\(value\)/);
  assert.match(pageSource, /isValidWebsitePhotoUrl\(photo\) \? "url" : ""/);
  assert.match(pageSource, /websitePhoto: serializeWebsitePhotoForDiff\(normalized\.websitePhoto\)/);
  assert.match(pageSource, /websiteMockup: serializeWebsitePhotoForDiff\(normalized\.websiteMockup\)/);
  assert.match(photoStorageScriptSource, /readChunkedData\(values, photoKey, 0\)/);
  assert.match(pageSource, /compressWebsitePhotoDataUrl\(original\.dataUrl, original\.fileName, 1440, 2160, 0\.86\)/);
  assert.match(pageSource, /compressWebsitePhotoDataUrl\(original\.dataUrl, original\.fileName, 768, 1152, 0\.74\)/);
  assert.match(pageSource, /<div class="photo-preview" id="photoPreview"/);
  const photoPreviewImageRule = pageSource.match(/\.photo-preview-image \{([\s\S]*?)\n\s*\}/);
  assert.ok(photoPreviewImageRule, 'photo preview image styling should be present');
  assert.match(photoPreviewImageRule[1], /display: block;/);
  assert.match(photoPreviewImageRule[1], /border-radius: 0;/);
  assert.match(photoPreviewImageRule[1], /background: transparent;/);
  assert.match(photoPreviewImageRule[1], /box-shadow: none;/);
  assert.doesNotMatch(photoPreviewImageRule[1], /background: #111;/);
  assert.match(pageSource, /function readImageFileAsDataUrl\(file\)/);
  assert.match(pageSource, /function saveWebsitePhotoForCustomer\(customerId, file\)/);
  assert.match(pageSource, /function normalizeWebsiteCandidateUrl\(value\)/);
  assert.match(pageSource, /parsed\.hostname\.indexOf\("\."\) === -1/);
  assert.match(pageSource, /function isGeneratedFallbackDomain\(customer, value\)/);
  assert.match(pageSource, /domain === slugifyDomain\(websiteText\)\.toLowerCase\(\)/);
  assert.doesNotMatch(pageSource, /domain === slugifyDomain\(customer && customer\.bedrijf\)/);
  assert.match(pageSource, /const websiteUrl = normalizeWebsiteCandidateUrl\(customer && customer\.website\);/);
  assert.match(pageSource, /!isGeneratedFallbackDomain\(customer, customer && customer\.dom\)/);
  assert.doesNotMatch(pageSource, /function buildWebsitePreviewUrlCandidates\(customer\)/);
  assert.doesNotMatch(pageSource, /async function generateWebsitePhotoData\(customer\)/);
  assert.match(pageSource, /function getWebdesignPhotoTargets\(limit\)/);
  assert.match(webdesignActionScriptSource, /function getCustomerById\(customerId\)/);
  assert.match(webdesignActionScriptSource, /async function generateForCustomer\(customerId\)/);
  assert.match(pageSource, /targets\.slice\(0, Math\.min\(parsedLimit, targets\.length\)\)/);
  assert.match(pageSource, /assets\/premium-database-photo-batch\.js\?v=20260429b/);
  assert.match(pageSource, /assets\/premium-database-webdesign-action\.js\?v=20260506a/);
  assert.match(pageSource, /assets\/softora-api-cost-ledger\.js\?v=20260428a/);
  assert.match(pageSource, /assets\/premium-database-photo-storage\.js\?v=20260505c/);
  assert.match(pageSource, /assets\/premium-database-webdesign-mockup\.js\?v=20260505a/);
  assert.match(pageSource, /assets\/premium-database-deep-search\.js\?v=20260506a/);
  assert.match(pageSource, /const photoBatchController = window\.SoftoraDatabasePhotoBatch\.createController\(\{/);
  assert.match(photoBatchScriptSource, /function createController\(options\)/);
  assert.match(photoBatchScriptSource, /function open\(\)/);
  assert.match(photoBatchScriptSource, /function resolveSelection\(\)/);
  assert.match(photoBatchScriptSource, /function ensureInputFocusStyles\(\)/);
  assert.match(photoBatchScriptSource, /\.photo-batch-input:focus/);
  assert.match(photoBatchScriptSource, /border-color:var\(--crimson\)/);
  assert.doesNotMatch(photoBatchScriptSource, /photoBatchLimitInput\.select\(\)/);
  assert.match(photoBatchScriptSource, /void generate\(selection\.limit, \{ silentProgress: true \}\);/);
  assert.match(pageSource, /function generateWebdesignPhotos\(limit, options\)/);
  assert.match(pageSource, /const progressSilent = Boolean\(options && options\.silentProgress\);/);
  assert.match(pageSource, /return isWebdesignPhotoEligible\(customer\);/);
  assert.match(pageSource, /Promise\.allSettled\(targets\.map\(function \(target\) \{/);
  assert.match(pageSource, /return webdesignActionController\.generateForCustomer\(target\.id\);/);
  assert.doesNotMatch(pageSource, /Webdesign maken voor " \+ target\.bedrijf/);
  assert.doesNotMatch(pageSource, /AI-foto maken voor " \+ target\.bedrijf/);
  assert.match(pageSource, /const photoResult = await persistCustomerPhotos\(state\.klanten, \{ onlyCustomerIds: \[customerId\] \}\);/);
  assert.doesNotMatch(pageSource, /onlyCustomerIds: \[target\.id\]/);
  assert.match(pageSource, /setStatusMessage\(""\);[\s\S]*Promise\.allSettled/);
  assert.doesNotMatch(pageSource, /fetch\("\/api\/website-preview\/generate"/);
  assert.match(pageSource, /nodes\.generatePhotosButton\.addEventListener\("click"/);
  assert.match(pageSource, /void webdesignActionController\.generateForCustomer\(state\.photoTargetId\);/);
  assert.match(pageSource, /renderPage: renderPage/);
  assert.match(webdesignActionScriptSource, /const JOB_ENDPOINT = "\/api\/premium-database\/webdesign-photo-jobs";/);
  assert.match(webdesignActionScriptSource, /const pendingJobs = new Map\(\);/);
  assert.match(webdesignActionScriptSource, /keepalive: true/);
  assert.match(webdesignActionScriptSource, /function resumePendingJobs\(\)/);
  assert.match(webdesignActionScriptSource, /return firstLoad;/);
  assert.match(webdesignActionScriptSource, /async function loadRunningJobs\(\)/);
  assert.match(webdesignActionScriptSource, /fetch\(JOB_ENDPOINT,/);
  assert.doesNotMatch(webdesignActionScriptSource, /localStorage/);
  assert.match(pageSource, /window\.SoftoraDatabaseWebdesignMockup\.createController\(\{/);
  assert.match(pageSource, /ensureMockupForCustomer: function \(customerId\)/);
  assert.match(pageSource, /refreshPhotos: async function \(context\)/);
  assert.match(pageSource, /const databaseBootStartedAt = Date\.now\(\), databaseHadBootstrapCustomers = initialBootstrapCustomers\.length > 0, releaseDatabaseBootShell =/);
  assert.match(pageSource, /SoftoraPremiumBootTiming\?\.release\(databaseBootStartedAt, 1000\)/);
  assert.match(webdesignActionScriptSource, /async function preloadPhotoImages\(customers, limit, timeoutMs\)/);
  assert.match(webdesignActionScriptSource, /function waitForPhotoImage\(photo, timeoutMs\)/);
  assert.match(webdesignActionScriptSource, /image\.decode\(\)\.catch\(function \(\) \{\}\)\.finally\(finish\)/);
  assert.match(pageSource, /if \(databaseHadBootstrapCustomers && state\.klanten\.length\) \{/);
  assert.match(pageSource, /const photoMap = await loadCustomerPhotoMap\(state\.klanten\);/);
  assert.match(pageSource, /state\.klanten = mergeCustomersWithPhotos\(state\.klanten, photoMap, state\.klanten\);/);
  assert.match(pageSource, /else \{\s*await bootstrapCustomers\(\);\s*\}/);
  assert.match(pageSource, /await webdesignActionController\.preloadPhotoImages\(getSortedCustomers\(getFilteredCustomers\(\)\), 16, 1200\);/);
  assert.match(pageSource, /await webdesignActionController\.preloadPhotoImages\(getSortedCustomers\(getFilteredCustomers\(\)\), 16, 1200\);[\s\S]*state\.photoRestorePending = false;[\s\S]*renderPage\(\);[\s\S]*releaseDatabaseBootShell\(\);/);
  assert.match(pageSource, /void webdesignMockupController\.ensureVisibleMockups\(getSortedCustomers\(getFilteredCustomers\(\)\), 12\)\.catch/);
  assert.doesNotMatch(pageSource, /window\.setTimeout\(function \(\) \{ resolve\(false\); \}, 850\);/);
  assert.doesNotMatch(pageSource, /releaseDatabaseBootShell\(\); void webdesignActionController\.preloadPhotoImages/);
  assert.match(pageSource, /void webdesignActionController\.resumePendingJobs\(\)\.catch/);
  assert.match(pageSource, /void bootstrapCustomers\(\)\.catch\(function \(error\) \{ console\.error\("Database sync na snelle boot mislukt:", error\); \}\);/);
  assert.doesNotMatch(pageSource, /if \(databaseHadBootstrapCustomers\) releaseDatabaseBootShell\(\); await bootstrapCustomers\(\);/);
  assert.match(webdesignActionScriptSource, /pendingIds\.add\(job\.customerId\);/);
  assert.match(webdesignActionScriptSource, /fetch\(JOB_ENDPOINT/);
  assert.match(webdesignActionScriptSource, /loading=\\"eager\\" decoding=\\"sync\\"/);
  assert.match(webdesignActionScriptSource, /preloadPhotoImages: preloadPhotoImages/);
  assert.doesNotMatch(webdesignActionScriptSource, /await generate\(\[freshTarget\]/);
  assert.match(webdesignActionScriptSource, /pendingIds\.delete\(customerId\);/);
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
  assert.doesNotMatch(pageSource, /<select class="msel" id="m-responsible">/);
  assert.match(pageSource, /assets\/premium-customers-core\.js\?v=20260428a/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
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
  assert.match(pageSource, /<script src="assets\/premium-database-import\.js\?v=20260427c"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-database-deep-search\.js\?v=20260506a"><\/script>/);
  assert.match(pageSource, /<input type="file" id="importFileInput" accept="\.csv,text\/csv,\.tsv,text\/tab-separated-values,\.xlsx,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet" hidden>/);
  assert.match(pageSource, /const CUSTOMER_DB_SYNC_KEY = "softora_customers_database_sync_v1";/);
  assert.match(pageSource, /const CUSTOMER_DB_DEEP_SEARCH_KEY = "softora_customers_deep_search_v1";/);
  assert.match(importScriptSource, /function readChunkedStateValue\(values, baseKey\)/);
  assert.match(importScriptSource, /function buildChunkedStatePatch\(baseKey, rawValue, chunkSize\)/);
  assert.match(importScriptSource, /return normalizeString\(baseKey\) \+ "_chunks_v1";/);
  assert.match(importScriptSource, /return normalizeString\(baseKey\) \+ "_chunk_";/);
  assert.match(importScriptSource, /Number\(chunkSize\) \|\| 120000/);
  assert.match(importScriptSource, /\[getChunkMetaKey\(normalizedKey\)\]: JSON\.stringify\(\{/);
  assert.match(importScriptSource, /patch\[prefix \+ index\] = chunk;/);
  assert.match(pageSource, /patch: window\.SoftoraDatabaseImport\.buildChunkedStatePatch\(CUSTOMER_DB_KEY, JSON\.stringify\(normalizedCustomers\)\)/);
  assert.match(pageSource, /parseCustomers\(window\.SoftoraDatabaseImport\.readChunkedStateValue\(remoteState && remoteState\.values, CUSTOMER_DB_KEY\)\)/);
  assert.match(pageSource, /const CUSTOMER_DB_SYNC_INTERVAL_MS = 60 \* 1000;/);
  assert.match(pageSource, /function normalizeStoredAmount\(value\)/);
  assert.match(pageSource, /databaseStatus: status,/);
  assert.match(pageSource, /websiteBedrag: normalizeStoredAmount\(raw && raw\.websiteBedrag\)/);
  assert.match(pageSource, /onderhoudPerMaand: normalizeStoredAmount\(raw && raw\.onderhoudPerMaand\)/);
  assert.match(pageSource, /bedrag: normalizeStoredAmount\(raw && raw\.bedrag\)/);
  assert.match(pageSource, /<div class="modal-bg" id="deepSearchModal" aria-hidden="true">/);
  assert.doesNotMatch(pageSource, /id="deepSearchListInput"/);
  assert.match(pageSource, /id="deepSearchCost"/);
  assert.match(pageSource, /id="deepSearchDesiredCount" type="text" inputmode="numeric" pattern="\[0-9\]\*" value="25"/);
  assert.doesNotMatch(pageSource, /id="deepSearchRounds"/);
  assert.doesNotMatch(pageSource, /data-deep-rounds=/);
  assert.match(pageSource, /id="deepSearchStartButton" type="button">Bedrijven toevoegen<\/button>/);
  assert.doesNotMatch(pageSource, /id="deepSearchStats"/);
  assert.doesNotMatch(pageSource, /deepSearchDoneButton/);
  assert.doesNotMatch(pageSource, /Deze plek afronden/);
  assert.doesNotMatch(pageSource, /deepSearchResetButton/);
  assert.doesNotMatch(pageSource, /Leegmaken/);
  assert.doesNotMatch(pageSource, />Sluiten<\/button>/);
  assert.match(pageSource, /class="deep-search-close" id="closeDeepSearchButton" type="button" aria-label="Sluit bedrijvenlijst"/);
  assert.match(pageSource, />Gevonden website's<\/label>/);
  assert.doesNotMatch(pageSource, /Bronnen laatste batch/);
  assert.match(pageSource, /id="deepSearchTitle">Bedrijvenlijst<\/div>/);
  assert.match(pageSource, /\.deep-search-target\.is-done span \{[\s\S]*text-decoration: line-through;/);
  assert.match(pageSource, /\.deep-search-tools \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(pageSource, /\.deep-search-list,\s*\.deep-search-sources \{[\s\S]*height: 320px;[\s\S]*max-height: 320px;/);
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
  assert.match(deepSearchScriptSource, /TARGET_ORDER_VERSION = "distance-oisterwijk-v1"/);
  assert.match(deepSearchScriptSource, /function getRawDefaultTargetLabels\(\)/);
  assert.match(deepSearchScriptSource, /function getDefaultTargetLabels\(\)/);
  const rawTargetLines = readDefaultDeepSearchTargetLines(deepSearchScriptSource);
  const defaultTargetLines = loadDatabaseDeepSearchClient().getDefaultTargetLabels();
  assert.equal(rawTargetLines.length, 2501);
  assert.equal(defaultTargetLines.length, 2501);
  assert.equal(defaultTargetLines[0], 'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk');
  assert.ok(defaultTargetLines.indexOf('Nederland | Noord-Brabant | Oisterwijk | Moergestel') < defaultTargetLines.indexOf('Nederland | Noord-Brabant | Altena | Almkerk'));
  assert.ok(defaultTargetLines.indexOf('Nederland | Noord-Brabant | Altena | Almkerk') < defaultTargetLines.indexOf('Nederland | Groningen | Groningen | Groningen'));
  assert.ok(defaultTargetLines.includes('Nederland | Noord-Brabant | Altena | Woudrichem'));
  assert.ok(defaultTargetLines.includes('Nederland | Zuid-Holland | Zwijndrecht | Zwijndrecht'));
  assert.match(deepSearchScriptSource, /fetch\("\/api\/premium-database\/deep-search-businesses"/);
  assert.match(deepSearchScriptSource, /DEEP_SEARCH_BATCH_SIZE = 100/);
  assert.match(deepSearchScriptSource, /DEFAULT_DESIRED_COMPANY_COUNT = 25/);
  assert.match(deepSearchScriptSource, /MAX_DESIRED_COMPANY_COUNT = 500/);
  assert.match(deepSearchScriptSource, /function normalizeDesiredCompanyCount\(value\)/);
  assert.match(deepSearchScriptSource, /count: requestCount/);
  assert.match(deepSearchScriptSource, /function runTargetBatch\(target, requestedCount\)/);
  assert.match(deepSearchScriptSource, /function runTargetUntilComplete\(target, session\)/);
  assert.match(deepSearchScriptSource, /function runUntilDesiredCompanyCount\(session\)/);
  assert.match(deepSearchScriptSource, /Gewenste aantal gehaald/);
  assert.match(deepSearchScriptSource, /function buildCompletedSessionButtonLabel\(summary\)/);
  assert.match(deepSearchScriptSource, /function getTargetLocationName\(label\)/);
  assert.match(deepSearchScriptSource, /setCompletedSessionSummary\(target, targetSessionAddedCount\);/);
  assert.match(deepSearchScriptSource, /classList\.toggle\("is-session-complete", isSessionComplete\)/);
  assert.match(deepSearchScriptSource, /#deepSearchStartButton\.is-session-complete:disabled/);
  assert.match(deepSearchScriptSource, /box-shadow: inset 0 0 0 1px rgba\(63, 143, 90, 0\.34\);/);
  assert.doesNotMatch(deepSearchScriptSource, /const ROUND_MODES/);
  assert.doesNotMatch(deepSearchScriptSource, /function normalizeRoundMode/);
  assert.doesNotMatch(deepSearchScriptSource, /function renderRoundControls/);
  assert.doesNotMatch(deepSearchScriptSource, /Ronde-limiet bereikt/);
  assert.match(deepSearchScriptSource, /REQUIRED_EMPTY_COMPLETION_ROUNDS = 1/);
  assert.match(deepSearchScriptSource, /function isTargetCompletionConfirmed\(target, result\)/);
  assert.doesNotMatch(deepSearchScriptSource, /AI gaat automatisch door met dezelfde locatie/);
  assert.doesNotMatch(deepSearchScriptSource, /AI gaf al klaar aan/);
  assert.match(deepSearchScriptSource, /Deze locatie loopt al\. Wacht tot de AI hem automatisch afrondt\./);
  assert.doesNotMatch(deepSearchScriptSource, /100 bedrijven toevoegen/);
  assert.match(deepSearchScriptSource, /\? "Nu: " \+ target\.label/);
  assert.doesNotMatch(deepSearchScriptSource, /"Nu: " \+ target\.label \+ " · " \+ target\.batches/);
  assert.doesNotMatch(deepSearchScriptSource, /STATUS_LABELS/);
  assert.doesNotMatch(deepSearchScriptSource, /item\.batches \+ "x/);
  assert.doesNotMatch(deepSearchScriptSource, /item\.added \+ " nieuw/);
  assert.match(deepSearchScriptSource, /Geschatte API-kosten/);
  assert.match(
    deepSearchScriptSource,
    /"Geschatte API-kosten voor " \+ desiredCount \+ " bedrijven: ± " \+ estimate/
  );
  assert.doesNotMatch(deepSearchScriptSource, /max ± €2 afwijking/);
  assert.match(deepSearchScriptSource, /function estimateRunUsd\(companyCount\)/);
  assert.match(deepSearchScriptSource, /outputTokensPerCompany/);
  assert.match(deepSearchScriptSource, /ESTIMATED_DEEP_SEARCH_MODEL = "gpt-5\.5-pro"/);
  assert.match(deepSearchScriptSource, /inputTokensPerBatch: 6000/);
  assert.match(deepSearchScriptSource, /inputUsdPerMillion: 30/);
  assert.match(deepSearchScriptSource, /outputUsdPerMillion: 180/);
  assert.match(deepSearchScriptSource, /webSearchUsdPerCall: 0\.01/);
  assert.match(deepSearchScriptSource, /Number\(\(inputUsd \+ outputUsd \+ webSearchUsd\)\.toFixed\(6\)\)/);
  assert.doesNotMatch(deepSearchScriptSource, /"Geschatte API-kosten: ± " \+ batchCost/);
  assert.doesNotMatch(deepSearchScriptSource, /per AI-ronde/);
  assert.doesNotMatch(deepSearchScriptSource, /gebruikt voor deze plek/);
  assert.doesNotMatch(deepSearchScriptSource, /klaar ·/);
  assert.match(deepSearchScriptSource, /function formatUsdAsEuro\(value\)/);
  assert.match(deepSearchScriptSource, /USD_TO_EUR_RATE = 0\.93/);
  assert.match(deepSearchScriptSource, /ESTIMATED_BATCH_PRICING/);
  assert.match(deepSearchScriptSource, /function advanceCompletedTarget\(target\)/);
  assert.match(deepSearchScriptSource, /Boolean\(body && body\.placeComplete\)/);
  assert.match(deepSearchScriptSource, /foundWebsites: \[\]/);
  assert.match(deepSearchScriptSource, /const visibleSourceTargetIds = new Set\(\);/);
  assert.match(deepSearchScriptSource, /const sessionFoundWebsitesByTargetId = new Map\(\);/);
  assert.match(deepSearchScriptSource, /visibleSourceTargetIds\.has\(targetId\)/);
  assert.match(deepSearchScriptSource, /getSessionFoundWebsites\(targetId\)/);
  assert.match(deepSearchScriptSource, /visibleSourceTargetIds\.add\(target\.id\);/);
  assert.match(deepSearchScriptSource, /visibleSourceTargetIds\.clear\(\);/);
  assert.match(deepSearchScriptSource, /sessionFoundWebsitesByTargetId\.clear\(\);/);
  assert.match(deepSearchScriptSource, /function uniqueWebsiteValues\(values, maxItems\)/);
  assert.match(deepSearchScriptSource, /function collectWebsitesFromCustomers\(customers\)/);
  assert.doesNotMatch(deepSearchScriptSource, /function collectWebsitesFromRows\(rows\)/);
  assert.doesNotMatch(deepSearchScriptSource, /\.concat\(sources\)/);
  assert.match(deepSearchScriptSource, /function serializeTargetProgressList\(targets\)/);
  assert.match(deepSearchScriptSource, /targetProgress: serializeTargetProgressList\(state\.targets\)/);
  assert.doesNotMatch(deepSearchScriptSource, /targets: state\.targets/);
  assert.doesNotMatch(deepSearchScriptSource, /function collectCustomerWebsitesForTarget\(target\)/);
  assert.doesNotMatch(deepSearchScriptSource, /function hasTargetSearchProgress\(target\)/);
  assert.match(deepSearchScriptSource, /function resetFoundWebsitesForSession\(target\)/);
  assert.match(deepSearchScriptSource, /target\.foundWebsites = uniqueWebsiteValues/);
  assert.match(deepSearchScriptSource, /resetFoundWebsitesForSession\(target\);/);
  assert.match(deepSearchScriptSource, /Nog geen websites voor deze plek\./);
  assert.match(deepSearchScriptSource, /persisted: Boolean\(persistResult && persistResult\.ok !== false\)/);
  assert.match(deepSearchScriptSource, /Let op: voortgang opslaan lukte niet\./);
  assert.match(deepSearchScriptSource, /customerPersisted: customerPersisted/);
  assert.match(deepSearchScriptSource, /Opslaan in Supabase lukte niet/);
  assert.doesNotMatch(deepSearchScriptSource, /localStorage/);
  assert.match(deepSearchScriptSource, /nodes\.closeDeepSearchButton\.disabled = busy;/);
  assert.match(deepSearchScriptSource, /nodes\.deepSearchModal\.classList\.toggle\("is-running", busy\);/);
  assert.match(deepSearchScriptSource, /DEEP_SEARCH_BUSY_STYLE_ID/);
  assert.match(deepSearchScriptSource, /ensureBusyStyles\(\);/);
  assert.match(deepSearchScriptSource, /\.deep-search-close\.is-loading, \.modal-bg\.is-running \.deep-search-close/);
  assert.match(deepSearchScriptSource, /button\.innerHTML = "<span class=\\"deep-search-close-spinner\\" aria-hidden=\\"true\\"><\/span>";/);
  assert.match(deepSearchScriptSource, /deep-search-close\.is-loading, \.modal-bg\.is-running \.deep-search-close \{ width: 58px; height: 58px;/);
  assert.match(deepSearchScriptSource, /deep-search-close-spinner \{ display: block; width: 58px; height: 58px;/);
  assert.match(deepSearchScriptSource, /button\.classList\.toggle\("is-loading", busy\);/);
  assert.match(deepSearchScriptSource, /@keyframes deepSearchSpin/);
  assert.doesNotMatch(deepSearchScriptSource, /Batch loopt nog\. De bedrijvenlijst blijft open tot deze plek klaar is\./);
  assert.match(deepSearchScriptSource, /function isOpen\(\)/);
  assert.doesNotMatch(deepSearchScriptSource, /AI zoekt nieuwe bedrijven voor/);
  assert.match(pageSource, /if \(databaseDeepSearchController\.isOpen\(\)\) \{[\s\S]*databaseDeepSearchController\.close\(\);/);
  assert.doesNotMatch(deepSearchScriptSource, /function markCurrentDone\(\)/);
  assert.doesNotMatch(deepSearchScriptSource, /resetState/);
  assert.match(deepSearchScriptSource, /source: "premium-database-deep-search"/);
  assert.match(pageSource, /const API_COST_SCOPE = "premium_api_costs";/);
  assert.match(pageSource, /function recordApiCostEvent\(event\)/);
  assert.match(pageSource, /window\.SoftoraApiCostLedger\.createLedger\(\{/);
  assert.match(apiCostLedgerScriptSource, /function createLedger\(options\)/);
  assert.match(apiCostLedgerScriptSource, /source: "softora-api-cost-ledger"/);
  assert.match(pageSource, /recordApiCost: recordApiCostEvent/);
  assert.match(deepSearchScriptSource, /const recordApiCost = typeof options\.recordApiCost === "function"/);
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
  assert.doesNotMatch(pageSource, /Database-voorbeeld uit actieve opdrachten/);
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

test('premium database deep search keeps old index-only progress on the original location after distance sorting', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const listNode = { innerHTML: '' };
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '25' },
      deepSearchList: listNode,
      deepSearchModal: createClassListNode(),
      deepSearchSources: {},
      deepSearchStartButton: createClassListNode(),
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    getUiState: async () => ({
      values: {
        deep_search_state: JSON.stringify({
          version: 2,
          activeIndex: 0,
          targetProgress: [{ index: 0, status: 'done', batches: 1, placeComplete: true }],
        }),
      },
    }),
  });

  controller.open();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(listNode.innerHTML, /^<button class="deep-search-target is-active is-active"[\s\S]*1\. Nederland \| Noord-Brabant \| Oisterwijk \| Oisterwijk/);
  assert.match(listNode.innerHTML, /class="deep-search-target is-done"[\s\S]*Nederland \| Noord-Brabant \| Altena \| Almkerk/);
});

test('premium database photo storage clears removed photo chunks so refresh cannot restore them', async () => {
  const photoStorageClient = loadDatabasePhotoStorageClient();
  const patches = [];
  const controller = photoStorageClient.createController({
    getUiState: async () => ({
      values: {
        photos: JSON.stringify({
          customer1: {
            id: 'customer1',
            identityKey: 'identity:customer1',
            photoKey: 'photo_customer1',
            chunkCount: 2,
            websitePhotoName: 'Websitefoto',
          },
        }),
        photo_customer1_0: 'data:image/png;base64,AAA',
        photo_customer1_1: 'BBB',
      },
    }),
    setUiState: async (_scope, payload) => {
      patches.push(payload.patch);
      return { ok: true };
    },
    normalizeCustomer: (customer) => customer,
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    buildCustomerIdentityKey: (customer) => 'identity:' + customer.id,
    formatDateForStorage: () => '2026-04-28',
    scope: 'premium_database_photos',
    key: 'photos',
    dataPrefix: 'photo_',
    chunkSize: 180000,
  });

  await controller.persist([{ id: 'customer1', websitePhoto: '' }], { removeCustomerIds: ['customer1'] });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].photo_customer1_0, '');
  assert.equal(patches[0].photo_customer1_1, '');
  assert.equal(JSON.parse(patches[0].photos).customer1, undefined);
});

test('premium database photo storage saves one changed photo without resending old chunks', async () => {
  const photoStorageClient = loadDatabasePhotoStorageClient();
  const patches = [];
  const controller = photoStorageClient.createController({
    getUiState: async () => ({
      values: {
        photos: JSON.stringify({
          customer1: {
            id: 'customer1',
            identityKey: 'identity:customer1',
            photoKey: 'photo_customer1',
            chunkCount: 1,
            websitePhotoName: 'Websitefoto oud',
          },
        }),
        photo_customer1_0: 'data:image/png;base64,AAA',
      },
    }),
    setUiState: async (_scope, payload) => {
      patches.push(payload.patch);
      return { ok: true };
    },
    normalizeCustomer: (customer) => customer,
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    buildCustomerIdentityKey: (customer) => 'identity:' + customer.id,
    formatDateForStorage: () => '2026-04-28',
    scope: 'premium_database_photos',
    key: 'photos',
    dataPrefix: 'photo_',
    chunkSize: 180000,
  });

  await controller.persist([
    { id: 'customer1', websitePhoto: 'data:image/png;base64,AAA', websitePhotoName: 'Websitefoto oud' },
    { id: 'customer2', websitePhoto: 'data:image/png;base64,BBB', websitePhotoName: 'Websitefoto nieuw', websiteMockup: 'data:image/jpeg;base64,CCC', websiteMockupName: 'Device mockup nieuw' },
  ], { onlyCustomerIds: ['customer2'] });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].photo_customer1_0, undefined);
  assert.equal(patches[0].photo_customer2_0, 'data:image/png;base64,BBB');
  assert.equal(patches[0].photo_customer2_mockup_0, 'data:image/jpeg;base64,CCC');
  const storedMap = JSON.parse(patches[0].photos);
  assert.equal(storedMap.customer1.photoKey, 'photo_customer1');
  assert.equal(storedMap.customer2.photoKey, 'photo_customer2');
  assert.equal(storedMap.customer2.mockupPhotoKey, 'photo_customer2_mockup');
  assert.equal(storedMap.customer2.websiteMockupName, 'Device mockup nieuw');
});

test('premium database photo storage retries Supabase reads before saving photos', async () => {
  const photoStorageClient = loadDatabasePhotoStorageClient();
  const patches = [];
  let reads = 0;
  const controller = photoStorageClient.createController({
    getUiState: async () => {
      reads += 1;
      if (reads === 1) throw new Error('read timeout');
      return { values: { photos: '{}' } };
    },
    setUiState: async (_scope, payload) => {
      patches.push(payload.patch);
      return { ok: true };
    },
    normalizeCustomer: (customer) => customer,
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    buildCustomerIdentityKey: (customer) => 'identity:' + customer.id,
    formatDateForStorage: () => '2026-04-28',
    scope: 'premium_database_photos',
    key: 'photos',
    dataPrefix: 'photo_',
    chunkSize: 180000,
  });

  const result = await controller.persist([
    { id: 'customer1', websitePhoto: 'data:image/png;base64,AAA', websitePhotoName: 'Websitefoto nieuw' },
  ], { onlyCustomerIds: ['customer1'] });

  assert.equal(result.ok, true);
  assert.equal(reads, 2);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].photo_customer1_0, 'data:image/png;base64,AAA');
});

test('premium database deep search continues to the next location until the requested new-company count is reached', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const calls = [];
  const messages = [];
  const customers = [];
  const persisted = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Oisterwijk Test BV', 'Kerkstraat 1, Oisterwijk', 'info@oisterwijktest.nl', '013 123 4567', 'oisterwijktest.nl'],
  ];
  const heukelomRows = [
    rows[0],
    ['Heukelom Test BV', 'Kerkstraat 2, Heukelom', 'info@heukelomtest.nl', '013 765 4321', 'heukelomtest.nl'],
  ];
  const responses = [
    {
      ok: true,
      rows,
      businesses: [{ bedrijfsnaam: 'Oisterwijk Test BV', email: 'info@oisterwijktest.nl', website: 'oisterwijktest.nl' }],
      found: 1,
      placeComplete: true,
      cost: { estimatedUsd: 0.12 },
      sources: [{ url: 'https://oisterwijktest.nl/contact', title: 'Contact' }],
    },
    {
      ok: true,
      rows: [rows[0]],
      businesses: [],
      found: 0,
      placeComplete: true,
      cost: { estimatedUsd: 0.08 },
      sources: [{ url: 'https://oisterwijktest.nl/over-ons', title: 'Over ons' }],
    },
    {
      ok: true,
      rows: heukelomRows,
      businesses: [{ bedrijfsnaam: 'Heukelom Test BV', email: 'info@heukelomtest.nl', website: 'heukelomtest.nl' }],
      found: 1,
      placeComplete: false,
      cost: { estimatedUsd: 0.11 },
      sources: [{ url: 'https://heukelomtest.nl/contact', title: 'Contact' }],
    },
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '2' },
      deepSearchList: {},
      deepSearchSources: {},
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    autoContinueDelayMs: 0,
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.push(...receivedRows.slice(1).map((row) => ({ bedrijf: row[0], email: row[2], website: row[4] })));
    },
    readDeepSearchRows: async (payload) => {
      if (payload.batchNumber === 2) {
        assert.ok(persisted.length >= 1);
        const savedBeforeFollowUp = JSON.parse(persisted[persisted.length - 1].patch.deep_search_state);
        assert.deepEqual(getStoredTargetProgress(savedBeforeFollowUp).foundWebsites, [
          'oisterwijktest.nl',
        ]);
      }
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
  assert.equal(calls.length, 3);
  assert.equal(calls[0].target, 'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk');
  assert.equal(calls[0].count, 2);
  assert.equal(calls[0].batchNumber, 1);
  assert.equal(calls[1].target, calls[0].target);
  assert.equal(calls[1].count, 1);
  assert.equal(calls[1].batchNumber, 2);
  assert.equal(calls[2].target, 'Nederland | Noord-Brabant | Oisterwijk | Heukelom');
  assert.equal(calls[2].count, 1);
  assert.equal(calls[2].batchNumber, 1);
  assert.equal(customers.length, 2);
  assert.doesNotMatch(messages.join('\n'), /AI gaf al klaar aan/);
  assert.match(messages.join('\n'), /Deze plaats is automatisch afgerond/);
  assert.match(messages.join('\n'), /Gewenste aantal gehaald/);
  assert.ok(persisted.length >= 2);
  const finalStatePatch = persisted[persisted.length - 1].patch.deep_search_state;
  const finalState = JSON.parse(finalStatePatch);
  assert.equal(finalState.targets, undefined);
  assert.equal(finalState.targetOrderVersion, 'distance-oisterwijk-v1');
  assert.ok(finalStatePatch.length < 200000);
  assert.deepEqual(getStoredTargetProgress(finalState).foundWebsites, [
    'oisterwijktest.nl',
  ]);
  assert.equal(getStoredTargetProgress(finalState).status, 'done');
  assert.deepEqual(getStoredTargetProgress(finalState, 1).foundWebsites, [
    'heukelomtest.nl',
  ]);
});

test('premium database deep search shows the precise estimate without deviation copy', () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const nodes = {
    deepSearchModal: createClassListNode(),
    deepSearchCost: {},
    deepSearchCurrent: {},
    deepSearchDesiredCount: { value: '25' },
    deepSearchList: {},
    deepSearchSources: {},
    deepSearchStartButton: {},
  };
  const controller = deepSearchClient.createController({ nodes });

  controller.open();

  assert.equal(nodes.deepSearchCost.textContent, 'Geschatte API-kosten voor 25 bedrijven: ± €6,04');
  assert.doesNotMatch(nodes.deepSearchCost.textContent, /max ± €2 afwijking/);
});

test('premium database deep search turns the start button into a disabled completed-session summary', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const startButton = createClassListNode();
  const calls = [];
  const customers = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Schutte Groen & Grond', 'Kerkstraat 1, Oisterwijk', 'info@schuttegroenengrond.nl', '013 123 4567', 'schuttegroenengrond.nl'],
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchSources: {},
      deepSearchStartButton: startButton,
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
      return {
        ok: true,
        rows,
        businesses: [{ bedrijfsnaam: 'Schutte Groen & Grond', email: 'info@schuttegroenengrond.nl', website: 'schuttegroenengrond.nl' }],
        found: 1,
        placeComplete: false,
        cost: { estimatedUsd: 0.02 },
        sources: [{ url: 'https://schuttegroenengrond.nl', title: 'Schutte Groen & Grond' }],
      };
    },
    setUiState: async () => ({ ok: true }),
  });

  assert.equal(await controller.runCurrentSearch(), true);

  assert.equal(calls.length, 1);
  assert.equal(startButton.textContent, '1 bedrijf gevonden in Oisterwijk');
  assert.equal(startButton.disabled, true);
  assert.equal(startButton.getAttribute('aria-disabled'), 'true');
  assert.equal(startButton.classList.contains('is-session-complete'), true);
  assert.equal(await controller.runCurrentSearch(), false);
  assert.equal(calls.length, 1);
});

test('premium database deep search stops when new companies could not be saved', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const calls = [];
  const messages = [];
  const customers = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Save Fail BV', 'Kerkstraat 2, Almkerk', 'info@savefail.nl', '0183 222 222', 'savefail.nl'],
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchSources: {},
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    autoContinueDelayMs: 0,
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.push(...receivedRows.slice(1).map((row) => ({ bedrijf: row[0], email: row[2], website: row[4] })));
      return false;
    },
    readDeepSearchRows: async (payload) => {
      calls.push(payload);
      return {
        ok: true,
        rows,
        businesses: [{ bedrijfsnaam: 'Save Fail BV', email: 'info@savefail.nl', website: 'savefail.nl' }],
        found: 1,
        placeComplete: false,
        cost: { estimatedUsd: 0.12 },
        sources: [{ url: 'https://savefail.nl/contact', title: 'Contact' }],
      };
    },
    setStatusMessage: (message) => {
      messages.push(message);
    },
    setUiState: async () => ({ ok: true }),
  });

  const result = await controller.runCurrentSearch();

  assert.equal(result, false);
  assert.equal(calls.length, 1);
  assert.equal(customers.length, 1);
  assert.match(messages.join('\n'), /Opslaan in Supabase lukte niet/);
});

test('premium database deep search only shows websites after companies are added to the database', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const customers = [];
  const sourcesPanel = { innerHTML: '' };
  let resolveImport;
  let importStartedResolve;
  const importStarted = new Promise((resolve) => {
    importStartedResolve = resolve;
  });
  let calls = 0;
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Almkerk 1', 'Kerkstraat 1, Almkerk', 'info@almkerk1.nl', '0183 111 111', 'almkerk1.nl'],
    ['Almkerk 2', 'Kerkstraat 2, Almkerk', 'info@almkerk2.nl', '0183 222 222', 'https://almkerk2.nl'],
    ['Almkerk 3', 'Kerkstraat 3, Almkerk', 'info@almkerk3.nl', '0183 333 333', 'almkerk3.nl'],
    ['Almkerk 4', 'Kerkstraat 4, Almkerk', 'info@almkerk4.nl', '0183 444 444', 'almkerk4.nl'],
    ['Almkerk 5', 'Kerkstraat 5, Almkerk', 'info@almkerk5.nl', '0183 555 555', 'almkerk5.nl'],
    ['Almkerk 6', 'Kerkstraat 6, Almkerk', 'info@almkerk6.nl', '0183 666 666', 'almkerk6.nl'],
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '6' },
      deepSearchList: {},
      deepSearchSources: sourcesPanel,
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    autoContinueDelayMs: 50,
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      importStartedResolve();
      return new Promise((resolve) => {
        resolveImport = () => {
          customers.push(...receivedRows.slice(1).map((row) => ({ bedrijf: row[0], email: row[2], website: row[4] })));
          resolve(true);
        };
      });
    },
    readDeepSearchRows: async () => {
      calls += 1;
      return calls === 1
        ? {
            ok: true,
            rows,
            businesses: [],
            found: 6,
            placeComplete: false,
            cost: { estimatedUsd: 0.12 },
            sources: [],
          }
        : {
            ok: true,
            rows: [rows[0]],
            businesses: [],
            found: 0,
            placeComplete: true,
            cost: { estimatedUsd: 0.02 },
            sources: [],
          };
    },
    setUiState: async () => ({ ok: true }),
  });

  const runPromise = controller.runCurrentSearch();
  await importStarted;

  assert.match(sourcesPanel.innerHTML, /Nog geen websites voor deze plek\./);
  assert.doesNotMatch(sourcesPanel.innerHTML, /almkerk1\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /almkerk2\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /almkerk6\.nl/);
  assert.equal(customers.length, 0);

  resolveImport();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(customers.length, 6);
  assert.match(sourcesPanel.innerHTML, /almkerk1\.nl/);
  assert.match(sourcesPanel.innerHTML, /almkerk2\.nl/);
  assert.match(sourcesPanel.innerHTML, /almkerk6\.nl/);

  await runPromise;
  assert.equal(customers.length, 6);
});

test('premium database deep search persists compact website progress without pre-filling the panel on reload', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const customers = [];
  const persisted = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Compact 1', 'Kerkstraat 1, Almkerk', 'info@compact1.nl', '0183 111 111', 'compact1.nl'],
    ['Compact 2', 'Kerkstraat 2, Almkerk', 'info@compact2.nl', '0183 222 222', 'https://compact2.nl'],
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '2' },
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: { innerHTML: '' },
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    getUiState: async () => ({ values: { deep_search_state: JSON.stringify({ roundMode: '1' }) } }),
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.push(...receivedRows.slice(1).map((row) => ({
        bedrijf: row[0],
        adres: row[1],
        email: row[2],
        website: row[4],
      })));
      return true;
    },
    readDeepSearchRows: async () => ({
      ok: true,
      rows,
      businesses: [],
      found: 2,
      placeComplete: false,
      cost: { estimatedUsd: 0.12 },
      sources: [{ url: 'https://compact1.nl/contact', title: 'Contact' }],
    }),
    setUiState: async (_scope, payload) => {
      persisted.push(payload);
      return { ok: true };
    },
  });

  controller.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.runCurrentSearch();

  const finalStatePatch = persisted[persisted.length - 1].patch.deep_search_state;
  const finalState = JSON.parse(finalStatePatch);
  assert.equal(finalState.targets, undefined);
  assert.ok(finalStatePatch.length < 200000);
  assert.deepEqual(getStoredTargetProgress(finalState).foundWebsites, [
    'compact1.nl',
    'https://compact2.nl',
  ]);

  const restoredSourcesPanel = { innerHTML: '' };
  const restoredController = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: restoredSourcesPanel,
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    getUiState: async () => ({ values: { deep_search_state: finalStatePatch } }),
    getCustomers: () => customers,
    setUiState: async () => ({ ok: true }),
  });

  restoredController.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(restoredSourcesPanel.innerHTML, /Nog geen websites voor deze plek\./);
  assert.doesNotMatch(restoredSourcesPanel.innerHTML, /compact1\.nl/);
  assert.doesNotMatch(restoredSourcesPanel.innerHTML, /compact2\.nl/);
});

test('premium database deep search keeps found websites empty before a location starts', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const sourcesPanel = { innerHTML: '' };
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: sourcesPanel,
      deepSearchStartButton: {},
    },
    getCustomers: () => [
      { bedrijf: 'Almkerk BV', adres: 'Kerkstraat 1, Almkerk', website: 'almkerkfallback.nl' },
      { bedrijf: 'Chaam BV', adres: 'Dorpsstraat 1, Chaam', website: 'chaamfallback.nl' },
    ],
  });

  controller.open();

  assert.match(sourcesPanel.innerHTML, /Nog geen websites voor deze plek\./);
  assert.doesNotMatch(sourcesPanel.innerHTML, /almkerkfallback\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /chaamfallback\.nl/);
});

test('premium database deep search does not backfill found websites from older customer rows', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const sourcesPanel = { innerHTML: '' };
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: sourcesPanel,
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    getUiState: async () => ({
      values: {
        deep_search_state: JSON.stringify({
          version: 2,
          activeIndex: 0,
          targetProgress: [{ index: 0, label: 'Nederland | Noord-Brabant | Altena | Almkerk', batches: 1 }],
        }),
      },
    }),
    getCustomers: () => [
      { bedrijf: 'Almkerk BV', adres: 'Kerkstraat 1, Almkerk', website: 'almkerkfallback.nl' },
      { bedrijf: 'Chaam BV', adres: 'Dorpsstraat 1, Chaam', website: 'chaamfallback.nl' },
    ],
  });

  controller.open();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(sourcesPanel.innerHTML, /Nog geen websites voor deze plek\./);
  assert.doesNotMatch(sourcesPanel.innerHTML, /almkerkfallback\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /chaamfallback\.nl/);
});

test('premium database deep search clears old found websites when a new batch session starts', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const sourcesPanel = { innerHTML: '' };
  const customers = [];
  let resolveSearch;
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Nieuwe Sessie BV', 'Kerkstraat 1, Almkerk', 'info@nieuwesessie.nl', '0183 111 111', 'nieuwesessie.nl'],
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: sourcesPanel,
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    getUiState: async () => ({
      values: {
        deep_search_state: JSON.stringify({
          version: 2,
          activeIndex: 0,
          roundMode: '1',
          targetProgress: [{
            index: 0,
            label: 'Nederland | Noord-Brabant | Altena | Almkerk',
            batches: 1,
            foundWebsites: ['oudesite.nl', 'https://oudesite.nl/contact'],
          }],
        }),
      },
    }),
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.push(...receivedRows.slice(1).map((row) => ({ bedrijf: row[0], email: row[2], website: row[4] })));
      return true;
    },
    readDeepSearchRows: async () => new Promise((resolve) => {
      resolveSearch = resolve;
    }),
    setUiState: async () => ({ ok: true }),
  });

  controller.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(sourcesPanel.innerHTML, /Nog geen websites voor deze plek\./);
  assert.doesNotMatch(sourcesPanel.innerHTML, /oudesite\.nl/);

  const runPromise = controller.runCurrentSearch();
  assert.match(sourcesPanel.innerHTML, /Nog geen websites voor deze plek\./);
  assert.doesNotMatch(sourcesPanel.innerHTML, /oudesite\.nl/);

  resolveSearch({
    ok: true,
    rows,
    businesses: [],
    found: 1,
    placeComplete: false,
    cost: { estimatedUsd: 0.12 },
    sources: [{ url: 'https://nieuwesessie.nl/contact', title: 'Contact' }],
  });
  await runPromise;

  assert.match(sourcesPanel.innerHTML, /nieuwesessie\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /nieuwesessie\.nl\/contact/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /oudesite\.nl/);
});

test('premium database deep search locks the modal while a batch is running', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const modal = createClassListNode();
  const closeButton = createClassListNode();
  const customers = [];
  const messages = [];
  let resolveSearch;
  const controller = deepSearchClient.createController({
    nodes: {
      closeDeepSearchButton: closeButton,
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchModal: modal,
      deepSearchSources: {},
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    autoContinueDelayMs: 0,
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.push(...receivedRows.slice(1).map((row) => ({ bedrijf: row[0], email: row[2], website: row[4] })));
    },
    readDeepSearchRows: async () => new Promise((resolve) => {
      resolveSearch = resolve;
    }),
    setStatusMessage: (message) => {
      messages.push(message);
    },
  });

  controller.open();
  assert.equal(controller.isOpen(), true);

  const runPromise = controller.runCurrentSearch();
  assert.equal(controller.isBusy(), true);
  assert.equal(closeButton.disabled, true);
  assert.equal(closeButton.getAttribute('aria-label'), 'Bedrijvenlijst loopt');
  assert.equal(closeButton.getAttribute('aria-disabled'), 'true');
  assert.equal(closeButton.getAttribute('aria-busy'), 'true');
  assert.equal(closeButton.classList.contains('is-loading'), true);
  assert.match(closeButton.innerHTML, /deep-search-close-spinner/);
  assert.equal(modal.classList.contains('is-running'), true);
  const messagesBeforeClose = messages.slice();
  assert.equal(controller.close(), false);
  assert.equal(controller.isOpen(), true);
  assert.deepEqual(messages, messagesBeforeClose);

  resolveSearch({
    ok: true,
    rows: [
      ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
      ['Slot Test BV', 'Kerkstraat 1, Almkerk', 'info@slottest.nl', '0183 111 111', 'slottest.nl'],
    ],
    businesses: [{ bedrijfsnaam: 'Slot Test BV', email: 'info@slottest.nl', website: 'slottest.nl' }],
    found: 1,
    placeComplete: true,
    cost: { estimatedUsd: 0.02 },
    sources: [],
  });

  assert.equal(await runPromise, true);
  assert.equal(controller.isBusy(), false);
  assert.equal(closeButton.disabled, false);
  assert.equal(closeButton.getAttribute('aria-label'), 'Sluit bedrijvenlijst');
  assert.equal(closeButton.getAttribute('aria-disabled'), 'false');
  assert.equal(closeButton.getAttribute('aria-busy'), 'false');
  assert.equal(closeButton.classList.contains('is-loading'), false);
  assert.doesNotMatch(closeButton.innerHTML, /deep-search-close-spinner/);
  assert.equal(modal.classList.contains('is-running'), false);
  assert.equal(controller.close(), true);
  assert.equal(controller.isOpen(), false);
});

test('premium database sorteert bedrijven standaard op afstand vanaf Oisterwijk', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const sorterPath = path.join(__dirname, '../../assets/premium-database-distance.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const sorterSource = fs.readFileSync(sorterPath, 'utf8');

  assert.match(pageSource, /assets\/premium-database-distance\.js\?v=20260506a/);
  assert.match(pageSource, /window\.SoftoraPremiumDatabaseDistance/);
  assert.match(pageSource, /sortKey: "distance"/);
  assert.match(pageSource, /function getSortedCustomers\(customers\) \{\s*return sortCustomers\(customers\);/);
  assert.match(sorterSource, /const OISTERWIJK_COORDS = \{ lat: 51\.5792, lng: 5\.1889 \};/);
  assert.match(sorterSource, /function resolveCustomerCoords\(customer\)/);
  assert.match(sorterSource, /function getDistanceKm\(customer\)/);
  assert.match(sorterSource, /function compareCustomersByDistance\(left, right\)/);
  assert.match(sorterSource, /function compareTargetLabelsByDistance\(left, right\)/);
  assert.match(sorterSource, /function sortTargetLabelsByDistance\(labels\)/);
  assert.match(sorterSource, /return \(Array\.isArray\(customers\) \? customers : \[\]\)\.slice\(\)\.sort\(compareCustomersByDistance\);/);
  assert.match(sorterSource, /"4281": \{ lat: 51\.7835, lng: 5\.0585 \}/);
  assert.match(sorterSource, /"4286": \{ lat: 51\.7714, lng: 4\.9597 \}/);
  assert.match(sorterSource, /"4856": \{ lat: 51\.5006, lng: 4\.7839 \}/);
  assert.match(sorterSource, /"4858": \{ lat: 51\.5486, lng: 4\.7967 \}/);
  assert.match(sorterSource, /"4859": \{ lat: 51\.5653, lng: 4\.8307 \}/);
  assert.match(sorterSource, /"4861": \{ lat: 51\.5069, lng: 4\.8616 \}/);
  assert.match(sorterSource, /"5131": \{ lat: 51\.4817, lng: 4\.9583 \}/);
  const sorter = loadDatabaseDistanceClient();
  const sortedTargets = sorter.sortTargetLabelsByDistance([
    'Nederland | Noord-Brabant | Altena | Almkerk',
    'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk',
    'Nederland | Noord-Brabant | Oisterwijk | Moergestel',
    'Nederland | Groningen | Groningen | Groningen',
  ]);
  assert.deepEqual(sortedTargets, [
    'Nederland | Noord-Brabant | Oisterwijk | Oisterwijk',
    'Nederland | Noord-Brabant | Oisterwijk | Moergestel',
    'Nederland | Noord-Brabant | Altena | Almkerk',
    'Nederland | Groningen | Groningen | Groningen',
  ]);
});

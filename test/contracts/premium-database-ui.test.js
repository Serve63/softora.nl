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
  const helperScriptPath = path.join(__dirname, '../../assets/premium-database-deep-search-helpers.js');
  const targetCoordsScriptPath = path.join(__dirname, '../../assets/premium-database-target-coords.js');
  const scriptPath = path.join(__dirname, '../../assets/premium-database-deep-search.js');
  const distanceScriptPath = path.join(__dirname, '../../assets/premium-database-distance.js');
  const helperSource = fs.readFileSync(helperScriptPath, 'utf8');
  const targetCoordsSource = fs.readFileSync(targetCoordsScriptPath, 'utf8');
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
  vm.runInNewContext(targetCoordsSource, sandbox);
  vm.runInNewContext(distanceSource, sandbox);
  vm.runInNewContext(helperSource, sandbox);
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseDeepSearch;
}

function loadDatabaseContactStatusClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-contact-status.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseContactStatus;
}

function loadDatabasePhotoStorageClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-photo-storage.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabasePhotoStorage;
}

function loadDatabaseWebdesignAssetStateClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-asset-state.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: { URL }, URL };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseWebdesignAssetState;
}

function loadDatabaseColdmailGuardClient() {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-coldmail-guard.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: { URL }, URL };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseColdmailGuard;
}

function loadDatabaseWebdesignActionClient(options = {}) {
  const previewScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-preview.js');
  const scriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-action.js');
  const previewSource = fs.readFileSync(previewScriptPath, 'utf8');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const document = options.document || {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
  };
  const windowObject = {
    document,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    requestAnimationFrame: options.requestAnimationFrame || ((callback) => callback()),
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({ jobs: [] }) })),
    Image: options.Image || function Image() {},
    URL,
  };
  const sandbox = { window: windowObject, fetch: windowObject.fetch };
  vm.runInNewContext(previewSource, sandbox);
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseWebdesignAction;
}

function loadDatabaseOutreachClient(options = {}) {
  const scriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-action.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const document = options.document || {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
  };
  const windowObject = {
    document,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    requestAnimationFrame: options.requestAnimationFrame || ((callback) => callback()),
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({ jobs: [] }) })),
    Image: options.Image || function Image() {},
    URL,
  };
  const sandbox = { window: windowObject, fetch: windowObject.fetch };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SoftoraDatabaseOutreach;
}

function loadDatabaseDistanceClient() {
  const targetCoordsScriptPath = path.join(__dirname, '../../assets/premium-database-target-coords.js');
  const scriptPath = path.join(__dirname, '../../assets/premium-database-distance.js');
  const targetCoordsSource = fs.readFileSync(targetCoordsScriptPath, 'utf8');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {}, Buffer };
  vm.runInNewContext(targetCoordsSource, sandbox);
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
    /const initialBootstrapCustomers = resolveBootstrapCustomers\(\);[\s\S]*state\.klanten = sortCustomers\(outreachController\.applyAutomation\(initialBootstrapCustomers\)\.customers\);[\s\S]*renderPage\(\);/
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
  assert.match(pageSource, /assets\/premium-database-target-coords\.js\?v=20260522a/);
  assert.match(pageSource, /assets\/premium-database-distance\.js\?v=20260522b/);
  assert.match(pageSource, /sortKey: "distance"/);
  assert.match(pageSource, /function sortCustomers\(list\) \{\s*return window\.SoftoraPremiumDatabaseDistance/);
  assert.match(pageSource, /function getSortedCustomers\(customers\) \{\s*return \(state\.activeStatus === "benaderd" \|\| state\.activeStatus === "instantly"\) \? outreachController\.sortByRecentOutreach\(customers, parseDateValue, normalizeSearchValue\) : sortCustomers\(customers\);/);
  assert.match(pageSource, /state\.klanten = sortCustomers\(state\.klanten\.concat\(\[customer\]\)\);/);
  assert.match(pageSource, /state\.klanten = sortCustomers\(mergeResult\.customers\);/);
  assert.match(pageSource, /const normalizedCustomers = sortCustomers\(customers\)\.filter/);
  assert.doesNotMatch(pageSource, /sortKey: "manual"/);
});

test('premium database contact status detects sent coldmail signals', () => {
  const contactStatusClient = loadDatabaseContactStatusClient();

  assert.equal(contactStatusClient.normalizeOutreachStatusKey('benaderd'), 'benaderd');
  assert.equal(contactStatusClient.normalizeOutreachStatusKey('sent'), 'benaderd');
  assert.equal(contactStatusClient.shouldInferMailedStatus('benaderbaar', { outreachStatus: 'benaderd' }), true);
  assert.equal(contactStatusClient.shouldInferMailedStatus('prospect', { coldmailSentMessageId: 'msg_123' }), true);
  assert.equal(contactStatusClient.shouldInferMailedStatus('prospect', { hist: [{ label: 'Mail verstuurd' }] }), true);
  assert.equal(contactStatusClient.shouldInferMailedStatus('klant', { outreachStatus: 'benaderd' }), false);
  assert.equal(contactStatusClient.getColdmailSentAt({ lastColdmailSentAt: '2026-05-19T17:02:00Z' }), '2026-05-19T17:02:00Z');
});

test('premium database webdesign asset state keeps mail-ready and photo-target definitions separated', () => {
  const assetStateClient = loadDatabaseWebdesignAssetStateClient();
  const helpers = {
    shouldShowWebsitePhoto: (customer) => customer.status !== 'klant',
    isValidWebsitePhotoSource: (value) => /^(data:image\/|https:\/\/)/.test(String(value || '')),
    resolveCustomerWebsiteUrl: (customer) => customer.website || customer.dom || '',
    isMailLeadEligible: (customer) => Boolean(customer.email && !customer.doNotMail),
    isMockupPending: () => false,
    isMockupFailed: () => false,
  };
  const base = {
    id: 'customer-1',
    status: 'benaderbaar',
    email: 'info@example.nl',
    website: 'https://example.nl',
  };

  const photoWithoutMockup = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: 'data:image/png;base64,AAA',
    websiteMockup: '',
  }, helpers);
  assert.equal(photoWithoutMockup.hasPhoto, true);
  assert.equal(photoWithoutMockup.hasMockup, false);
  assert.equal(photoWithoutMockup.isMailReady, false);
  assert.equal(photoWithoutMockup.canRepairMockup, true);

  const approvedMockup = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: 'data:image/png;base64,AAA',
    websiteMockup: 'data:image/jpeg;base64,BBB',
    mockupQualityStatus: 'checked',
    mockupOrientation: 'upright',
  }, helpers);
  assert.equal(approvedMockup.isMailReady, true);
  assert.equal(approvedMockup.hasCompleteAssets, true);

  const legacyServerMockup = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: 'data:image/png;base64,AAA',
    websiteMockup: 'data:image/jpeg;base64,BBB',
    mockupRenderer: 'softora-server-device-v6',
    mockupQualityStatus: 'checked',
    mockupOrientation: 'upright',
  }, helpers);
  assert.equal(legacyServerMockup.hasMockup, true);
  assert.equal(legacyServerMockup.mockupApproved, true);
  assert.equal(legacyServerMockup.canRepairMockup, false);
  assert.equal(legacyServerMockup.isMailReady, true);
  assert.equal(legacyServerMockup.mockupState, 'ready');

  const fixedServerMockup = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: 'data:image/png;base64,AAA',
    websiteMockup: 'data:image/jpeg;base64,BBB',
    mockupRenderer: 'softora-server-device-v8',
    mockupQualityStatus: 'checked',
    mockupOrientation: 'upright',
  }, helpers);
  assert.equal(fixedServerMockup.mockupApproved, true);
  assert.equal(fixedServerMockup.isMailReady, true);

  const visuallyBadV7Mockup = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: 'data:image/png;base64,AAA',
    websiteMockup: 'data:image/jpeg;base64,BBB',
    websiteMockupName: 'Demo-device-mockup-v7.jpg',
    mockupQualityStatus: 'checked',
    mockupOrientation: 'upright',
  }, helpers);
  assert.equal(visuallyBadV7Mockup.mockupApproved, true);
  assert.equal(visuallyBadV7Mockup.canRepairMockup, false);
  assert.equal(visuallyBadV7Mockup.isMailReady, true);
  assert.equal(visuallyBadV7Mockup.mockupState, 'ready');

  const oldMockupWithoutQuality = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: 'data:image/png;base64,AAA',
    websiteMockup: 'data:image/jpeg;base64,BBB',
  }, helpers);
  assert.equal(oldMockupWithoutQuality.hasMockup, true);
  assert.equal(oldMockupWithoutQuality.mockupApproved, true);
  assert.equal(oldMockupWithoutQuality.canRepairMockup, false);
  assert.equal(oldMockupWithoutQuality.isMailReady, true);
  assert.equal(oldMockupWithoutQuality.mockupState, 'ready');

  const missingPhoto = assetStateClient.buildWebdesignAssetState({
    ...base,
    websitePhoto: '',
  }, helpers);
  assert.equal(missingPhoto.canGeneratePhoto, true);
  assert.equal(missingPhoto.isMailReady, false);
});

test('premium database excludes send-guarded customers from mail-ready voorraad', async () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const guardClient = loadDatabaseColdmailGuardClient();

  assert.match(pageSource, /assets\/premium-database-coldmail-guard\.js\?v=20260602a/);
  assert.match(pageSource, /const COLDMAIL_SEND_GUARD_SCOPE = "premium_coldmail_send_guard";/);
  assert.match(pageSource, /const COLDMAIL_SEND_GUARD_KEY = "softora_coldmail_send_guard_v1";/);
  assert.match(pageSource, /function hasColdmailSendGuardSignal\(customer\)/);
  assert.match(pageSource, /if \(hasColdmailSendGuardSignal\(customer\)\) return false;/);
  assert.match(pageSource, /await refreshColdmailGuardState\(\);[\s\S]*const remoteState = await fetchUiStateGetWithFallback\(CUSTOMER_DB_SCOPE\);/);

  const controller = guardClient.createController({
    scope: 'premium_coldmail_send_guard',
    key: 'softora_coldmail_send_guard_v1',
    getUiState: async () => ({
      values: {
        softora_coldmail_send_guard_v1: JSON.stringify({
          recipientEntries: [
            {
              recipientKey: 'email:info@example.nl',
              recipientEmail: 'info@example.nl',
              recipientDomain: 'example-nl',
              recipientId: 'customer-guarded',
            },
          ],
        }),
      },
    }),
  });

  await controller.load();

  assert.equal(
    controller.hasGuard({
      id: 'customer-guarded',
      email: 'info@example.nl',
      website: 'https://example.nl',
    }),
    true
  );
  assert.equal(
    controller.hasGuard({
      id: 'customer-fresh',
      email: 'info@fresh-example.nl',
      website: 'https://fresh-example.nl',
    }),
    false
  );
});

  test('premium database page renders the dedicated database UI while preserving persistence hooks', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const importScriptPath = path.join(__dirname, '../../assets/premium-database-import.js');
  const photoBatchScriptPath = path.join(__dirname, '../../assets/premium-database-photo-batch.js');
  const webdesignAssetStateScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-asset-state.js');
  const webdesignActionScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-action.js');
  const webdesignPreviewScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-preview.js');
  const apiCostLedgerScriptPath = path.join(__dirname, '../../assets/softora-api-cost-ledger.js');
  const photoStorageScriptPath = path.join(__dirname, '../../assets/premium-database-photo-storage.js');
  const webdesignMockupScriptPath = path.join(__dirname, '../../assets/premium-database-webdesign-mockup.js');
  const deepSearchScriptPath = path.join(__dirname, '../../assets/premium-database-deep-search.js');
  const contactStatusScriptPath = path.join(__dirname, '../../assets/premium-database-contact-status.js');
  const instantlySyncScriptPath = path.join(__dirname, '../../assets/premium-database-instantly-sync.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const importScriptSource = fs.readFileSync(importScriptPath, 'utf8');
  const photoBatchScriptSource = fs.readFileSync(photoBatchScriptPath, 'utf8');
  const webdesignAssetStateScriptSource = fs.readFileSync(webdesignAssetStateScriptPath, 'utf8');
  const webdesignActionScriptSource = fs.readFileSync(webdesignActionScriptPath, 'utf8');
  const webdesignPreviewScriptSource = fs.readFileSync(webdesignPreviewScriptPath, 'utf8');
  const apiCostLedgerScriptSource = fs.readFileSync(apiCostLedgerScriptPath, 'utf8');
  const photoStorageScriptSource = fs.readFileSync(photoStorageScriptPath, 'utf8');
  const webdesignMockupScriptSource = fs.readFileSync(webdesignMockupScriptPath, 'utf8');
  const deepSearchScriptSource = fs.readFileSync(deepSearchScriptPath, 'utf8');
  const contactStatusScriptSource = fs.readFileSync(contactStatusScriptPath, 'utf8');
  const instantlySyncScriptSource = fs.readFileSync(instantlySyncScriptPath, 'utf8');

  assert.match(pageSource, /<title>Softora \| Database<\/title>/);
  assert.match(pageSource, /family=Inter:wght@300;400;500;600&family=Oswald:wght@400;500;600;700/);
  assert.match(pageSource, /--bg: #080808;/);
  assert.match(pageSource, /--card: #0d0d0d;/);
  assert.match(pageSource, /font-family: 'Inter', sans-serif;/);
  assert.match(pageSource, /\.page-title \{[\s\S]*font-family: 'Oswald', sans-serif;/);
  assert.match(pageSource, /table-layout: fixed;/);
  assert.match(pageSource, /thead th \{[\s\S]*padding: 10px 9px;[\s\S]*letter-spacing: 1\.1px;/);
  assert.match(pageSource, /thead th:nth-child\(1\), tbody td:nth-child\(1\) \{ width: 14%; \}/);
  assert.match(pageSource, /thead th:nth-child\(8\), tbody td:nth-child\(8\) \{ width: 12%; \}/);
  assert.match(pageSource, /thead th:nth-child\(3\), tbody td:nth-child\(3\) \{ width: 14%; \}/);
  assert.match(pageSource, /thead th:nth-child\(6\), tbody td:nth-child\(6\) \{ width: 10%; \}/);
  assert.match(pageSource, /thead th:nth-child\(9\), tbody td:nth-child\(9\) \{[\s\S]*width: 9%;[\s\S]*min-width: 118px;[\s\S]*padding-left: 7px;[\s\S]*padding-right: 7px;/);
  assert.match(pageSource, /table:not\(\.outreach-action-mode\) thead th:nth-child\(10\), table:not\(\.outreach-action-mode\) tbody td:nth-child\(10\) \{ display: none; \}/);
  assert.match(pageSource, /table\.outreach-action-mode thead th:nth-child\(10\), table\.outreach-action-mode tbody td:nth-child\(10\) \{[\s\S]*width: 5%;[\s\S]*min-width: 56px;[\s\S]*text-align: center;/);
  assert.match(pageSource, /\.photo-drop \{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(pageSource, /\.photo-remove \{[\s\S]*width: 14px;[\s\S]*height: 14px;/);
  assert.match(pageSource, /text-overflow: ellipsis;/);
  assert.match(pageSource, /#photoHeader \{[\s\S]*overflow: visible;[\s\S]*text-overflow: clip;[\s\S]*white-space: nowrap;/);
  assert.match(pageSource, /#photoHeader \.photo-header-title \{[\s\S]*display: inline-flex;[\s\S]*min-width: 94px;/);
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
  assert.match(pageSource, /const showPhotoBatchControl = state\.activeStatus === "benaderbaar" \|\| state\.activeStatus === "alle";/);
  assert.match(pageSource, /nodes\.photoCostLabel\.hidden = !showPhotoBatchControl;/);
  assert.match(pageSource, /nodes\.generatePhotosButton\.hidden = !showPhotoBatchControl;/);
  assert.match(pageSource, /eligibleCount \* WEBSITE_PHOTO_COST_EUR/);
  assert.match(pageSource, /nodes\.photoCostLabel\.innerHTML = "<strong>" \+ formatEuroCost\(totalCost\) \+ "<\/strong>";/);
  assert.match(pageSource, /AI-foto kost " \+ formatEuroCost\(WEBSITE_PHOTO_COST_EUR\) \+ " per stuk/);
  assert.doesNotMatch(pageSource, /URL-scan kost €0,00/);
  assert.match(pageSource, /id="generatePhotosButton"/);
  assert.match(pageSource, /class="result-count-icon"/);
  assert.match(pageSource, /<div class="page-title">Database<\/div>/);
  assert.doesNotMatch(pageSource, /AI-database/i);
  assert.doesNotMatch(pageSource, /ai-database-badge/);
  assert.match(pageSource, /<button class="btn prim has-caret" id="addButton" type="button" aria-haspopup="menu" aria-expanded="false">[\s\S]*Acties/);
  assert.match(pageSource, /<button class="add-actions-item" id="deepSearchButton" type="button" role="menuitem">Bedrijven toevoegen<\/button>/);
  assert.match(pageSource, /<button class="add-actions-item" id="manualAddButton" type="button" role="menuitem">Handmatig toevoegen<\/button>/);
  assert.doesNotMatch(pageSource, /id="instantOutreachSyncButton"/);
  assert.doesNotMatch(pageSource, />10 mockup-leads naar Instantly<\/button>/);
  assert.doesNotMatch(pageSource, /Volgende locatie doorzoeken/);
  assert.doesNotMatch(pageSource, /AI werkt de huidige plek automatisch af/);
  assert.doesNotMatch(pageSource, /100 bedrijven toevoegen/);
  assert.doesNotMatch(pageSource, />Uploaden</);
  assert.doesNotMatch(pageSource, />Google Sheet koppelen</);
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
  assert.match(pageSource, /<th>Kanaal<\/th>/);
  assert.doesNotMatch(pageSource, /<th>Gebruikte kanalen<\/th>/);
  assert.match(pageSource, /const websiteValue = normalizeString\(customer\.website \|\| customer\.dom\) \|\| "—";/);
  assert.match(pageSource, /class=\\"website-link\\"/);
  assert.match(pageSource, /target=\\"_blank\\" rel=\\"noopener\\"/);
  assert.match(pageSource, /escapeHtml\(customer\.email \|\| "—"\)/);
  assert.match(pageSource, /escapeHtml\(formatPhoneNumber\(customer\.tel\)\)/);
  assert.match(pageSource, /formatPhoneNumber\(raw && \(raw\.tel \|\| raw\.telefoon \|\| raw\.contactPhone\)\)/);
  assert.match(pageSource, /tel: normalizeString\(nodes\.modalPhone\.value\) \|\| "—",/);
  assert.match(pageSource, /class=\\"company-edit\\"/);
  assert.match(pageSource, /data-edit-id=\\"/);
  assert.match(pageSource, /<th data-sort-key="updatedAt" id="latestActionHeader">Laatste actie<\/th>/);
  assert.match(pageSource, /<th id="photoHeader"><span class="photo-header-title"><span id="photoHeaderLabel">Foto's<\/span> <span id="photoHeaderCount">\(0\)<\/span><\/span><\/th>/);
  assert.match(pageSource, /<th id="daysHeader" hidden>Dagen<\/th>/);
  assert.doesNotMatch(pageSource, /id="myMailsFilterButton"/);
  assert.doesNotMatch(pageSource, /Enkel mijn mails tonen/);
  assert.doesNotMatch(pageSource, /onlyMyMails/);
  assert.doesNotMatch(pageSource, /authenticatedEmail/);
  assert.doesNotMatch(pageSource, /function hydrateDatabaseAuthSession\(\)/);
  assert.doesNotMatch(pageSource, /function customerWasSentFromAuthenticatedEmail\(customer\)/);
  assert.doesNotMatch(pageSource, /nodes\.myMailsFilterButton/);
  assert.match(pageSource, /showOutreachActionColumn = state\.activeStatus === "benaderd" \|\| state\.activeStatus === "instantly", showPhotoColumn = !showOutreachActionColumn/);
  assert.match(pageSource, /function getMailReadyCustomers\(customers\) \{\s*return \(customers \|\| \[\]\)\.filter\(isColdmailReadyWebdesignLead\);/);
  assert.match(pageSource, /function getVisibleTableCustomers\(customers\) \{\s*return state\.activeStatus === "benaderbaar" \? getMailReadyCustomers\(customers\) : \(customers \|\| \[\]\);/);
  assert.match(pageSource, /const baseFiltered = getSortedCustomers\(getFilteredCustomers\(\)\), filtered = getVisibleTableCustomers\(baseFiltered\)/);
  assert.match(pageSource, /document\.getElementById\("latestActionHeader"\)\.textContent = showOutreachActionColumn \? "Acties" : "Laatste actie"; document\.getElementById\("photoHeader"\)\.hidden = !showPhotoColumn; document\.getElementById\("daysHeader"\)\.hidden = !showOutreachActionColumn; if \(nodes\.photoHeaderLabel\) nodes\.photoHeaderLabel\.textContent = state\.activeStatus === "benaderbaar" \? "Mailklaar" : "Foto's";/);
  assert.match(pageSource, /renderPhotoCostLabel\(baseFiltered\);/);
  assert.match(pageSource, /const photoHeaderCount = getPhotoHeaderCount\(filtered, showPhotoColumn\);/);
  assert.match(pageSource, /document\.getElementById\("photoHeaderCount"\)\.textContent = "\(" \+ photoHeaderCount\.toLocaleString\("nl-NL"\) \+ "\)";/);
  assert.match(pageSource, /logDatabaseMediaDebug\("render-table", \{ activeStatus: state\.activeStatus, databaseCount: state\.klanten\.length, filteredCount: baseFiltered\.length, renderedCount: filtered\.length, photoHeaderCount: photoHeaderCount/);
  assert.match(pageSource, /colspan=\\"" \+ \(showOutreachActionColumn \? 8 : 9\) \+ "\\"/);
  assert.match(pageSource, /showOutreachActionColumn \? outreachController\.renderDaysSinceSent\(customer\) : ""/);
  assert.match(pageSource, /<input type="file" id="photoFileInput" accept="image\/\*" hidden>/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_SCOPE = "premium_database_photos";/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_KEY = "softora_database_photos_v1";/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_DATA_PREFIX = "softora_database_photo_data_v1_";/);
  assert.match(pageSource, /const CUSTOMER_PHOTO_CHUNK_SIZE = 180000;/);
  assert.match(pageSource, /websitePhoto: normalizeString\(raw && \(raw\.websitePhoto \|\| raw\.photo \|\| raw\.websiteImage\)\)/);
  assert.match(pageSource, /websiteMockup: normalizeString\(raw && \(raw\.websiteMockup \|\| raw\.mockup \|\| raw\.websiteMockupImage\)\)/);
  assert.match(pageSource, /function shouldShowWebsitePhoto\(customer\)/);
  assert.match(pageSource, /normalizeDatabaseStatus\(customer && customer\.status, customer\) !== "klant"/);
  assert.match(pageSource, /lastMailReadyHeaderCount: null/);
  assert.match(pageSource, /lastPhotoHeaderCount: null/);
  assert.match(pageSource, /assets\/premium-database-webdesign-asset-state\.js\?v=20260529d/);
  assert.match(pageSource, /assets\/premium-database-webdesign-action\.js\?v=20260529d/);
  assert.match(pageSource, /assets\/premium-database-webdesign-mockup\.js\?v=20260529d/);
  assert.match(webdesignAssetStateScriptSource, /function buildWebdesignAssetState\(customer, helpers, runtimeState\)/);
  assert.doesNotMatch(webdesignAssetStateScriptSource, /SUSPECT_MOCKUP_RENDERERS/);
  assert.doesNotMatch(webdesignActionScriptSource, /SUSPECT_MOCKUP_RENDERERS/);
  assert.doesNotMatch(webdesignMockupScriptSource, /SUSPECT_DEVICE_MOCKUP_RENDERERS/);
  assert.match(webdesignAssetStateScriptSource, /mockupApproved: mockupApproved/);
  assert.match(webdesignAssetStateScriptSource, /canGeneratePhoto: canGeneratePhoto/);
  assert.match(webdesignAssetStateScriptSource, /isMailReady: isMailReady/);
  assert.match(pageSource, /function hasApprovedWebdesignMockup\(customer\)/);
  assert.match(pageSource, /return buildCustomerWebdesignAssetState\(customer\)\.mockupApproved;/);
  assert.match(pageSource, /function hasCompleteWebdesignAssets\(customer\)/);
  assert.match(pageSource, /return buildCustomerWebdesignAssetState\(customer\)\.hasCompleteAssets;/);
  assert.match(pageSource, /function isColdmailReadyWebdesignLead\(customer\)/);
  assert.match(pageSource, /return buildCustomerWebdesignAssetState\(customer\)\.isMailReady;/);
  assert.match(pageSource, /outreachController\.hasInstantlyOutreachSignal\(customer\)/);
  assert.match(pageSource, /function getPhotoHeaderCount\(customers, showPhotoColumn\)/);
  assert.match(pageSource, /state\.activeStatus === "benaderbaar"[\s\S]*getMailReadyCustomers\(customers\)\.length/);
  assert.match(pageSource, /function isWebdesignPhotoEligible\(customer\) \{\s*return buildCustomerWebdesignAssetState\(customer\)\.canGeneratePhoto;/);
  assert.match(pageSource, /function renderWebsitePhotoDrop\(customer\)/);
  assert.match(pageSource, /return webdesignActionController\.render\(customer\);/);
  assert.match(pageSource, /window\.SoftoraDatabaseWebdesignAction\.createController\(\{/);
  assert.match(pageSource, /getAssetState: buildCustomerWebdesignAssetState/);
  assert.match(pageSource, /photoRestorePending: true/);
  assert.match(webdesignActionScriptSource, /if \(!shouldShowWebsitePhoto\(customer\)\) return "";/);
  assert.match(webdesignActionScriptSource, /class=\\"photo-drop/);
  assert.match(webdesignActionScriptSource, /class=\\"photo-generate-icon\\"/);
  assert.match(webdesignActionScriptSource, /photo-drop\.is-generating,\.photo-drop\.is-restoring,\.photo-drop\[data-has-photo=\\"true\\"\]\[data-photo-loaded=\\"false\\"\]\{cursor:wait\}/);
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
  assert.doesNotMatch(webdesignActionScriptSource, /Device mockup wordt automatisch gemaakt/);
  assert.match(webdesignActionScriptSource, /Device mockup maken/);
  assert.match(webdesignActionScriptSource, /Klik om device mockup te maken/);
  assert.doesNotMatch(webdesignActionScriptSource, /Device mockup maken zonder extra API-kosten/);
  assert.doesNotMatch(webdesignActionScriptSource, /const mockupSlot = hasPhoto \?/);
  assert.match(webdesignActionScriptSource, /function queueVisibleMissingMockupRepairs\(customers, limit\)/);
  assert.match(webdesignActionScriptSource, /const canGenerateMockup = assetState \? assetState\.canRepairMockup : \(hasPhoto && !hasMockup && !mockupLoading\);/);
  assert.doesNotMatch(webdesignActionScriptSource, /if \(canGenerateMockup\) scheduleMissingMockupPair\(customer && customer\.id\);/);
  assert.match(webdesignActionScriptSource, /ensureMockupForCustomer\(id, \{ silent: true, source: "database-visible-pair" \}\)/);
  assert.match(webdesignActionScriptSource, /data-can-generate=\\"" \+ \(canGenerateMockup \? "true" : "false"\)/);
  assert.match(webdesignActionScriptSource, /data-mockup-disabled=\\"/);
  assert.doesNotMatch(pageSource, /function scheduleVisibleMockupEnsure\(\)/);
  assert.doesNotMatch(pageSource, /webdesignMockupController\.ensureVisibleMockups\(getSortedCustomers\(getFilteredCustomers\(\)\),/);
  assert.match(pageSource, /webdesignActionController\.queueVisibleMissingMockupRepairs\(filtered, 4\)/);
  assert.match(pageSource, /openWebsitePhotoPreview\(state\.photoTargetId, "mockup"\);/);
  assert.match(pageSource, /mockupDrop\.getAttribute\("data-can-generate"\) === "true"/);
  assert.match(pageSource, /webdesignMockupController\.ensureForCustomer\(state\.photoTargetId, \{ force: true \}\)/);
  assert.doesNotMatch(pageSource, /mockupDrop\.getAttribute\("data-can-generate"\) !== "true"/);
  assert.match(webdesignMockupScriptSource, /global\.SoftoraDatabaseWebdesignMockup =/);
  assert.match(webdesignMockupScriptSource, /const DEVICE_MOCKUP_VERSION = "v8";/);
  assert.match(webdesignMockupScriptSource, /gradient\.addColorStop\(0, "#f7f9fc"\);/);
  assert.match(webdesignMockupScriptSource, /rgba\(59, 130, 246, 0\.10\)/);
  assert.doesNotMatch(webdesignMockupScriptSource, /rgba\(139, 34, 82, 0\.08\)/);
  assert.match(webdesignMockupScriptSource, /function drawImageViewportCover/);
  assert.match(webdesignMockupScriptSource, /function drawImageViewportFitWidth/);
  assert.match(webdesignMockupScriptSource, /const scale = width \/ sourceWidth;/);
  assert.match(webdesignMockupScriptSource, /context\.drawImage\(image, 0, 0, sourceWidth, sourceHeight, x, y, width, renderedHeight\);/);
  assert.match(webdesignMockupScriptSource, /fitMode: "viewport-width", cropTopRatio: 0,/);
  assert.match(webdesignMockupScriptSource, /fitMode: "viewport", cropTopRatio: 0, cropFocusX: 0\.5, viewportHeightRatio: 1/);
  assert.match(webdesignMockupScriptSource, /fitMode: "viewport", cropTopRatio: 0, cropFocusX: 0, viewportHeightRatio: 1/);
  assert.doesNotMatch(webdesignMockupScriptSource, /fitMode: "viewport-width", cropTopRatio: 0\.02/);
  assert.doesNotMatch(webdesignMockupScriptSource, /fitMode: "viewport", cropTopRatio: 0\.02, cropFocusX: 0\.5, viewportHeightRatio/);
  assert.match(webdesignMockupScriptSource, /function hasApprovedMockup\(customer, isValidWebsitePhotoSource\)/);
  assert.match(webdesignMockupScriptSource, /function hasUsableMockup\(customer, isValidWebsitePhotoSource\)/);
  assert.match(webdesignMockupScriptSource, /mockupQualityStatus: "checked"/);
  assert.match(webdesignMockupScriptSource, /mockupOrientation: "upright"/);
  assert.doesNotMatch(webdesignMockupScriptSource, /WEBDESIGN PREVIEW/);
  assert.doesNotMatch(webdesignMockupScriptSource, /Laptop - iPad - iPhone/);
  assert.doesNotMatch(webdesignMockupScriptSource, /softora-server-device-v7/);
  assert.match(webdesignMockupScriptSource, /ensureVisibleMockups/);
  assert.match(webdesignMockupScriptSource, /toast\("Device mockup wordt lokaal gemaakt, geen extra API-kosten"\);/);
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
  assert.match(webdesignActionScriptSource, /const PHOTO_READY_SELECTOR = ".photo-drop\[data-has-photo=\\"true\\"\], .photo-drop--mockup\[data-has-photo=\\"true\\"\]";/);
  assert.match(webdesignActionScriptSource, /const pendingIds = new Set\(\);/);
  assert.match(webdesignActionScriptSource, /const pollTimers = new Map\(\);/);
  assert.match(webdesignActionScriptSource, /const loadedPhotoKeys = getSharedLoadedPhotoKeys\(\);/);
  assert.match(webdesignActionScriptSource, /const PHOTO_LOAD_CACHE_PROPERTY = "__SoftoraDatabasePhotoLoadCacheV1";/);
  assert.match(webdesignActionScriptSource, /const PHOTO_LOAD_CACHE_LIMIT = 2500;/);
  assert.match(webdesignActionScriptSource, /function trimLoadedPhotoKeys\(\)/);
  assert.match(webdesignActionScriptSource, /const failedPhotoKeys = new Set\(\);/);
  assert.match(webdesignActionScriptSource, /const PHOTO_LOAD_FALLBACK_MS = 20000;/);
  assert.match(webdesignActionScriptSource, /function buildPhotoLoadKey\(kind, customerId, source\)/);
  assert.match(webdesignActionScriptSource, /function isInlinePhotoSource\(source\)/);
  assert.match(webdesignActionScriptSource, /isInlinePhotoSource\(photo\) \|\| loadedPhotoKeys\.has\(photoLoadKey\)/);
  assert.match(webdesignActionScriptSource, /isInlinePhotoSource\(mockup\) \|\| loadedPhotoKeys\.has\(mockupLoadKey\)/);
  assert.match(webdesignActionScriptSource, /data-photo-key=\\"/);
  assert.match(webdesignActionScriptSource, /data-photo-error=\\"/);
  assert.match(webdesignActionScriptSource, /\.photo-drop\[data-photo-error=\\"true\\"\] \.photo-drop-image,\.photo-drop\[data-photo-error=\\"true\\"\] \.photo-drop-loader\{display:none\}/);
  assert.match(webdesignActionScriptSource, /photo-drop-loader\{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;/);
  assert.match(webdesignActionScriptSource, /photo-drop-image\{width:100%;height:100%;object-fit:cover;display:block;opacity:0;/);
  assert.match(webdesignActionScriptSource, /\.photo-cell\{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:72px;min-width:72px;line-height:0\}/);
  assert.match(webdesignPreviewScriptSource, /\.photo-cell\{width:98px;min-width:98px\}/);
  assert.match(webdesignPreviewScriptSource, /const COMPARE_ICON = "<svg class=\\"photo-compare-icon\\"/);
  assert.match(webdesignPreviewScriptSource, /href=\\"https:\/\/www\.softora\.nl\/webdesign\//);
  assert.match(webdesignPreviewScriptSource, /data-public-preview-id=\\"/);
  assert.match(webdesignPreviewScriptSource, /nodes\.photoPreviewMeta\.hidden = true/);
  assert.doesNotMatch(webdesignPreviewScriptSource, /customer\.bedrijf \+ " · naast elkaar"/);
  assert.match(webdesignActionScriptSource, /\.photo-drop\{position:relative;flex:0 0 34px;aspect-ratio:1\/1;overflow:hidden;contain:layout paint\}/);
  assert.match(webdesignActionScriptSource, /function hydratePhotoDrops\(root\)/);
  assert.match(webdesignActionScriptSource, /const PHOTO_LOAD_RETRY_AFTER_MS = 30000;/);
  assert.match(webdesignActionScriptSource, /logMediaDebug\(failed \? "image-load-error" : "image-load-success", getPhotoDropDebug\(drop\)\);/);
  assert.match(webdesignActionScriptSource, /fetchpriority=\\"low\\"/);
  assert.match(webdesignActionScriptSource, /function createPhotoLoadBinding\(drop, key\)/);
  assert.match(webdesignActionScriptSource, /data-photo-load-binding/);
  assert.match(webdesignActionScriptSource, /image-load-stale/);
  assert.match(webdesignActionScriptSource, /if \(hasPhoto \|\| hasMockup\) schedulePhotoDropHydration\(\);/);
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
  assert.match(photoStorageScriptSource, /function buildLoadCacheKey\(customers\)/);
  assert.match(photoStorageScriptSource, /function clearLoadCache\(\)/);
  assert.match(photoStorageScriptSource, /cachedLoadPromise && cachedLoadKey === loadKey/);
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
  assert.match(webdesignAssetStateScriptSource, /fallbackPhotosById/);
  assert.match(webdesignAssetStateScriptSource, /websiteMockup: websiteMockup/);
  assert.match(webdesignAssetStateScriptSource, /firstValidSource\(photo && photo\.websiteMockup, fallbackPhoto && fallbackPhoto\.websiteMockup, normalized\.websiteMockup\)/);
  assert.match(pageSource, /customersWithFallbackMedia = mergeCustomersWithPhotos\(enrichedCustomers, \{\}, state\.klanten\)/);
  assert.match(pageSource, /mergeCustomersWithPhotos\(enrichedCustomers, photoMap, customersWithFallbackMedia\)/);
  assert.match(pageSource, /function loadCustomerPhotoMap\(customers, options\)/);
  assert.match(pageSource, /function serializeWebsitePhotoForDiff\(value\)/);
  assert.match(pageSource, /isValidWebsitePhotoUrl\(photo\) \? "url" : ""/);
  assert.match(pageSource, /websitePhoto: serializeWebsitePhotoForDiff\(normalized\.websitePhoto\)/);
  assert.match(pageSource, /websiteMockup: serializeWebsitePhotoForDiff\(normalized\.websiteMockup\)/);
  assert.match(photoStorageScriptSource, /readChunkedData\(values, photoKey, 0\)/);
  assert.match(pageSource, /compressWebsitePhotoDataUrl\(original\.dataUrl, original\.fileName, 1440, 2160, 0\.86\)/);
  assert.match(pageSource, /compressWebsitePhotoDataUrl\(original\.dataUrl, original\.fileName, 768, 1152, 0\.74\)/);
  assert.match(pageSource, /<div class="photo-preview" id="photoPreview"/);
  assert.match(webdesignPreviewScriptSource, /global\.SoftoraDatabaseWebdesignPreview =/);
  assert.match(webdesignPreviewScriptSource, /function openComparison\(nodes, customer, helpers\)/);
  assert.match(webdesignPreviewScriptSource, /compare\.id = "photoPreviewCompare"/);
  assert.match(webdesignPreviewScriptSource, /"photoPreviewComparePhoto", "photoPreviewComparePhotoCaption"/);
  assert.match(webdesignPreviewScriptSource, /"photoPreviewCompareMockup", "photoPreviewCompareMockupCaption"/);
  assert.match(pageSource, /kind === "compare"/);
  assert.match(pageSource, /window\.SoftoraDatabaseWebdesignPreview\.openComparison\(nodes, customer/);
  assert.doesNotMatch(pageSource, /comparePhotoLink/);
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
  assert.match(pageSource, /assets\/premium-database-webdesign-asset-state\.js\?v=20260529d/);
  assert.match(pageSource, /assets\/premium-database-webdesign-action\.js\?v=20260529d/);
  assert.match(pageSource, /assets\/premium-database-webdesign-preview\.js\?v=20260529c/);
  assert.match(pageSource, /assets\/softora-api-cost-ledger\.js\?v=20260428a/);
  assert.match(pageSource, /assets\/premium-database-photo-storage\.js\?v=20260527b/);
  assert.match(pageSource, /assets\/premium-database-webdesign-mockup\.js\?v=20260529d/);
  assert.match(pageSource, /assets\/premium-database-deep-search\.js\?v=20260521d/);
  assert.match(pageSource, /assets\/premium-database-contact-status\.js\?v=20260519a/);
  assert.match(pageSource, /assets\/premium-database-instantly-sync\.js\?v=20260526b/);
  assert.match(instantlySyncScriptSource, /window\.location\.reload\(\)/);
  assert.match(instantlySyncScriptSource, /Database wordt ververst/);
  assert.match(instantlySyncScriptSource, /window\.alert\(text\)/);
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
  assert.doesNotMatch(pageSource, /Promise\.allSettled\(targets\.map\(function \(target\) \{/);
  assert.match(pageSource, /for \(const target of targets\) \{/);
  assert.match(pageSource, /await webdesignActionController\.generateForCustomer\(target\.id\);/);
  assert.doesNotMatch(pageSource, /return webdesignActionController\.generateForCustomer\(target\.id\);/);
  assert.doesNotMatch(pageSource, /Webdesign maken voor " \+ target\.bedrijf/);
  assert.doesNotMatch(pageSource, /AI-foto maken voor " \+ target\.bedrijf/);
  assert.match(pageSource, /const photoResult = await persistCustomerPhotos\(state\.klanten, \{ onlyCustomerIds: \[customerId\] \}\);/);
  assert.doesNotMatch(pageSource, /onlyCustomerIds: \[target\.id\]/);
  assert.match(pageSource, /setStatusMessage\(""\);[\s\S]*for \(const target of targets\)/);
  assert.doesNotMatch(pageSource, /fetch\("\/api\/website-preview\/generate"/);
  assert.match(pageSource, /nodes\.generatePhotosButton\.addEventListener\("click"/);
  assert.match(pageSource, /void webdesignActionController\.generateForCustomer\(state\.photoTargetId\);/);
  assert.match(pageSource, /renderPage: renderPage/);
  assert.match(webdesignActionScriptSource, /const JOB_ENDPOINT = "\/api\/premium-database\/webdesign-photo-jobs";/);
  assert.match(webdesignActionScriptSource, /const pendingJobs = new Map\(\);/);
  assert.doesNotMatch(webdesignActionScriptSource, /keepalive: true/);
  assert.match(webdesignActionScriptSource, /Webdesign-opdracht niet gevonden\. Probeer opnieuw\./);
  assert.doesNotMatch(webdesignActionScriptSource, /setStatusMessage\(message, "error", true\)/);
  assert.doesNotMatch(webdesignActionScriptSource, /Geen geldige website gevonden voor " \+ target\.bedrijf \+ "\.", "error", true/);
  assert.match(webdesignActionScriptSource, /function resumePendingJobs\(\)/);
  assert.match(webdesignActionScriptSource, /return firstLoad;/);
  assert.match(webdesignActionScriptSource, /async function loadRunningJobs\(\)/);
  assert.match(webdesignActionScriptSource, /function resolveJobPollDelay\(job\)/);
  assert.match(webdesignActionScriptSource, /schedulePoll\(jobId, resolveJobPollDelay\(job\)\);/);
  assert.match(webdesignActionScriptSource, /fetch\(JOB_ENDPOINT,/);
  assert.doesNotMatch(webdesignActionScriptSource, /localStorage/);
  assert.doesNotMatch(webdesignActionScriptSource, /sessionStorage/);
  assert.match(pageSource, /window\.SoftoraDatabaseWebdesignMockup\.createController\(\{/);
  assert.match(pageSource, /ensureMockupForCustomer: function \(customerId, ensureOptions\)/);
  assert.match(pageSource, /refreshPhotos: async function \(context\)/);
  assert.match(pageSource, /const databaseBootStartedAt = Date\.now\(\), databaseHadBootstrapCustomers = initialBootstrapCustomers\.length > 0, releaseDatabaseBootShell =/);
  assert.match(pageSource, /SoftoraPremiumBootTiming\?\.release\(databaseBootStartedAt, 1000\)/);
  assert.match(webdesignActionScriptSource, /async function preloadPhotoImages\(customers, limit, timeoutMs\)/);
  assert.match(webdesignActionScriptSource, /function waitForPhotoImage\(photo, timeoutMs, loadKey\)/);
  assert.match(webdesignActionScriptSource, /markPhotoKeyLoaded\(loadKey\)/);
  assert.match(pageSource, /if \(databaseHadBootstrapCustomers && state\.klanten\.length\) \{/);
  assert.match(pageSource, /const photoMap = await loadCustomerPhotoMap\(state\.klanten\);/);
  assert.match(pageSource, /loadCustomerPhotoMap\(state\.klanten, \{ force: true \}\)/);
  assert.match(pageSource, /const photoMap = await loadCustomerPhotoMap\(enrichedCustomers, \{ force: true \}\);/);
  assert.match(pageSource, /applyCustomerList\(mergeCustomersWithPhotos\(state\.klanten, photoMap, state\.klanten\), false\);/);
  assert.match(pageSource, /else \{\s*await bootstrapCustomers\(\);\s*\}/);
  assert.match(pageSource, /await webdesignActionController\.preloadPhotoImages\(getSortedCustomers\(getFilteredCustomers\(\)\), 16, 1200\);/);
  assert.match(pageSource, /await webdesignActionController\.preloadPhotoImages\(getSortedCustomers\(getFilteredCustomers\(\)\), 16, 1200\);[\s\S]*state\.photoRestorePending = false;[\s\S]*renderPage\(\);[\s\S]*releaseDatabaseBootShell\(\);/);
  assert.doesNotMatch(pageSource, /void webdesignMockupController\.ensureVisibleMockups\(getSortedCustomers\(getFilteredCustomers\(\)\), 12\)\.catch/);
  assert.doesNotMatch(pageSource, /window\.setTimeout\(function \(\) \{ resolve\(false\); \}, 850\);/);
  assert.doesNotMatch(pageSource, /releaseDatabaseBootShell\(\); void webdesignActionController\.preloadPhotoImages/);
  assert.match(pageSource, /void webdesignActionController\.resumePendingJobs\(\)\.catch/);
  assert.doesNotMatch(pageSource, /void bootstrapCustomers\(\)\.catch\(function \(error\) \{ console\.error\("Database sync na snelle boot mislukt:", error\); \}\);/);
  assert.match(pageSource, /function refreshCustomerStateSilently\(\)/);
  assert.match(pageSource, /window\.setInterval\(function \(\) \{[\s\S]*void refreshCustomerStateSilently\(\);[\s\S]*\}, CUSTOMER_DB_SYNC_INTERVAL_MS\);/);
  assert.match(pageSource, /startCustomerStateAutoRefresh\(\);/);
  assert.doesNotMatch(pageSource, /if \(databaseHadBootstrapCustomers\) releaseDatabaseBootShell\(\); await bootstrapCustomers\(\);/);
  assert.match(webdesignActionScriptSource, /pendingIds\.add\(job\.customerId\);/);
  assert.match(webdesignActionScriptSource, /fetch\(JOB_ENDPOINT/);
  assert.match(webdesignActionScriptSource, /loading=\\"lazy\\" fetchpriority=\\"low\\" decoding=\\"async\\" width=\\"34\\" height=\\"34\\"/);
  assert.match(webdesignActionScriptSource, /preloadPhotoImages: preloadPhotoImages/);
  assert.match(webdesignActionScriptSource, /photos\.push\(\{ source: mockup, key: buildPhotoLoadKey\("mockup"/);
  assert.match(webdesignMockupScriptSource, /const pendingReserved = Boolean\(ensureOptions && ensureOptions\.pendingReserved\);/);
  assert.match(webdesignMockupScriptSource, /const reservedPendingIds = visible\.map/);
  assert.match(webdesignMockupScriptSource, /reservedPendingIds\.forEach\(function \(id\) \{ pendingIds\.add\(id\); \}\);/);
  assert.match(webdesignMockupScriptSource, /ensureForCustomer\(customer\.id, \{ pendingReserved: true \}\)/);
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
  assert.match(pageSource, /deepSearchButton: document\.getElementById\("deepSearchButton"\), manualAddButton: document\.getElementById\("manualAddButton"\),/);
  assert.match(pageSource, /nodes\.modalCompany\.focus\(\);/);
  assert.match(pageSource, /nodes\.addActionsMenu\.addEventListener\("click", function \(event\) \{ const actionButton = event\.target\.closest\("\.add-actions-item"\); if \(!actionButton\) return; closeAddActions\(\); if \(actionButton === nodes\.manualAddButton\) \{ openModal\(\); return; \} if \(actionButton === nodes\.deepSearchButton\) databaseDeepSearchController\.open\(\); \}\);/);
  assert.match(pageSource, /website: normalizeString\(nodes\.modalDomain\.value\) \|\| dom,/);
  assert.match(pageSource, /openEditCustomerModal\(editButton\.getAttribute\("data-edit-id"\)\)/);
  assert.match(pageSource, /removeWebsitePhotoForCustomer\(removePhotoButton\.getAttribute\("data-remove-photo-id"\)\)/);
  assert.doesNotMatch(pageSource, /const row = event\.target\.closest\("tr\[data-id\]"\);[\s\S]*openPanel\(row\.getAttribute\("data-id"\)\);/);
  assert.doesNotMatch(pageSource, /tbody tr \{[^}]*cursor: pointer;/);
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
  assert.match(pageSource, /<script src="assets\/premium-database-import\.js\?v=20260521b"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-database-deep-search-helpers\.js\?v=20260521b"><\/script><script src="assets\/premium-database-target-coords\.js\?v=20260522a"><\/script><script src="assets\/premium-database-deep-search\.js\?v=20260521d"><\/script>/);
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
  assert.match(pageSource, /nodes\.addActionsMenu\.addEventListener\("click"/);
  assert.match(pageSource, /databaseDeepSearchController\.open\(\);/);
  assert.match(deepSearchScriptSource, /function parseTargetLines\(raw\)/);
  assert.match(deepSearchScriptSource, /DEFAULT_TARGET_TEXT/);
  assert.match(deepSearchScriptSource, /DEFAULT_TARGET_TEXT_BASE64/);
  assert.match(deepSearchScriptSource, /function decodeBase64Utf8\(value\)/);
  assert.match(deepSearchScriptSource, /TARGET_ORDER_VERSION = "distance-oisterwijk-v4"/);
  assert.match(deepSearchScriptSource, /PREVIOUS_TARGET_ORDER_VERSION = "distance-oisterwijk-v3"/);
  assert.match(deepSearchScriptSource, /LEGACY_TARGET_ORDER_VERSION_V2 = "distance-oisterwijk-v2"/);
  assert.match(deepSearchScriptSource, /function getRawDefaultTargetLabels\(\)/);
  assert.match(deepSearchScriptSource, /function getDefaultTargetLabels\(\)/);
  const rawTargetLines = readDefaultDeepSearchTargetLines(deepSearchScriptSource);
  const defaultTargetLines = loadDatabaseDeepSearchClient().getDefaultTargetLabels();
  const distanceClient = loadDatabaseDistanceClient();
  assert.equal(rawTargetLines.length, 2493);
  assert.equal(defaultTargetLines.length, 2493);
  assert.equal(defaultTargetLines[0], 'Nederland | Noord-Brabant | Vught | Helvoirt');
  assert.equal(defaultTargetLines.some((label) => label.startsWith('Nederland | Noord-Brabant | Oisterwijk | ')), false);
  assert.equal(defaultTargetLines.some((label) => label.startsWith('Nederland | Noord-Brabant | Tilburg | ')), false);
  let previousTargetDistance = -Infinity;
  for (const label of defaultTargetLines) {
    const targetDistance = distanceClient.getTargetDistanceKm(label);
    assert.ok(Number.isFinite(targetDistance), `${label} should have target coordinates`);
    assert.ok(
      targetDistance + 1e-9 >= previousTargetDistance,
      `${label} should not be closer than the previous planned target`
    );
    previousTargetDistance = targetDistance;
  }
  assert.ok(defaultTargetLines.indexOf('Nederland | Noord-Brabant | Vught | Helvoirt') < defaultTargetLines.indexOf('Nederland | Noord-Brabant | Altena | Almkerk'));
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
  assert.match(deepSearchScriptSource, /Richtprijs voor maximaal/);
  assert.match(deepSearchScriptSource, /fetch\("\/api\/premium-database\/deep-search-estimate\?count="/);
  assert.match(deepSearchScriptSource, /function readDeepSearchEstimate\(companyCount\)/);
  assert.match(deepSearchScriptSource, /function formatDeepSearchEstimateLabel\(desiredCount\)/);
  assert.match(deepSearchScriptSource, /formatDeepSearchEstimateLabel\(desiredCount\)/);
  assert.match(deepSearchScriptSource, /" via " \+ model/);
  assert.match(deepSearchScriptSource, /dashboard kan afwijken/);
  assert.match(deepSearchScriptSource, /function estimateRunUsd\(companyCount\)/);
  assert.match(deepSearchScriptSource, /function estimateRunUpperUsd\(companyCount\)/);
  assert.match(deepSearchScriptSource, /outputTokensPerCompany/);
  assert.match(deepSearchScriptSource, /ESTIMATED_DEEP_SEARCH_MODEL = "gpt-5\.4"/);
  assert.match(deepSearchScriptSource, /serviceTier: "flex"/);
  assert.match(deepSearchScriptSource, /inputTokensPerBatch: 6000/);
  assert.match(deepSearchScriptSource, /practicalMultiplier: 2\.2/);
  assert.match(deepSearchScriptSource, /inputUsdPerMillion: 1\.25/);
  assert.match(deepSearchScriptSource, /outputUsdPerMillion: 7\.5/);
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
  assert.match(deepSearchScriptSource, /deep-search-close\.is-loading, \.modal-bg\.is-running \.deep-search-close \{ width: 30px; height: 30px;/);
  assert.match(deepSearchScriptSource, /deep-search-close-spinner \{ display: block; width: 18px; height: 18px;/);
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
  assert.match(pageSource, /const COLDMAIL_TEST_COMPANIES = \["mcv e-commerce", "softora testmodus"\];/);
  assert.match(pageSource, /function isColdmailTestCompany\(customer\)/);
  assert.match(contactStatusScriptSource, /function hasColdmailSentSignal\(raw, helpers\)/);
  assert.match(contactStatusScriptSource, /function shouldInferMailedStatus\(storedStatus, raw, helpers\)/);
  assert.match(pageSource, /inferredStatus === "gemaild" \? "benaderbaar" : inferredStatus/);
  assert.match(pageSource, /const inferredStatus = databaseContactStatus\.shouldInferMailedStatus\(storedStatus, raw, \{ normalizeString, normalizeSearchValue \}\) \? "gemaild" : storedStatus;/);
  assert.match(pageSource, /if \(isColdmailTestCompany\(customer\)\) return false;/);
  assert.match(contactStatusScriptSource, /normalizeOutreachStatusKey\(raw\.outreachStatus, helpers\) === "benaderd"/);
  assert.match(contactStatusScriptSource, /raw\.coldmailSentMessageId \|\| raw\.outreachMessageId/);
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

test('premium database webdesign action keeps loaded photo slots stable across re-renders', () => {
  const webdesignActionClient = loadDatabaseWebdesignActionClient();
  const customer = {
    id: 'customer-1',
    websitePhoto: 'https://assets.softora.test/customer-1.png',
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  };
  const controller = webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^(data:image\/|https:\/\/)/.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });

  const html = controller.render(customer);
  const key = html.match(/data-photo-key="([^"]+)"/)[1];
  const attrs = new Map([
    ['data-photo-key', key],
    ['data-photo-loaded', 'false'],
    ['data-photo-error', 'false'],
  ]);
  const drop = {
    querySelector: (selector) => selector === '.photo-drop-image'
      ? { complete: true, naturalWidth: 12, addEventListener() {} }
      : null,
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
  };

  assert.match(html, /data-photo-loaded="false"/);
  assert.match(html, /class="photo-drop-loader"/);
  assert.match(html, /class="photo-drop-image"/);

  controller.hydratePhotoDrops({ querySelectorAll: () => [drop] });

  assert.equal(attrs.get('data-photo-loaded'), 'true');
  assert.equal(attrs.get('data-photo-error'), 'false');
  assert.match(controller.render(customer), /data-photo-loaded="true"/);
});

test('premium database webdesign action renders stored inline photos as ready without a reload flash', () => {
  const webdesignActionClient = loadDatabaseWebdesignActionClient();
  const customer = {
    id: 'customer-1',
    bedrijf: 'Aagje van Os',
    websitePhoto: 'data:image/png;base64,AAA',
    websitePhotoName: 'Websitefoto',
    websiteMockup: 'data:image/jpeg;base64,BBB',
    websiteMockupName: 'Device mockup',
  };
  const controller = webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });

  const html = controller.render(customer);
  const loadedFlags = html.match(/data-photo-loaded="true"/g) || [];

  assert.equal(loadedFlags.length, 2);
  assert.doesNotMatch(html, /data-photo-loaded="false"/);
  assert.match(html, /class="photo-compare-link"/);
  assert.match(html, /href="https:\/\/www\.softora\.nl\/webdesign\/aagje-van-os"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /data-public-preview-id="customer-1"/);
  assert.match(html, /aria-label="Open openbare previewpagina"/);
});

test('premium database webdesign action queues missing mockup repairs outside render', async () => {
  const webdesignActionClient = loadDatabaseWebdesignActionClient();
  const ensured = [];
  const customer = {
    id: 'customer-1',
    websitePhoto: 'data:image/png;base64,AAA',
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  };
  const controller = webdesignActionClient.createController({
    state: { klanten: [customer] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    getAssetState(item) {
      return {
        hasPhoto: /^data:image\//.test(String(item.websitePhoto || '')),
        hasMockup: /^data:image\//.test(String(item.websiteMockup || '')),
        mockupPending: false,
        canRepairMockup: /^data:image\//.test(String(item.websitePhoto || '')) && !/^data:image\//.test(String(item.websiteMockup || '')),
      };
    },
    ensureMockupForCustomer(customerId, ensureOptions) {
      ensured.push({ customerId, ensureOptions });
      return true;
    },
    isMockupPending: () => false,
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });

  const html = controller.render(customer);
  await Promise.resolve();

  assert.match(html, /data-can-generate="true"/);
  assert.equal(ensured.length, 0);

  assert.equal(controller.queueVisibleMissingMockupRepairs([customer], 4), 1);
  assert.equal(controller.queueVisibleMissingMockupRepairs([customer], 4), 0);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(ensured.length, 1);
  assert.equal(ensured[0].customerId, 'customer-1');
  assert.equal(ensured[0].ensureOptions.silent, true);
  assert.equal(ensured[0].ensureOptions.source, 'database-visible-pair');
});

test('premium database webdesign action remembers loaded photos when the page controller is recreated', () => {
  const webdesignActionClient = loadDatabaseWebdesignActionClient();
  const customer = {
    id: 'customer-1',
    websitePhoto: 'https://assets.softora.test/customer-1.png',
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  };
  const createController = () => webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^(data:image\/|https:\/\/)/.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });

  const firstController = createController();
  const firstHtml = firstController.render(customer);
  const key = firstHtml.match(/data-photo-key="([^"]+)"/)[1];
  const attrs = new Map([
    ['data-photo-key', key],
    ['data-photo-loaded', 'false'],
    ['data-photo-error', 'false'],
  ]);
  const drop = {
    querySelector: (selector) => selector === '.photo-drop-image'
      ? { complete: true, naturalWidth: 12, addEventListener() {} }
      : null,
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
  };

  firstController.hydratePhotoDrops({ querySelectorAll: () => [drop] });

  assert.match(createController().render(customer), /data-photo-loaded="true"/);
});

test('premium database webdesign action keeps loaded photo memory for large database pages', () => {
  const webdesignActionClient = loadDatabaseWebdesignActionClient();
  const controller = webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^(data:image\/|https:\/\/)/.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });
  const customers = Array.from({ length: 800 }, (_, index) => ({
    id: `customer-${index}`,
    websitePhoto: `https://assets.softora.test/customer-${index}.png`,
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  }));

  customers.forEach((customer) => {
    const html = controller.render(customer);
    const key = html.match(/data-photo-key="([^"]+)"/)[1];
    const attrs = new Map([
      ['data-photo-key', key],
      ['data-photo-loaded', 'false'],
      ['data-photo-error', 'false'],
    ]);
    const drop = {
      querySelector: (selector) => selector === '.photo-drop-image'
        ? { complete: true, naturalWidth: 12, addEventListener() {} }
        : null,
      getAttribute: (name) => attrs.get(name) || '',
      setAttribute: (name, value) => attrs.set(name, String(value)),
      removeAttribute: (name) => attrs.delete(name),
    };
    controller.hydratePhotoDrops({ querySelectorAll: () => [drop] });
  });

  assert.match(controller.render(customers[0]), /data-photo-loaded="true"/);
  assert.match(controller.render(customers[799]), /data-photo-loaded="true"/);
});

test('premium database webdesign action keeps generation errors visible until the next action', async () => {
  const messages = [];
  const chargeLabels = [];
  const document = {
    getElementById: () => null,
    createElement: () => ({ ...createClassListNode(), style: {} }),
    querySelectorAll: () => chargeLabels,
    head: { appendChild() {} },
    body: {
      appendChild(node) {
        node.parentNode = {
          removeChild(child) {
            const index = chargeLabels.indexOf(child);
            if (index >= 0) chargeLabels.splice(index, 1);
            child.parentNode = null;
          },
        };
        chargeLabels.push(node);
      },
    },
  };
  const webdesignActionClient = loadDatabaseWebdesignActionClient({
    document,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        job: {
          id: 'job-timeout-1',
          customerId: 'customer-1',
          status: 'error',
          error: 'Webdesign maken duurde te lang. Probeer opnieuw.',
        },
      }),
    }),
  });
  const controller = webdesignActionClient.createController({
    state: {
      klanten: [{
        id: 'customer-1',
        bedrijf: 'Softora Testmodus',
        website: 'softora.nl',
        dom: 'softora.nl',
        websitePhoto: '',
      }],
    },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => 'https://softora.nl/',
    isWebdesignPhotoEligible: () => true,
    openWebsitePhotoPreview() {},
    setStatusMessage(message, tone, autoClear) {
      messages.push({ message, tone, autoClear });
    },
    renderPage() {},
    refreshPhotos: async () => {},
  });

  await controller.generateForCustomer('customer-1');

  const errorMessage = messages.find((item) => item.tone === 'error');
  assert.ok(errorMessage);
  assert.equal(errorMessage.message, 'Webdesign maken duurde te lang. Probeer opnieuw.');
  assert.equal(errorMessage.autoClear, undefined);
});

test('premium database webdesign action silently drops restored jobs that disappeared server-side', async () => {
  const messages = [];
  const timers = [];
  const refreshed = [];
  const webdesignActionClient = loadDatabaseWebdesignActionClient({
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    fetch: async (url) => {
      const target = String(url || '');
      if (target === '/api/premium-database/webdesign-photo-jobs') {
        return {
          ok: true,
          json: async () => ({
            jobs: [{
              id: 'stale-restored-job',
              customerId: 'customer-1',
              status: 'running',
              createdAt: Date.now() - 60_000,
            }],
          }),
        };
      }
      if (target === '/api/premium-database/webdesign-photo-jobs/stale-restored-job') {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });
  const controller = webdesignActionClient.createController({
    state: {
      klanten: [{
        id: 'customer-1',
        bedrijf: 'Softora Testmodus',
        website: 'softora.nl',
        dom: 'softora.nl',
        websitePhoto: '',
      }],
    },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => 'https://softora.nl/',
    isWebdesignPhotoEligible: () => true,
    openWebsitePhotoPreview() {},
    setStatusMessage(message, tone, autoClear) {
      messages.push({ message, tone, autoClear });
    },
    renderPage() {},
    refreshPhotos: async (context) => {
      refreshed.push(context);
    },
  });

  await controller.resumePendingJobs();
  const pollTimer = timers.find((timer) => Number(timer.delay) === 0);
  assert.ok(pollTimer, 'restored running job should schedule an immediate poll');

  pollTimer.callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(messages.filter((item) => item.tone === 'error'), []);
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].customerId, 'customer-1');
});

test('premium database webdesign action remembers failed photo slots as a quiet fallback', () => {
  const listeners = {};
  const webdesignActionClient = loadDatabaseWebdesignActionClient();
  const customer = {
    id: 'customer-1',
    websitePhoto: 'https://assets.softora.test/customer-1.png',
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  };
  const controller = webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^(data:image\/|https:\/\/)/.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });
  const html = controller.render(customer);
  const key = html.match(/data-photo-key="([^"]+)"/)[1];
  const attrs = new Map([
    ['data-photo-key', key],
    ['data-photo-loaded', 'false'],
    ['data-photo-error', 'false'],
  ]);
  const drop = {
    querySelector: (selector) => selector === '.photo-drop-image'
      ? {
          complete: false,
          naturalWidth: 0,
          addEventListener(eventName, handler) {
            listeners[eventName] = handler;
          },
        }
      : null,
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
  };

  controller.hydratePhotoDrops({ querySelectorAll: () => [drop] });
  listeners.error();

  assert.equal(attrs.get('data-photo-loaded'), 'true');
  assert.equal(attrs.get('data-photo-error'), 'true');
  assert.match(controller.render(customer), /class="photo-fallback-icon"/);

  const fallbackAttrs = new Map([
    ['data-photo-key', key],
    ['data-photo-loaded', 'true'],
    ['data-photo-error', 'true'],
  ]);
  const fallbackDrop = {
    querySelector: () => null,
    getAttribute: (name) => fallbackAttrs.get(name) || '',
    setAttribute: (name, value) => fallbackAttrs.set(name, String(value)),
    removeAttribute: (name) => fallbackAttrs.delete(name),
  };
  controller.hydratePhotoDrops({ querySelectorAll: () => [fallbackDrop] });

  assert.equal(fallbackAttrs.get('data-photo-error'), 'true');
  assert.match(controller.render(customer), /class="photo-fallback-icon"/);
});

test('premium database webdesign action hides stalled saved photos behind a quiet fallback', () => {
  let fallbackHandler = null;
  let clearedTimer = null;
  const webdesignActionClient = loadDatabaseWebdesignActionClient({
    setTimeout(handler) {
      fallbackHandler = handler;
      return 42;
    },
    clearTimeout(timerId) {
      clearedTimer = timerId;
    },
  });
  const customer = {
    id: 'customer-1',
    websitePhoto: 'data:image/png;base64,AAA',
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  };
  const controller = webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^data:image\//.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });
  const html = controller.render(customer);
  const key = html.match(/data-photo-key="([^"]+)"/)[1];
  const attrs = new Map([
    ['data-photo-key', key],
    ['data-photo-loaded', 'false'],
    ['data-photo-error', 'false'],
  ]);
  const drop = {
    querySelector: (selector) => selector === '.photo-drop-image'
      ? { complete: false, naturalWidth: 0, addEventListener() {} }
      : null,
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
  };

  controller.hydratePhotoDrops({ querySelectorAll: () => [drop] });

  assert.equal(attrs.get('data-photo-loaded'), 'false');
  assert.equal(typeof fallbackHandler, 'function');
  fallbackHandler();
  assert.equal(attrs.get('data-photo-loaded'), 'true');
  assert.equal(attrs.get('data-photo-error'), 'true');
  assert.equal(clearedTimer, 42);
  assert.match(controller.render(customer), /class="photo-fallback-icon"/);
});

test('premium database webdesign action ignores stale fallback timers from replaced photo nodes', () => {
  const timers = [];
  const webdesignActionClient = loadDatabaseWebdesignActionClient({
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
    clearTimeout() {},
  });
  const customer = {
    id: 'customer-1',
    websitePhoto: 'https://assets.softora.test/customer-1.png?token=old',
    websitePhotoName: 'Websitefoto',
    websiteMockup: '',
    websiteMockupName: '',
  };
  const controller = webdesignActionClient.createController({
    state: { klanten: [] },
    escapeHtml: (value) => String(value),
    shouldShowWebsitePhoto: () => true,
    isValidWebsitePhotoDataUrl: (value) => /^(data:image\/|https:\/\/)/.test(String(value || '')),
    resolveCustomerWebsiteUrl: () => '',
    isWebdesignPhotoEligible: () => false,
    openWebsitePhotoPreview() {},
    setStatusMessage() {},
    renderPage() {},
    refreshPhotos: async () => {},
  });
  const html = controller.render(customer);
  const key = html.match(/data-photo-key="([^"]+)"/)[1];
  const createDrop = (image, isConnected = true) => {
    const attrs = new Map([
      ['data-photo-key', key],
      ['data-photo-loaded', 'false'],
      ['data-photo-error', 'false'],
      ['data-photo-id', 'customer-1'],
    ]);
    return {
      isConnected,
      querySelector: (selector) => selector === '.photo-drop-image' ? image : null,
      getAttribute: (name) => attrs.get(name) || '',
      setAttribute: (name, value) => attrs.set(name, String(value)),
      removeAttribute: (name) => attrs.delete(name),
      insertAdjacentHTML() {},
    };
  };
  const oldDrop = createDrop({ complete: false, naturalWidth: 0, addEventListener() {} });
  const currentDrop = createDrop({ complete: true, naturalWidth: 24, addEventListener() {} });

  controller.hydratePhotoDrops({ querySelectorAll: () => [oldDrop] });
  controller.hydratePhotoDrops({ querySelectorAll: () => [currentDrop] });
  oldDrop.isConnected = false;

  assert.equal(currentDrop.getAttribute('data-photo-loaded'), 'true');
  assert.equal(timers.length, 2);
  timers[0]();

  const refreshedHtml = controller.render({
    ...customer,
    websitePhoto: 'https://assets.softora.test/customer-1.png?token=new',
  });
  assert.doesNotMatch(refreshedHtml, /class="photo-fallback-icon"/);
  assert.match(refreshedHtml, /data-photo-loaded="true"/);
});

test('premium database page combines contact filters into one benaderd step', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const webdesignActionSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-database-webdesign-action.js'), 'utf8');
  const contactStatusScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-database-contact-status.js'), 'utf8');

  assert.match(
    pageSource,
    /<button class="sf-btn act" data-s="benaderbaar" type="button">Beschikbaar<\/button>\s*<button class="sf-btn" data-s="alle" type="button">Alles<\/button>\s*<button class="sf-btn" data-s="klant" type="button">Klant<\/button>\s*<button class="sf-btn" data-s="benaderd" type="button">Benaderd<\/button>\s*<button class="sf-btn" data-s="instantly" type="button">Instantly<\/button>\s*<button class="sf-btn" data-s="geblokkeerd" type="button">Geen interesse<\/button>\s*<button class="sf-btn" data-s="geengehoor" type="button">Geen gehoor<\/button>\s*<button class="sf-btn" data-s="buiten" type="button">Buiten gebruik<\/button>/
  );
  assert.match(pageSource, /activeStatus: "benaderbaar"/);
  assert.match(pageSource, /<option value="benaderbaar">Beschikbaar<\/option>/);
  assert.match(pageSource, /benaderbaar: "Beschikbaar"/);
  assert.match(pageSource, /state\.activeStatus === "benaderd"/);
  assert.match(pageSource, /state\.activeStatus === "instantly"/);
  assert.match(pageSource, /outreachController\.matchesStatusFilter\(customer, state\.activeStatus, hasUsedColdCalling, hasUsedColdMailing\)/);
  assert.match(webdesignActionSource, /function hasInstantlyOutreachSignal\(customer\)/);
  assert.match(webdesignActionSource, /function isInstantlyTabCustomer\(customer\)/);
  assert.match(webdesignActionSource, /return !isInstantlyTabCustomer\(customer\) && \(usedColdCalling \|\| usedColdMailing\);/);
  assert.doesNotMatch(pageSource, /data-s="reactie_ontvangen"/);
  assert.doesNotMatch(pageSource, /data-s="afgehaakt"/);
  assert.doesNotMatch(pageSource, /state\.activeStatus === "reactie_ontvangen"/);
  assert.match(pageSource, /assets\/premium-database-contact-status\.js\?v=20260519a/);
  assert.match(contactStatusScriptSource, /function hasColdmailSentSignal\(raw, helpers\)/);
  assert.match(contactStatusScriptSource, /function shouldInferMailedStatus\(storedStatus, raw, helpers\)/);
  assert.match(pageSource, /\.sf-btn\.act \{[\s\S]*border-color: rgba\(139, 34, 82, 0\.4\);[\s\S]*background: rgba\(139, 34, 82, 0\.12\);/);
  assert.doesNotMatch(pageSource, /<button class="sf-btn act" data-s="alle" type="button">Alles<\/button>/);
  assert.doesNotMatch(pageSource, /\.sf-btn\[data-s="klant"\]\.act/);
  assert.doesNotMatch(pageSource, /\.sf-btn\[data-s="benaderd"\]\.act/);
  assert.doesNotMatch(pageSource, /\.sf-btn\[data-s="instantly"\]\.act/);
  assert.doesNotMatch(pageSource, /\.sf-btn\[data-s="afgehaakt"\]\.act/);
  assert.doesNotMatch(pageSource, /\.sf-btn\[data-s="buiten"\]\.act/);
  assert.doesNotMatch(pageSource, /<button class="sf-btn" data-s="benaderbaar" type="button">Benaderbaar<\/button>/);
  assert.doesNotMatch(pageSource, /\.sf-btn\[data-s="geengehoor"\]\.act/);
  assert.match(webdesignActionSource, /data-outreach-status=\\"klant_geworden\\"/);
  assert.doesNotMatch(webdesignActionSource, /data-outreach-status=\\"afgehaakt\\"/);
  assert.doesNotMatch(webdesignActionSource, /data-outreach-status=\\"geen_interesse\\"/);
  assert.match(webdesignActionSource, /Mail bekijken/);
  assert.match(pageSource, /table\.outreach-action-mode thead th:nth-child\(7\), table\.outreach-action-mode tbody td:nth-child\(7\) \{ display: none; \}/);
  assert.match(pageSource, /table\.outreach-action-mode thead th:nth-child\(9\), table\.outreach-action-mode tbody td:nth-child\(9\) \{ display: none; \}/);
  assert.match(pageSource, /document\.getElementById\("databaseTable"\)\.classList\.toggle\("outreach-action-mode", showOutreachActionColumn\); document\.getElementById\("statusHeader"\)\.hidden = showOutreachActionColumn/);
  assert.match(pageSource, /renderUsedChannelTags\(customer\),\s*"\<\/div\>\<\/td\>",\s*"\<td\>\<div class=\\"s-wrap/);
  assert.match(pageSource, /outreachController\.renderMeta\(customer, showOutreachActionColumn && outreachController\.isTrackedOutreachCustomer\(customer\)\)/);
  assert.match(pageSource, /showOutreachActionColumn \? outreachController\.renderActions\(customer, \{ hideMailButton: state\.activeStatus === "instantly" \}\)/);
  assert.match(pageSource, /"<td>" \+ \(showPhotoColumn \? renderWebsitePhotoDrop\(customer\) : ""\) \+ "<\/td><td class=\\"c-light days-cell\\">" \+ \(showOutreachActionColumn \? outreachController\.renderDaysSinceSent\(customer\) : ""\) \+ "<\/td>"/);
  assert.match(pageSource, /\(state\.activeStatus === "benaderd" \|\| state\.activeStatus === "instantly"\) \? outreachController\.sortByRecentOutreach\(customers, parseDateValue, normalizeSearchValue\) : sortCustomers\(customers\);/);
  assert.match(pageSource, /table\.outreach-action-mode thead th:nth-child\(8\), table\.outreach-action-mode tbody td:nth-child\(8\) \{ width: 25%; text-align: center; \}/);
  assert.match(pageSource, /table\.outreach-action-mode thead th:nth-child\(10\), table\.outreach-action-mode tbody td:nth-child\(10\) \{ width: 5%; min-width: 56px; text-align: center; \}/);
  assert.match(webdesignActionSource, /\.outreach-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:6px;width:100%;max-width:320px;min-width:0;margin:0 auto/);
  assert.match(webdesignActionSource, /function isTrackedOutreachCustomer\(customer\)/);
  assert.match(webdesignActionSource, /normalizeDatabaseStatus\(customer && customer\.status, customer\) === "gemaild"/);
  assert.match(webdesignActionSource, /function sortByRecentOutreach\(customers, parseValue, normalizeValue\)/);
  assert.match(webdesignActionSource, /return right - left;/);
  assert.match(webdesignActionSource, /function renderDaysSinceSent\(customer\)/);
  assert.match(webdesignActionSource, /\.outreach-days\{display:inline-flex;align-items:center;justify-content:center;min-width:24px/);
  assert.match(webdesignActionSource, /\.outreach-action\{box-sizing:border-box;min-width:0;min-height:34px/);
  assert.match(webdesignActionSource, /overflow-wrap:anywhere/);
  assert.doesNotMatch(webdesignActionSource, /data-outreach-status=\\\"klant_geworden\\\"\\]\{background:var\(--crimson\)/);
  assert.match(webdesignActionSource, /replyAt \|\| customer\.updatedAt \|\| getSentAt\(customer\)/);
  assert.doesNotMatch(webdesignActionSource, /Blijft in Benaderd/);
  assert.doesNotMatch(webdesignActionSource, /25 dagen regel actief/);
  assert.match(webdesignActionSource, /const replyMessage = normalizeString\(customer\.replyMailboxId \|\| customer\.replyThreadId \|\| customer\.replyMessageId \|\| customer\.lastColdmailReplyMessageKey\);/);
  assert.match(webdesignActionSource, /const sentMessage = normalizeString\(customer\.outreachMessageId \|\| customer\.coldmailSentMessageId\);/);
  assert.match(webdesignActionSource, /lastColdmailProvider: normalizeString\(raw && raw\.lastColdmailProvider\)/);
  assert.match(webdesignActionSource, /instantlySyncedAt: normalizeString\(raw && raw\.instantlySyncedAt\)/);
  assert.match(webdesignActionSource, /params\.set\("folder", replyMessage \? "inbox" : "sent"\);/);
  assert.match(webdesignActionSource, /params\.set\("select", "first"\);/);
  assert.match(webdesignActionSource, /const usedColdCalling = typeof hasUsedColdCalling === "function" && hasUsedColdCalling\(customer\);/);
  assert.match(pageSource, /outreachController\.hasInstantlyOutreachSignal\(customer\)[\s\S]*tags\.push\("<span class=\\"k-tag k-mail\\">Instantly<\/span>"\)/);
  assert.match(contactStatusScriptSource, /normalizeOutreachStatusKey\(raw\.outreachStatus, helpers\) === "benaderd"/);
  assert.match(contactStatusScriptSource, /raw\.coldmailSentMessageId \|\| raw\.outreachMessageId/);
  assert.doesNotMatch(pageSource, /<button class="sf-btn" data-s="gebeld" type="button">Gebeld<\/button>/);
  assert.doesNotMatch(pageSource, /<button class="sf-btn" data-s="gemaild" type="button">Gemaild<\/button>/);
  assert.doesNotMatch(pageSource, /<button class="sf-btn" data-s="afspraak" type="button">Afspraak<\/button>/);
  assert.doesNotMatch(pageSource, /<button class="sf-btn" data-s="interesse" type="button">Interesse<\/button>/);
  assert.match(pageSource, /<button class="sf-btn" data-s="geblokkeerd" type="button">Geen interesse<\/button>/);
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

test('premium database outreach days column keeps benaderd rows after 25 days', () => {
  const outreachClient = loadDatabaseOutreachClient();
  const controller = outreachClient.createController({
    state: { klanten: [] },
    nodes: {},
    escapeHtml: (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]),
    normalizeSearchValue: (value) => String(value || '').trim().toLowerCase(),
    normalizeDatabaseStatus: (value) => String(value || '').trim().toLowerCase(),
    formatDisplayDate: () => '19 mei 2026',
    parseDateValue: (value) => {
      const timestamp = Date.parse(String(value || ''));
      return Number.isFinite(timestamp) ? timestamp : 0;
    },
    normalizeCustomer: (value) => value,
    persistCustomerList: () => {},
    renderPage: () => {},
    setStatusMessage: () => {},
  });
  const now = new Date();
  const yesterdayLate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 30, 0).toISOString();
  const oldSentAt = new Date(Date.now() - (26 * 86400000)).toISOString();
  const customer = {
    id: 'customer-1',
    campaignType: 'webdesign',
    outreachStatus: 'benaderd',
    status: 'gemaild',
    outreachSentAt: oldSentAt,
  };

  assert.match(controller.renderDaysSinceSent({
    id: 'customer-yesterday',
    campaignType: 'webdesign',
    outreachStatus: 'benaderd',
    outreachSentAt: yesterdayLate,
  }), />1<\/span>/);
  const legacyColdmailCustomer = {
    id: 'customer-legacy',
    status: 'gemaild',
    updatedAt: yesterdayLate,
  };

  assert.match(controller.renderMeta(legacyColdmailCustomer, true), /Verstuurd vanaf onbekend mailadres/);
  assert.match(controller.renderDaysSinceSent(legacyColdmailCustomer), />1<\/span>/);
  assert.match(controller.renderActions(legacyColdmailCustomer), /Mail bekijken/);
  assert.doesNotMatch(controller.renderActions(legacyColdmailCustomer, { hideMailButton: true }), /Mail bekijken/);
  assert.match(controller.renderActions(legacyColdmailCustomer, { hideMailButton: true }), /Is klant geworden/);
  assert.match(controller.renderActions(legacyColdmailCustomer, { hideMailButton: true }), /outreach-actions--single/);
  const instantlyFields = outreachClient.normalizeCustomerFields({
    lastColdmailProvider: 'instantly',
    instantlyLeadId: 'lead-1',
    instantlyCampaignId: 'campaign-1',
    instantlyStatus: 'synced',
    instantlySyncedAt: '2026-05-25T21:36:48.980Z',
    status: 'gemaild',
  });
  assert.equal(instantlyFields.lastColdmailProvider, 'instantly');
  assert.equal(controller.hasInstantlyOutreachSignal(instantlyFields), true);
  assert.equal(controller.matchesStatusFilter(instantlyFields, 'instantly', () => false, () => true), true);
  assert.equal(controller.matchesStatusFilter(instantlyFields, 'benaderd', () => false, () => true), false);
  assert.deepEqual(
    controller.sortByRecentOutreach([
      { id: 'older', bedrijf: 'B bedrijf', status: 'gemaild', updatedAt: '2026-05-20T10:00:00.000Z' },
      { id: 'newer', bedrijf: 'Z bedrijf', status: 'gemaild', updatedAt: '2026-05-22T10:00:00.000Z' },
      { id: 'same-day-alpha', bedrijf: 'A bedrijf', status: 'gemaild', updatedAt: '2026-05-22T10:00:00.000Z' },
    ], (value) => new Date(value).getTime(), (value) => String(value || '').toLowerCase()).map((item) => item.id),
    ['same-day-alpha', 'newer', 'older']
  );
  const automated = controller.applyAutomation([customer]);
  assert.equal(automated.changed, false);
  assert.equal(automated.customers[0].outreachStatus, 'benaderd');
  assert.equal(automated.customers[0].status, 'gemaild');

  const rollback = controller.applyAutomation([{
    id: 'customer-3',
    campaignType: 'webdesign',
    status: 'geengehoor',
    outreachStatus: 'geen_gehoor',
    outreachSentAt: oldSentAt,
    hist: [{ type: 'geengehoor', label: 'Geen gehoor na 25 dagen', source: 'webdesign-outreach-automation' }],
  }]);

  assert.equal(rollback.changed, true);
  assert.equal(rollback.customers[0].status, 'gemaild');
  assert.equal(rollback.customers[0].outreachStatus, 'benaderd');
  assert.equal(rollback.customers[0].hist[0].label, 'Automatische geen gehoor-regel teruggedraaid');
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

  assert.match(listNode.innerHTML, /^<button class="deep-search-target is-active is-active"[\s\S]*1\. Nederland \| Noord-Brabant \| Vught \| Helvoirt/);
  assert.match(listNode.innerHTML, /class="deep-search-target is-done"[\s\S]*Nederland \| Noord-Brabant \| Altena \| Almkerk/);
});

test('premium database deep search modal shows backend cost estimate when available', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const costNode = { textContent: '' };
  const estimateCalls = [];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: costNode,
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '250' },
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: {},
      deepSearchStartButton: {},
    },
    importRows: async () => true,
    readDeepSearchEstimate: async (count) => {
      estimateCalls.push(count);
      return {
        ok: true,
        model: 'gpt-5.4',
        serviceTier: 'flex',
        cost: { estimatedUsd: 5.8945, upperEstimatedUsd: 11.789, serviceTier: 'flex' },
      };
    },
  });

  controller.open();
  assert.match(costNode.textContent, /maximaal 250 bedrijven: €5,48 tot €10,96 via gpt-5\.4 flex/);

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(estimateCalls, [250]);
  assert.match(costNode.textContent, /maximaal 250 bedrijven: €5,48 tot €10,96 via gpt-5\.4 flex/);
});

test('premium database deep search modal falls back when backend estimate fails', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const costNode = { textContent: '' };
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: costNode,
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '250' },
      deepSearchList: {},
      deepSearchModal: createClassListNode(),
      deepSearchSources: {},
      deepSearchStartButton: {},
    },
    importRows: async () => true,
    readDeepSearchEstimate: async () => {
      throw new Error('estimate offline');
    },
  });

  controller.open();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(costNode.textContent, /maximaal 250 bedrijven: €5,48 tot €10,96 via gpt-5\.4 flex/);
  assert.match(costNode.textContent, /dashboard kan afwijken/);
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
            mockupPhotoKey: 'photo_customer1_mockup',
            mockupChunkCount: 1,
            websiteMockupName: 'Device mockup oud',
            mockupRenderer: 'softora-browser-device-v6',
            mockupOrientation: 'upright',
            mockupQualityStatus: 'checked',
            mockupQualityCheckedAt: '2026-05-26T10:00:00.000Z',
          },
        }),
        photo_customer1_0: 'data:image/png;base64,AAA',
        photo_customer1_mockup_0: 'data:image/jpeg;base64,OLD',
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
    { id: 'customer2', websitePhoto: 'data:image/png;base64,BBB', websitePhotoName: 'Websitefoto nieuw', websiteMockup: 'data:image/jpeg;base64,CCC', websiteMockupName: 'Device mockup nieuw', mockupRenderer: 'softora-browser-device-v6', mockupOrientation: 'upright', mockupQualityStatus: 'checked', mockupQualityCheckedAt: '2026-05-27T10:00:00.000Z' },
  ], { onlyCustomerIds: ['customer2'] });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].photo_customer1_0, undefined);
  assert.equal(patches[0].photo_customer1_mockup_0, undefined);
  assert.equal(patches[0].photo_customer2_0, 'data:image/png;base64,BBB');
  assert.equal(patches[0].photo_customer2_mockup_0, 'data:image/jpeg;base64,CCC');
  const storedMap = JSON.parse(patches[0].photos);
  assert.equal(storedMap.customer1.photoKey, 'photo_customer1');
  assert.equal(storedMap.customer1.mockupPhotoKey, 'photo_customer1_mockup');
  assert.equal(storedMap.customer1.websiteMockupName, 'Device mockup oud');
  assert.equal(storedMap.customer1.mockupQualityStatus, 'checked');
  assert.equal(storedMap.customer2.photoKey, 'photo_customer2');
  assert.equal(storedMap.customer2.mockupPhotoKey, 'photo_customer2_mockup');
  assert.equal(storedMap.customer2.websiteMockupName, 'Device mockup nieuw');
  assert.equal(storedMap.customer2.mockupRenderer, 'softora-browser-device-v6');
  assert.equal(storedMap.customer2.mockupOrientation, 'upright');
  assert.equal(storedMap.customer2.mockupQualityStatus, 'checked');
  assert.equal(storedMap.customer2.mockupQualityCheckedAt, '2026-05-27T10:00:00.000Z');
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

test('premium database photo storage reuses duplicate photo map reads until forced', async () => {
  const photoStorageClient = loadDatabasePhotoStorageClient();
  let reads = 0;
  const controller = photoStorageClient.createController({
    getUiState: async () => {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { values: { photos: '{}' } };
    },
    setUiState: async () => ({ ok: true }),
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
  const customers = [{ id: 'customer1', websitePhoto: '' }];

  await Promise.all([controller.load(customers), controller.load(customers)]);
  await controller.load(customers);
  assert.equal(reads, 1);

  await controller.load(customers, { force: true });
  assert.equal(reads, 2);
});

test('premium database deep search continues to the next location until the requested new-company count is reached', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const calls = [];
  const messages = [];
  const customers = [];
  const persisted = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Helvoirt Test BV', 'Kerkstraat 1, Helvoirt', 'info@helvoirttest.nl', '073 123 4567', 'helvoirttest.nl'],
  ];
  const boxtelRows = [
    rows[0],
    ['Boxtel Test BV', 'Kerkstraat 2, Boxtel', 'info@boxteltest.nl', '0411 765 432', 'boxteltest.nl'],
  ];
  const responses = [
    {
      ok: true,
      rows,
      businesses: [{ bedrijfsnaam: 'Helvoirt Test BV', email: 'info@helvoirttest.nl', website: 'helvoirttest.nl' }],
      found: 1,
      placeComplete: true,
      cost: { estimatedUsd: 0.12 },
      sources: [{ url: 'https://helvoirttest.nl/contact', title: 'Contact' }],
    },
    {
      ok: true,
      rows: [rows[0]],
      businesses: [],
      found: 0,
      placeComplete: true,
      cost: { estimatedUsd: 0.08 },
      sources: [{ url: 'https://helvoirttest.nl/over-ons', title: 'Over ons' }],
    },
    {
      ok: true,
      rows: boxtelRows,
      businesses: [{ bedrijfsnaam: 'Boxtel Test BV', email: 'info@boxteltest.nl', website: 'boxteltest.nl' }],
      found: 1,
      placeComplete: false,
      cost: { estimatedUsd: 0.11 },
      sources: [{ url: 'https://boxteltest.nl/contact', title: 'Contact' }],
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
          'helvoirttest.nl',
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
  assert.equal(calls[0].target, 'Nederland | Noord-Brabant | Vught | Helvoirt');
  assert.equal(calls[0].count, 2);
  assert.equal(calls[0].batchNumber, 1);
  assert.equal(calls[1].target, calls[0].target);
  assert.equal(calls[1].count, 1);
  assert.equal(calls[1].batchNumber, 2);
  assert.equal(calls[2].target, 'Nederland | Noord-Brabant | Boxtel | Boxtel');
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
  assert.equal(finalState.targetOrderVersion, 'distance-oisterwijk-v4');
  assert.ok(finalStatePatch.length < 200000);
  assert.deepEqual(getStoredTargetProgress(finalState).foundWebsites, [
    'helvoirttest.nl',
  ]);
  assert.equal(getStoredTargetProgress(finalState).status, 'done');
  assert.deepEqual(getStoredTargetProgress(finalState, 1).foundWebsites, [
    'boxteltest.nl',
  ]);
});

test('premium database deep search sends compact duplicate exclusions for the full customer list', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const customers = Array.from({ length: 150 }, (_item, index) => ({
    bedrijf: `Bestaand ${index}`,
    email: `info${index}@bestaand-${index}.nl`,
    website: `https://www.bestaand-${index}.nl`,
    stad: `Kerkstraat ${index}, Almkerk`,
  }));
  customers.push({
    bedrijf: 'Growingbyknowing.nl',
    email: 'hello@growingbyknowing.nl',
    website: 'https://www.growingbyknowing.nl',
    stad: 'Dorpsstraat 1, Bavel',
  });
  let capturedPayload = null;
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
      customers.push(...receivedRows.slice(1).map((row) => ({
        bedrijf: row[0],
        stad: row[1],
        email: row[2],
        website: row[4],
      })));
      return true;
    },
    readDeepSearchRows: async (payload) => {
      capturedPayload = payload;
      return {
        ok: true,
        rows: [
          ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
          ['Nieuw Almkerk BV', 'Kerkstraat 1, Almkerk', 'info@nieuwalmkerk.nl', '0183 111 111', 'nieuwalmkerk.nl'],
        ],
        businesses: [{ bedrijfsnaam: 'Nieuw Almkerk BV', email: 'info@nieuwalmkerk.nl', website: 'nieuwalmkerk.nl' }],
        found: 1,
        placeComplete: false,
        cost: { estimatedUsd: 0.01 },
        sources: [],
      };
    },
    setUiState: async () => ({ ok: true }),
  });

  await controller.runCurrentSearch();

  assert.ok(capturedPayload);
  assert.ok(capturedPayload.exclude.includes('domain:bestaand-0.nl'));
  assert.ok(capturedPayload.exclude.includes('domain:bestaand-149.nl'));
  assert.ok(capturedPayload.exclude.includes('domain:growingbyknowing.nl'));
  assert.ok(capturedPayload.exclude.includes('email:hello@growingbyknowing.nl'));
  assert.notEqual(capturedPayload.exclude.length, 120);
});

test('premium database deep search shows a calibrated flex range estimate', () => {
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

  assert.equal(
    nodes.deepSearchCost.textContent,
    'Richtprijs voor maximaal 25 bedrijven: €0,58 tot €1,16 via gpt-5.4 flex (dashboard kan afwijken)'
  );
  assert.match(nodes.deepSearchCost.textContent, /dashboard kan afwijken/);
});

test('premium database deep search turns the start button into a disabled completed-session summary', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const startButton = createClassListNode();
  const calls = [];
  const customers = [];
  const rows = [
    ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
    ['Schutte Groen & Grond', 'Kerkstraat 1, Helvoirt', 'info@schuttegroenengrond.nl', '073 123 4567', 'schuttegroenengrond.nl'],
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
  assert.equal(startButton.textContent, '1 bedrijf toegevoegd in Helvoirt');
  assert.equal(startButton.disabled, true);
  assert.equal(startButton.getAttribute('aria-disabled'), 'true');
  assert.equal(startButton.classList.contains('is-session-complete'), true);
  assert.equal(await controller.runCurrentSearch(), false);
  assert.equal(calls.length, 1);
});

test('premium database deep search sends compact duplicate exclusions for the full customer list', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const customers = Array.from({ length: 150 }, (_item, index) => ({
    bedrijf: `Bestaand ${index}`,
    email: `info${index}@bestaand-${index}.nl`,
    website: `https://www.bestaand-${index}.nl`,
    stad: `Kerkstraat ${index}, Oisterwijk`,
  }));
  customers.push({
    bedrijf: 'Growingbyknowing.nl',
    email: 'hello@growingbyknowing.nl',
    website: 'https://www.growingbyknowing.nl',
    stad: 'Dorpsstraat 1, Bavel',
  });
  let capturedPayload = null;
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
      customers.push(...receivedRows.slice(1).map((row) => ({
        bedrijf: row[0],
        stad: row[1],
        email: row[2],
        website: row[4],
      })));
      return true;
    },
    readDeepSearchRows: async (payload) => {
      capturedPayload = payload;
      return {
        ok: true,
        rows: [
          ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
          ['Nieuw Oisterwijk BV', 'Kerkstraat 1, Oisterwijk', 'info@nieuwoisterwijk.nl', '013 111 111', 'nieuwoisterwijk.nl'],
        ],
        businesses: [{ bedrijfsnaam: 'Nieuw Oisterwijk BV', email: 'info@nieuwoisterwijk.nl', website: 'nieuwoisterwijk.nl' }],
        found: 1,
        placeComplete: false,
        cost: { estimatedUsd: 0.01 },
        sources: [],
      };
    },
    setUiState: async () => ({ ok: true }),
  });

  await controller.runCurrentSearch();

  assert.ok(capturedPayload);
  assert.ok(capturedPayload.exclude.includes('domain:bestaand-0.nl'));
  assert.ok(capturedPayload.exclude.includes('domain:bestaand-149.nl'));
  assert.ok(capturedPayload.exclude.includes('domain:growingbyknowing.nl'));
  assert.ok(capturedPayload.exclude.includes('email:hello@growingbyknowing.nl'));
  assert.notEqual(capturedPayload.exclude.length, 120);
});

test('premium database deep search lists websites from newly added customers after import sorting', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const sourcesPanel = { innerHTML: '' };
  const customers = [
    { bedrijf: 'Oude A', email: 'info@oudea.nl', website: 'oudea.nl', stad: 'Kerkstraat 1, Oisterwijk' },
    { bedrijf: 'Oude B', email: 'info@oudeb.nl', website: 'oudeb.nl', stad: 'Kerkstraat 2, Oisterwijk' },
  ];
  const controller = deepSearchClient.createController({
    nodes: {
      deepSearchCost: {},
      deepSearchCurrent: {},
      deepSearchDesiredCount: { value: '1' },
      deepSearchList: {},
      deepSearchSources: sourcesPanel,
      deepSearchStartButton: {},
    },
    scope: 'premium_database',
    stateKey: 'deep_search_state',
    autoContinueDelayMs: 0,
    getCustomers: () => customers,
    importRows: async (receivedRows) => {
      customers.unshift(...receivedRows.slice(1).map((row) => ({
        bedrijf: row[0],
        stad: row[1],
        email: row[2],
        website: row[4],
      })));
      return true;
    },
    readDeepSearchRows: async () => ({
      ok: true,
      rows: [
        ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
        ['Nieuw Voorop BV', 'Kerkstraat 3, Oisterwijk', 'info@nieuwvoorop.nl', '013 333 333', 'nieuwvoorop.nl'],
      ],
      businesses: [{ bedrijfsnaam: 'Nieuw Voorop BV', email: 'info@nieuwvoorop.nl', website: 'nieuwvoorop.nl' }],
      found: 1,
      placeComplete: false,
      cost: { estimatedUsd: 0.01 },
      sources: [],
    }),
    setUiState: async () => ({ ok: true }),
  });

  await controller.runCurrentSearch();

  assert.match(sourcesPanel.innerHTML, /nieuwvoorop\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /oudea\.nl/);
  assert.doesNotMatch(sourcesPanel.innerHTML, /oudeb\.nl/);
});

test('premium database deep search stops duplicate-only batches to protect API costs', async () => {
  const deepSearchClient = loadDatabaseDeepSearchClient();
  const messages = [];
  const calls = [];
  const customers = [
    { bedrijf: 'Lins Zorgt', email: 'info@linszorgt.nl', website: 'linszorgt.nl', stad: 'Kerkstraat 1, Oisterwijk' },
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
    importRows: async () => false,
    readDeepSearchRows: async (payload) => {
      calls.push(payload);
      return {
        ok: true,
        rows: [
          ['Bedrijfsnaam', 'Adres', 'E-mail', 'Telefoonnummer', 'Website'],
          ['Lins Zorgt', 'Kerkstraat 1, Oisterwijk', 'info@linszorgt.nl', '013 111 111', 'linszorgt.nl'],
        ],
        businesses: [{ bedrijfsnaam: 'Lins Zorgt', email: 'info@linszorgt.nl', website: 'linszorgt.nl' }],
        found: 1,
        placeComplete: false,
        cost: { estimatedUsd: 0.02 },
        sources: [],
      };
    },
    setStatusMessage: (message) => messages.push(message),
    setUiState: async () => ({ ok: true }),
  });

  const result = await controller.runCurrentSearch();

  assert.equal(result, false);
  assert.equal(calls.length, 1);
  assert.match(messages.join('\n'), /geen enkel nieuw bedrijf is toegevoegd/);
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
  const targetCoordsPath = path.join(__dirname, '../../assets/premium-database-target-coords.js');
  const sorterPath = path.join(__dirname, '../../assets/premium-database-distance.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const targetCoordsSource = fs.readFileSync(targetCoordsPath, 'utf8');
  const sorterSource = fs.readFileSync(sorterPath, 'utf8');

  assert.match(pageSource, /assets\/premium-database-target-coords\.js\?v=20260522a/);
  assert.match(pageSource, /assets\/premium-database-distance\.js\?v=20260522b/);
  assert.match(pageSource, /window\.SoftoraPremiumDatabaseDistance/);
  assert.match(pageSource, /sortKey: "distance"/);
  assert.match(pageSource, /function getSortedCustomers\(customers\) \{\s*return \(state\.activeStatus === "benaderd" \|\| state\.activeStatus === "instantly"\) \? outreachController\.sortByRecentOutreach\(customers, parseDateValue, normalizeSearchValue\) : sortCustomers\(customers\);/);
  assert.match(sorterSource, /const OISTERWIJK_COORDS = \{ lat: 51\.5792, lng: 5\.1889 \};/);
  assert.match(sorterSource, /function resolveCustomerCoords\(customer\)/);
  assert.match(sorterSource, /function getDistanceKm\(customer\)/);
  assert.match(sorterSource, /function compareCustomersByDistance\(left, right\)/);
  assert.match(sorterSource, /function compareTargetLabelsByDistance\(left, right\)/);
  assert.match(sorterSource, /function sortTargetLabelsByDistance\(labels\)/);
  assert.match(sorterSource, /function resolveExternalCustomerCoords\(customer, text\)/);
  assert.match(sorterSource, /function resolveExternalTargetCoords\(parts\)/);
  assert.match(sorterSource, /source\.resolveTextCoords\(text, \{ province: province, municipality: municipality \}\)/);
  assert.match(targetCoordsSource, /function resolveTextCoords\(value, hints\)/);
  assert.match(targetCoordsSource, /placeEntries\.sort\(function \(left, right\)/);
  assert.match(sorterSource, /function compareCustomerSortEntries\(left, right\)/);
  assert.match(sorterSource, /\.map\(function \(customer, index\) \{/);
  assert.match(sorterSource, /\.sort\(compareCustomerSortEntries\)/);
  assert.match(sorterSource, /"4281": \{ lat: 51\.7835, lng: 5\.0585 \}/);
  assert.match(sorterSource, /"4286": \{ lat: 51\.7714, lng: 4\.9597 \}/);
  assert.match(sorterSource, /"4856": \{ lat: 51\.5006, lng: 4\.7839 \}/);
  assert.match(sorterSource, /"4858": \{ lat: 51\.5486, lng: 4\.7967 \}/);
  assert.match(sorterSource, /"4859": \{ lat: 51\.5653, lng: 4\.8307 \}/);
  assert.match(sorterSource, /"4861": \{ lat: 51\.5069, lng: 4\.8616 \}/);
  assert.match(sorterSource, /"5085": \{ lat: 51\.4619, lng: 5\.1372 \}/);
  assert.match(sorterSource, /"5268": \{ lat: 51\.6336, lng: 5\.2291 \}/);
  assert.match(sorterSource, /"5281": \{ lat: 51\.5891, lng: 5\.3158 \}/);
  assert.match(sorterSource, /"5296": \{ lat: 51\.6118, lng: 5\.2915 \}/);
  assert.match(sorterSource, /"5298": \{ lat: 51\.5705, lng: 5\.3713 \}/);
  assert.match(sorterSource, /"5131": \{ lat: 51\.4817, lng: 4\.9583 \}/);
  const sorter = loadDatabaseDistanceClient();
  assert.ok(Number.isFinite(sorter.getDistanceKm({ bedrijf: 'Esbeek bedrijf', stad: 'Prins Hendriklaan 4, 5085 NJ Esbeek' })));
  assert.ok(Number.isFinite(sorter.getDistanceKm({ bedrijf: 'Helvoirt bedrijf', stad: 'Lindelaan 20, 5268 CC Helvoirt' })));
  assert.ok(Number.isFinite(sorter.getDistanceKm({ bedrijf: 'Liempde bedrijf', stad: 'Parkstraat 11, 5298 CE Liempde' })));
  assert.ok(Number.isFinite(sorter.getDistanceKm({ bedrijf: 'Eemshaven bedrijf', stad: 'Kwelderweg 1, 9979 XN Eemshaven' })));
  assert.ok(Number.isFinite(sorter.getDistanceKm({ bedrijf: 'Buren Ameland bedrijf', plaats: 'Buren', gemeente: 'Ameland', provincie: 'Friesland' })));
  assert.equal(sorter.getDistanceKm({ bedrijf: 'Onbekende plaats bedrijf', stad: 'Hoofdweg 1, Atlantis' }), Infinity);
  const automaticallySorted = sorter.sortCustomersByDistance([
    { bedrijf: 'Eemshaven bedrijf', stad: 'Kwelderweg 1, 9979 XN Eemshaven' },
    { bedrijf: 'Onbekende plaats', stad: 'Straat 1, Onbekend' },
    { bedrijf: 'Helvoirt bedrijf', stad: 'Lindelaan 20, 5268 CC Helvoirt' },
  ]);
  assert.deepEqual(automaticallySorted.map((customer) => customer.bedrijf), [
    'Helvoirt bedrijf',
    'Eemshaven bedrijf',
    'Onbekende plaats',
  ]);
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
  assert.ok(Number.isFinite(sorter.getTargetDistanceKm('Nederland | Friesland | Ameland | Buren')));
  assert.ok(Number.isFinite(sorter.getTargetDistanceKm('Nederland | Noord-Brabant | Land van Cuijk | Beers')));
  assert.ok(Number.isFinite(sorter.getTargetDistanceKm('Nederland | Noord-Holland | Velsen | Driehuis')));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium customers page bootstraps customer rows before async sync runs', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->/);
  assert.match(pageSource, /assets\/premium-customers-core\.js\?v=20260428a/);
  assert.match(pageSource, /<option value="website">Website<\/option>/);
  assert.match(pageSource, /function readCustomersBootstrapPayload\(\)/);
  assert.match(pageSource, /document\.getElementById\("softoraCustomersBootstrap"\)/);
  assert.match(pageSource, /function resolveBootstrapCustomers\(\)/);
  assert.match(
    pageSource,
    /const initialBootstrapCustomers = resolveBootstrapCustomers\(\);[\s\S]*state\.klanten = initialBootstrapCustomers;[\s\S]*renderPage\(\);/
  );
  assert.match(pageSource, /const hadBootstrapCustomers = state\.klanten\.length > 0;/);
  assert.match(pageSource, /const customersBootStartedAt = Date\.now\(\), customersHadBootstrap = initialBootstrapCustomers\.length > 0, releaseCustomersBootShell =/);
  assert.match(pageSource, /SoftoraPremiumBootTiming\?\.release\(customersBootStartedAt, 0\)/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
});

test('premium customers page supports toegewezen aan in table, modal and order import', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const rendererPath = path.join(__dirname, '../../assets/premium-customers-renderers.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const rendererSource = fs.readFileSync(rendererPath, 'utf8');

  assert.match(pageSource, /<th>Toegewezen aan<\/th>/);
  assert.match(pageSource, /<th>Review\?<\/th>\s*<th>Betaaldatum<\/th>/);
  assert.match(pageSource, /<th>Betaalde prijs<\/th>/);
  assert.doesNotMatch(pageSource, /<th>Status<\/th>/);
  assert.doesNotMatch(rendererSource, /createCell\("Status"/);
  assert.doesNotMatch(rendererSource, /status-text/);
  assert.match(pageSource, /<label class="form-label" for="fieldResponsible">Toegewezen aan<\/label>/);
  assert.match(pageSource, /<select class="form-select" id="fieldResponsible" name="verantwoordelijk" required data-custom-select="true">/);
  assert.match(pageSource, /<option value="Team" selected>Team<\/option>/);
  assert.match(pageSource, /<option value="Serve">Servé<\/option>/);
  assert.match(pageSource, /<option value="Martijn">Martijn<\/option>/);
  assert.match(pageSource, /fieldResponsible: document\.getElementById\("fieldResponsible"\),/);
  assert.match(pageSource, /assets\/premium-customers-core\.js\?v=20260428a/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /claimedBy: normalizeString\(item && \(item\.claimedBy \|\| item\.leadOwnerName \|\| item\.leadOwnerFullName\)\),/);
  assert.match(pageSource, /customer\.verantwoordelijk,/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = "Team";/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = customer\.verantwoordelijk \|\| "Team";/);
  assert.match(pageSource, /verantwoordelijk: nodes\.fieldResponsible \? nodes\.fieldResponsible\.value : "Team",/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /<section class="hero">[\s\S]*<div class="hero-copy">/);
  assert.doesNotMatch(pageSource, /leaderboard-card/);
  assert.doesNotMatch(pageSource, /leaderboardList/);
  assert.doesNotMatch(pageSource, /function updateLeaderboard\(\)/);
  assert.match(pageSource, /<script src="assets\/premium-customers-renderers\.js\?v=20260427a"><\/script>/);
  assert.match(pageSource, /window\.SoftoraCustomersRenderers\.renderRows\(nodes\.body, filtered, \{/);
  assert.doesNotMatch(rendererSource, /renderLeaderboard/);
  assert.match(rendererSource, /function createCell\(label, className\) \{/);
  assert.match(rendererSource, /function renderRows\(target, customers, helpers\) \{/);
  assert.match(pageSource, /nodes\.body\.replaceChildren\(\);/);
  assert.match(rendererSource, /fragment\.appendChild\(row\);/);
  assert.doesNotMatch(pageSource, /nodes\.body\.innerHTML/);
  assert.doesNotMatch(rendererSource, /\.innerHTML\s*=/);
  assert.doesNotMatch(pageSource, /function escapeHtml\(value\)/);
  assert.match(pageSource, /function renderPage\(\) \{[\s\S]*renderTable\(\);[\s\S]*\}/);
});

test('premium customers onderhoudsprijs is alleen actief wanneer onderhoud ja is gekozen', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /for="fieldMaintenanceEnabled">Onderhoud\?<\/label>/);
  assert.match(pageSource, /id="fieldMaintenanceEnabled" name="onderhoudActief" required/);
  assert.match(pageSource, /<option value="Nee" selected>Nee<\/option><option value="Ja">Ja<\/option>/);
  assert.match(pageSource, /id="fieldMaintenanceAmount" name="onderhoudPerMaand" type="number" min="0" step="1" placeholder="49">/);
  assert.match(pageSource, /fieldMaintenanceEnabled: document\.getElementById\("fieldMaintenanceEnabled"\),/);
  assert.match(pageSource, /function normalizeMaintenanceEnabled\(raw, type, amount\)/);
  assert.match(pageSource, /onderhoudActief: onderhoudActief,/);
  assert.match(pageSource, /if \(explicit === "Ja"\) return true;[\s\S]*if \(explicit === "Nee"\) return false;/);
  assert.match(pageSource, /nodes\.maintenanceAmountGroup\.hidden = !\(nodes\.fieldMaintenanceEnabled && nodes\.fieldMaintenanceEnabled\.value === "Ja"\);/);
  assert.match(pageSource, /nodes\.fieldMaintenanceAmount\.required = Boolean\(maintenanceEnabled\);/);
  assert.match(pageSource, /nodes\.fieldMaintenanceAmount\.disabled = !maintenanceEnabled;/);
  assert.match(pageSource, /if \(!maintenanceEnabled\) nodes\.fieldMaintenanceAmount\.value = "";/);
  assert.match(pageSource, /if \(nodes\.fieldMaintenanceEnabled\) nodes\.fieldMaintenanceEnabled\.value = "Nee";/);
  assert.match(pageSource, /nodes\.fieldMaintenanceEnabled\.value = customerHasMaintenance\(customer\) \? "Ja" : "Nee";/);
  assert.match(pageSource, /const onderhoudActief = nodes\.fieldMaintenanceEnabled && nodes\.fieldMaintenanceEnabled\.value === "Ja" \? "Ja" : "Nee";/);
  assert.match(pageSource, /const onderhoudPerMaand = onderhoudActief === "Ja" \? normalizeOptionalAmount/);
  assert.match(pageSource, /if \(hasM && onderhoudPerMaand === null\)/);
  assert.match(pageSource, /if \(nodes\.fieldMaintenanceEnabled\) nodes\.fieldMaintenanceEnabled\.addEventListener\("change", updateAmountFieldVisibility\);/);
});

test('premium customers modal uses Softora custom dropdowns instead of native browser menus', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  ['fieldService', 'fieldMaintenanceEnabled', 'fieldActive', 'fieldReview', 'fieldResponsible'].forEach((fieldId) => {
    assert.match(pageSource, new RegExp(`<select class="form-select" id="${fieldId}"[\\s\\S]*?data-custom-select="true"`));
  });
  assert.doesNotMatch(pageSource, /id="fieldStatus"/);
  assert.match(pageSource, /<label class="form-label" for="fieldWebsiteAmount">Betaalde prijs \(EUR\)<\/label>/);
  assert.match(pageSource, /status: "Betaald",/);
  assert.match(pageSource, /function isPaidCustomerRecord\(raw\)/);
  assert.match(pageSource, /if \(!paidDate && order\.status !== "betaald"\) return;/);
  assert.match(pageSource, /assets\/custom-selects\.css\?v=20260511a/);
  assert.match(pageSource, /assets\/custom-selects\.js\?v=20260511a/);
  assert.match(pageSource, /\.modal \.site-select-trigger\{min-height:2\.85rem!important/);
  assert.match(pageSource, /\.modal \.site-select-menu\{background:var\(--bg-secondary\)!important/);
  assert.match(pageSource, /function refreshCustomerCustomSelects\(\) \{ if \(typeof window\.refreshCustomFormSelects === "function"\) window\.refreshCustomFormSelects\(\); \}/);
  assert.match(pageSource, /clearModalValidationState\(\);\s*refreshCustomerCustomSelects\(\);/);
});

test('premium customers page preserves the shared database lifecycle status', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /assets\/premium-customers-core\.js\?v=20260428a/);
  assert.match(pageSource, /normalizeCustomerDatabaseStatus/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /isCustomerLifecycleRecord/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /const databaseStatus = normalizeCustomerDatabaseStatus\(raw\);/);
  assert.match(pageSource, /databaseStatus: databaseStatus,/);
  assert.match(pageSource, /function parseCustomerStorageRows\(raw\)/);
  assert.match(pageSource, /function readChunkedStateValue\(values, baseKey\)/);
  assert.match(pageSource, /\.filter\(isCustomerLifecycleRecord\)/);
  assert.match(pageSource, /const preservedDatabaseRows = \(Array\.isArray\(state\.sharedCustomerRows\) \? state\.sharedCustomerRows : \[\]\)\.filter/);
  assert.match(pageSource, /return !isCustomerLifecycleRecord\(row\);/);
  assert.match(pageSource, /const storageRows = preservedDatabaseRows\.concat\(normalizedCustomers\);/);
  assert.match(pageSource, /JSON\.stringify\(storageRows\)/);
  assert.match(pageSource, /const remoteRows = parseCustomerStorageRows\(readChunkedStateValue\(remoteState && remoteState\.values, CUSTOMER_DB_KEY\)\)/);
  assert.match(pageSource, /if \(remoteRows\.length\) \{/);
});

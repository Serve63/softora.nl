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
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
});

test('premium customers page supports toegewezen aan in table, modal and order import', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const rendererPath = path.join(__dirname, '../../assets/premium-customers-renderers.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const rendererSource = fs.readFileSync(rendererPath, 'utf8');

  assert.match(pageSource, /<th>Toegewezen aan<\/th>/);
  assert.match(pageSource, /<th>Review\?<\/th>\s*<th>Betaaldatum<\/th>/);
  assert.match(pageSource, /<label class="form-label" for="fieldResponsible">Toegewezen aan<\/label>/);
  assert.match(pageSource, /<select class="form-select" id="fieldResponsible" name="verantwoordelijk" required>/);
  assert.match(pageSource, /<option value="Serve" selected>Servé<\/option>/);
  assert.match(pageSource, /<option value="Martijn">Martijn<\/option>/);
  assert.match(pageSource, /fieldResponsible: document\.getElementById\("fieldResponsible"\),/);
  assert.match(pageSource, /assets\/premium-customers-core\.js\?v=20260428a/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /SoftoraPremiumCustomersCore/);
  assert.match(pageSource, /claimedBy: normalizeString\(item && \(item\.claimedBy \|\| item\.leadOwnerName \|\| item\.leadOwnerFullName\)\),/);
  assert.match(pageSource, /customer\.verantwoordelijk,/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = "Serve";/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = customer\.verantwoordelijk \|\| "Serve";/);
  assert.match(pageSource, /verantwoordelijk: nodes\.fieldResponsible \? nodes\.fieldResponsible\.value : "Serve",/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /<section class="hero">[\s\S]*<div class="hero-copy">[\s\S]*<div class="hero-side">[\s\S]*<div class="leaderboard-card" id="leaderboardCard">/);
  assert.doesNotMatch(pageSource, /Meeste opdrachten/);
  assert.match(
    pageSource,
    /<div class="leaderboard-copy">\s*<div class="leaderboard-list" id="leaderboardList">[\s\S]*Servé[\s\S]*0 opdrachten[\s\S]*Martijn[\s\S]*0 opdrachten/
  );
  assert.match(pageSource, /leaderboardCard: document\.getElementById\("leaderboardCard"\),/);
  assert.match(pageSource, /leaderboardList: document\.getElementById\("leaderboardList"\),/);
  assert.match(pageSource, /function updateLeaderboard\(\)/);
  assert.match(pageSource, /const counts = state\.klanten\.reduce\(function \(result, customer\)/);
  assert.match(pageSource, /displayName: formatResponsibleDisplayName\("Serve"\)/);
  assert.match(pageSource, /displayName: formatResponsibleDisplayName\("Martijn"\)/);
  assert.match(pageSource, /<script src="assets\/premium-customers-renderers\.js\?v=20260427a"><\/script>/);
  assert.match(pageSource, /window\.SoftoraCustomersRenderers\.renderLeaderboard\(nodes\.leaderboardList, entries\);/);
  assert.match(pageSource, /window\.SoftoraCustomersRenderers\.renderRows\(nodes\.body, filtered, \{/);
  assert.match(rendererSource, /function renderLeaderboard\(target, entries\) \{/);
  assert.match(rendererSource, /target\.replaceChildren\(\);/);
  assert.match(rendererSource, /row\.className = index === 0 \? "leaderboard-entry is-leading" : "leaderboard-entry";/);
  assert.match(rendererSource, /appendText\(row, "span", "leaderboard-entry-name", entry\.displayName\);/);
  assert.match(rendererSource, /function createCell\(label, className\) \{/);
  assert.match(rendererSource, /function renderRows\(target, customers, helpers\) \{/);
  assert.match(pageSource, /nodes\.body\.replaceChildren\(\);/);
  assert.match(rendererSource, /fragment\.appendChild\(row\);/);
  assert.doesNotMatch(pageSource, /nodes\.body\.innerHTML/);
  assert.doesNotMatch(pageSource, /nodes\.leaderboardList\.innerHTML/);
  assert.doesNotMatch(rendererSource, /\.innerHTML\s*=/);
  assert.doesNotMatch(pageSource, /function escapeHtml\(value\)/);
  assert.match(pageSource, /function updateStats\(\) \{[\s\S]*updateLeaderboard\(\);[\s\S]*\}/);
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

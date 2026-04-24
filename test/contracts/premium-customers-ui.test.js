const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium customers page bootstraps customer rows before async sync runs', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->/);
  assert.match(pageSource, /function formatCustomerServiceLabel\(service\)/);
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
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<th>Toegewezen aan<\/th>/);
  assert.match(pageSource, /<th>Review\?<\/th>\s*<th>Betaaldatum<\/th>/);
  assert.match(pageSource, /<label class="form-label" for="fieldResponsible">Toegewezen aan<\/label>/);
  assert.match(pageSource, /<select class="form-select" id="fieldResponsible" name="verantwoordelijk" required>/);
  assert.match(pageSource, /<option value="Serve" selected>Servé<\/option>/);
  assert.match(pageSource, /<option value="Martijn">Martijn<\/option>/);
  assert.match(pageSource, /fieldResponsible: document\.getElementById\("fieldResponsible"\),/);
  assert.match(pageSource, /function parseResponsibleValue\(value\)/);
  assert.match(pageSource, /function normalizeResponsibleValue\(value\)/);
  assert.match(pageSource, /function formatResponsibleDisplayName\(value\)/);
  assert.match(pageSource, /function getResponsibleSourceValue\(raw\)/);
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
  assert.match(pageSource, /nodes\.leaderboardList\.innerHTML = entries\.map\(function \(entry, index\) \{/);
  assert.match(pageSource, /const rowClassName = index === 0 \? "leaderboard-entry is-leading" : "leaderboard-entry";/);
  assert.match(pageSource, /escapeHtml\(entry\.displayName\)/);
  assert.match(pageSource, /escapeHtml\(entry\.count \+ " " \+ assignmentLabel\)/);
  assert.match(pageSource, /function updateStats\(\) \{[\s\S]*updateLeaderboard\(\);[\s\S]*\}/);
});

test('premium customers page preserves the shared database lifecycle status', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /function normalizeCustomerDatabaseStatus\(raw\)/);
  assert.match(pageSource, /if \(value === "afgehaakt"\) return "afgehaakt";/);
  assert.match(pageSource, /databaseStatus: normalizeCustomerDatabaseStatus\(raw\),/);
  assert.match(pageSource, /JSON\.stringify\(normalizedCustomers\)/);
});

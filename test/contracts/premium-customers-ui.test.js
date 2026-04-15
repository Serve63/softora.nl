const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium customers page bootstraps customer rows before async sync runs', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
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
});

test('premium customers page supports toegewezen aan in table, modal and order import', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<th>Toegewezen aan<\/th>/);
  assert.match(pageSource, /<label class="form-label" for="fieldResponsible">Toegewezen aan<\/label>/);
  assert.match(pageSource, /<select class="form-select" id="fieldResponsible" name="verantwoordelijk" required>/);
  assert.match(pageSource, /<option value="Serve" selected>Serve<\/option>/);
  assert.match(pageSource, /<option value="Martijn">Martijn<\/option>/);
  assert.match(pageSource, /fieldResponsible: document\.getElementById\("fieldResponsible"\),/);
  assert.match(pageSource, /function parseResponsibleValue\(value\)/);
  assert.match(pageSource, /function normalizeResponsibleValue\(value\)/);
  assert.match(pageSource, /function getResponsibleSourceValue\(raw\)/);
  assert.match(pageSource, /claimedBy: normalizeString\(item && \(item\.claimedBy \|\| item\.leadOwnerName \|\| item\.leadOwnerFullName\)\),/);
  assert.match(pageSource, /customer\.verantwoordelijk,/);
  assert.match(pageSource, /<td data-label=\\"Toegewezen aan\\" class=\\"muted-cell\\">/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = "Serve";/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = customer\.verantwoordelijk \|\| "Serve";/);
  assert.match(pageSource, /verantwoordelijk: nodes\.fieldResponsible \? nodes\.fieldResponsible\.value : "Serve",/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /thead th:nth-child\(6\) \{ width: 13%; white-space: normal; line-height: 1\.25; \}/);
  assert.match(pageSource, /thead th:nth-child\(9\) \{ width: 6%; \}/);
  assert.match(pageSource, /\.action-btn \{[\s\S]*width: 34px;[\s\S]*height: 34px;[\s\S]*display: inline-flex;[\s\S]*justify-content: center;/);
  assert.match(pageSource, /aria-label=\\"Klant bewerken\\"/);
  assert.match(pageSource, /<svg viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"1\.8\\"><path d=\\"M12 20h9\\"\/><path d=\\"M16\.5 3\.5a2\.12 2\.12 0 113 3L7 19l-4 1 1-4 12\.5-12\.5z\\"\/><\/svg>/);
  assert.match(pageSource, /<div class="database-toolbar-actions">[\s\S]*<div class="leaderboard-card" id="leaderboardCard">/);
  assert.match(pageSource, /<div class="leaderboard-label">Meeste opdrachten<\/div>/);
  assert.match(pageSource, /<div class="leaderboard-value" id="leaderboardValue">Serve<\/div>/);
  assert.match(pageSource, /<div class="leaderboard-meta" id="leaderboardMeta">0 opdrachten<\/div>/);
  assert.match(pageSource, /\.leaderboard-card \{[\s\S]*display: inline-flex;[\s\S]*border: 1px solid rgba\(139, 34, 82, 0\.22\);[\s\S]*background: rgba\(139, 34, 82, 0\.06\);/);
  assert.match(pageSource, /\.leaderboard-icon svg \{[\s\S]*width: 16px;[\s\S]*height: 16px;/);
  assert.match(pageSource, /leaderboardCard: document\.getElementById\("leaderboardCard"\),/);
  assert.match(pageSource, /leaderboardValue: document\.getElementById\("leaderboardValue"\),/);
  assert.match(pageSource, /leaderboardMeta: document\.getElementById\("leaderboardMeta"\),/);
  assert.match(pageSource, /function updateLeaderboard\(\)/);
  assert.match(pageSource, /const counts = state\.klanten\.reduce\(function \(result, customer\)/);
  assert.match(pageSource, /nodes\.leaderboardValue\.textContent = isTie \? "Serve & Martijn" : leader\.name;/);
  assert.match(pageSource, /nodes\.leaderboardMeta\.textContent = isTie[\s\S]*" elk"[\s\S]*: leader\.count \+ " " \+ assignmentLabel;/);
  assert.match(pageSource, /function updateStats\(\) \{[\s\S]*updateLeaderboard\(\);[\s\S]*\}/);
});

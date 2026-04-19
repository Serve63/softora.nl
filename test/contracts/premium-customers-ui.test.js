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
  assert.match(pageSource, /<option value="Serve" selected>Servé<\/option>/);
  assert.match(pageSource, /<option value="Martijn">Martijn<\/option>/);
  assert.match(pageSource, /fieldResponsible: document\.getElementById\("fieldResponsible"\),/);
  assert.match(pageSource, /function parseResponsibleValue\(value\)/);
  assert.match(pageSource, /function normalizeResponsibleValue\(value\)/);
  assert.match(pageSource, /function formatResponsibleDisplayName\(value\)/);
  assert.match(pageSource, /function getResponsibleSourceValue\(raw\)/);
  assert.match(pageSource, /claimedBy: normalizeString\(item && \(item\.claimedBy \|\| item\.leadOwnerName \|\| item\.leadOwnerFullName\)\),/);
  assert.match(pageSource, /customer\.verantwoordelijk,/);
  assert.match(pageSource, /<td data-label=\\"Toegewezen aan\\" class=\\"muted-cell\\">" \+ escapeHtml\(formatResponsibleDisplayName\(customer\.verantwoordelijk \|\| "Serve"\)\) \+ "<\/td>/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = "Serve";/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = customer\.verantwoordelijk \|\| "Serve";/);
  assert.match(pageSource, /verantwoordelijk: nodes\.fieldResponsible \? nodes\.fieldResponsible\.value : "Serve",/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /\.hero \{[\s\S]*display: flex;[\s\S]*justify-content: space-between;/);
  assert.match(pageSource, /\.hero-side \{[\s\S]*margin-left: auto;[\s\S]*justify-content: flex-end;/);
  assert.match(pageSource, /thead th:nth-child\(7\) \{ width: 12%; white-space: normal; line-height: 1\.25; \}/);
  assert.match(pageSource, /thead th:nth-child\(11\) \{ width: 6%; \}/);
  assert.match(pageSource, /\.action-btn \{[\s\S]*width: 34px;[\s\S]*height: 34px;[\s\S]*display: inline-flex;[\s\S]*justify-content: center;/);
  assert.match(pageSource, /aria-label=\\"Klant bewerken\\"/);
  assert.match(pageSource, /<svg viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"1\.8\\"><path d=\\"M12 20h9\\"\/><path d=\\"M16\.5 3\.5a2\.12 2\.12 0 113 3L7 19l-4 1 1-4 12\.5-12\.5z\\"\/><\/svg>/);
  assert.match(pageSource, /<section class="hero">[\s\S]*<div class="hero-copy">[\s\S]*<div class="hero-side">[\s\S]*<div class="leaderboard-card" id="leaderboardCard">/);
  assert.doesNotMatch(pageSource, /Meeste opdrachten/);
  assert.match(
    pageSource,
    /<div class="leaderboard-copy">\s*<div class="leaderboard-list" id="leaderboardList">[\s\S]*Servé[\s\S]*0 opdrachten[\s\S]*Martijn[\s\S]*0 opdrachten/
  );
  assert.match(pageSource, /\.leaderboard-card \{[\s\S]*display: inline-flex;[\s\S]*width: min\(320px, 100%\);[\s\S]*padding: 0;[\s\S]*border: none;[\s\S]*background: transparent;/);
  assert.doesNotMatch(pageSource, /border: 1px solid rgba\(139, 34, 82, 0\.22\);/);
  assert.doesNotMatch(pageSource, /background: rgba\(139, 34, 82, 0\.06\);/);
  assert.match(pageSource, /\.leaderboard-list \{[\s\S]*display: grid;[\s\S]*gap: 0\.42rem;/);
  assert.match(pageSource, /\.leaderboard-entry-name \{[\s\S]*font-family: 'Oswald', sans-serif;[\s\S]*text-transform: uppercase;/);
  assert.match(pageSource, /\.leaderboard-icon svg \{[\s\S]*width: 16px;[\s\S]*height: 16px;/);
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

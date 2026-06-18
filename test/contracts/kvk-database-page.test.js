const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');

const repoRoot = path.join(__dirname, '../..');

test('kvk database clean URL resolves to the protected premium snapshot page', () => {
  const slugMap = createKnownPrettyPageSlugToFile(new Set(['premium-kvk-database.html']));

  assert.equal(slugMap.get('premium-kvk-database'), 'premium-kvk-database.html');
  assert.equal(slugMap.get('kvk-database'), 'premium-kvk-database.html');
});

test('kvk database snapshot page contains the local Bedrijven Scraper dashboard', () => {
  const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');

  assert.match(pageSource, /<title>Softora Database \| Bedrijven Scraper<\/title>/);
  assert.match(pageSource, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(pageSource, /<script id="kvkSnapshot" type="application\/json">/);
  assert.match(pageSource, /<h1>Bedrijven Scraper<\/h1>/);
  assert.match(pageSource, /id="companies-treated"/);
  assert.match(pageSource, /"companies_found":1123744/);
  assert.match(pageSource, /"with_website":239/);
  assert.match(pageSource, /"unusable":877/);
  assert.match(pageSource, /"all":1123744/);
  assert.match(pageSource, /"usable":263/);
  assert.match(pageSource, /"bedrijfsnaam":"Scouting St\. Joris Haaren"/);
  assert.match(pageSource, /id="planning-search-input"/);
  assert.doesNotMatch(pageSource, /id="progress-bar"/);
  assert.doesNotMatch(pageSource, /id="progress-label"/);
  assert.match(pageSource, /assets\/kvk-database\.js\?v=20260618b/);
});

test('kvk database collapse state survives a refresh', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');

  assert.match(scriptSource, /kvkCollapsedPanels/);
  assert.match(scriptSource, /history\.replaceState/);
  assert.doesNotMatch(scriptSource, /function saveCollapsedPanels\(\)\{\}/);
});

test('kvk database page loads a live snapshot before using embedded fallback data', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');

  assert.match(scriptSource, /activeSnapshot=embeddedSnapshot/);
  assert.match(scriptSource, /function hasUsableSnapshot/);
  assert.match(scriptSource, /async function loadRemoteSnapshot/);
  assert.match(scriptSource, /\/api\/kvk-database\/snapshot\?t=/);
  assert.match(scriptSource, /credentials:"same-origin"/);
  assert.match(scriptSource, /await loadRemoteSnapshot\(\),bindEvents/);
  assert.match(scriptSource, /await loadRemoteSnapshot\(\);const\[t,a\]=await Promise\.all/);
});

test('kvk database snapshot API is wired and only public for token-protected sync posts', () => {
  const routesSource = fs.readFileSync(path.join(repoRoot, 'server/routes/kvk-database.js'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'server/services/feature-routes-runtime.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(repoRoot, 'server/security/premium-auth.js'), 'utf8');

  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/snapshot'/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/snapshot'/);
  assert.match(runtimeSource, /createKvkDatabaseSnapshotService/);
  assert.match(runtimeSource, /registerKvkDatabaseRoutes/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/snapshot' && method === 'POST'/);
  assert.doesNotMatch(authSource, /requestPath === '\/api\/kvk-database\/snapshot' && method === 'GET'/);
});

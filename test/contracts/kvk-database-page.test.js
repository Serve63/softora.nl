const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');

const repoRoot = path.join(__dirname, '../..');

test('kvk database clean URL resolves to the protected premium sidebar shell', () => {
  const slugMap = createKnownPrettyPageSlugToFile(
    new Set(['premium-kvk-database.html', 'premium-kvk-database-shell.html'])
  );

  assert.equal(slugMap.get('premium-kvk-database'), 'premium-kvk-database.html');
  assert.equal(slugMap.get('kvk-database'), 'premium-kvk-database-shell.html');
});

test('kvk database shell keeps the premium sidebar around the scraper', () => {
  const shellSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database-shell.html'), 'utf8');

  assert.match(shellSource, /data-sidebar-shell="canonical"/);
  assert.match(shellSource, /<aside class="sidebar" data-sidebar-ready="false"/);
  assert.match(shellSource, /personnel-theme\.css\?v=20260519b/);
  assert.match(shellSource, /personnel-theme\.js\?v=20260519b/);
  assert.match(shellSource, /html, body \{ height: 100%; margin: 0; overflow: hidden;/);
  assert.match(shellSource, /\.kvk-database-shell \{ display: flex; height: 100vh; \}/);
  assert.match(shellSource, /<main class="main-content kvk-database-shell__content"/);
  assert.match(shellSource, /src="\/premium-kvk-database\?softora_sidebar_content=1"/);
  assert.match(shellSource, /title="Softora Database Bedrijven Scraper"/);
});

test('shared premium sidebar script also initializes on the clean kvk database route', () => {
  const themeSource = fs.readFileSync(path.join(repoRoot, 'assets/personnel-theme.js'), 'utf8');

  assert.match(themeSource, /pathname === "\/kvk-database"/);
  assert.match(themeSource, /pathname === "\/kvk-database\.html"/);
  assert.match(themeSource, /sidebar\.innerHTML = buildUnifiedPremiumSidebarHtml\(activeKey\)/);
  assert.match(themeSource, /sidebar\.dataset\.sidebarReady = "true"/);
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
  assert.match(pageSource, /<h2>Laatste 10 Behandeld<\/h2>/);
  assert.match(pageSource, /id="latest-treated-table-frame"/);
  assert.ok(
    pageSource.indexOf('<h2>Laatste 10 Behandeld</h2>') < pageSource.indexOf('<h2>Planning</h2>'),
    'Laatste 10 Behandeld hoort boven Planning te staan'
  );
  assert.doesNotMatch(pageSource, /id="progress-bar"/);
  assert.doesNotMatch(pageSource, /id="progress-label"/);
  assert.match(pageSource, /assets\/kvk-database\.js\?v=20260618b/);
});

test('kvk database collapse state survives a refresh', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');

  assert.match(scriptSource, /function collapsedPanelsHistory\(\)/);
  assert.match(scriptSource, /window\.parent!==window&&window\.parent\.history/);
  assert.match(scriptSource, /collapsedPanelsHistory\(\)/);
  assert.match(scriptSource, /\.replaceState\(/);
  assert.doesNotMatch(scriptSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(scriptSource, /function saveCollapsedPanels\(\)\{\}/);
});

test('kvk database planning merges current parallel route progress', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');

  assert.match(scriptSource, /contact_parallel_routes/);
  assert.match(scriptSource, /location_code/);
  assert.match(scriptSource, /\.done/);
  assert.match(scriptSource, /contact_parallel_active_location_codes/);
  assert.match(scriptSource, /function getContactActiveCodes\(\)/);
});

test('kvk database renders latest treated snapshot rows in the restored panel', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.css'), 'utf8');

  assert.match(scriptSource, /latestTreated:Array\.isArray\(embeddedSnapshot\.latestTreated\)/);
  assert.match(scriptSource, /state\.latestTreated=Array\.isArray\(e\.latestTreated\)/);
  assert.match(scriptSource, /function renderLatestTreatedRows\(\)/);
  assert.match(scriptSource, /\[e\.woonplaats,e\.provincie\]\.filter\(Boolean\)\.join\(", "\)/);
  assert.match(scriptSource, /renderStats\(\),renderLatestTreatedRows\(\),renderLocationList\(\)/);
  assert.match(styleSource, /\.latest-treated-panel\{[^}]*margin-top:0;[^}]*margin-bottom:18px/);
});

test('kvk database hides the page scrollbar without disabling scrolling', () => {
  const styleSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.css'), 'utf8');

  assert.match(styleSource, /html\{[^}]*scrollbar-width:none;[^}]*-ms-overflow-style:none/);
  assert.match(styleSource, /body\{[^}]*scrollbar-width:none;[^}]*-ms-overflow-style:none/);
  assert.match(styleSource, /(?:html|body)::\-webkit-scrollbar,(?:html|body)::\-webkit-scrollbar/);
  assert.match(styleSource, /::\-webkit-scrollbar\{display:none;width:0;height:0\}/);
  assert.doesNotMatch(styleSource, /html\{[^}]*overflow:hidden/);
  assert.doesNotMatch(styleSource, /body\{[^}]*overflow:hidden/);
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

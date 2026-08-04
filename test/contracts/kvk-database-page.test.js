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
  assert.match(pageSource, /<script id="kvkSnapshot" type="application\/json">\{\}<\/script>/);
  assert.ok(Buffer.byteLength(pageSource, 'utf8') < 50_000, 'KVK paginashell mag geen datasnapshot bevatten');
  assert.match(pageSource, /<h1>Bedrijven Scraper<\/h1>/);
  assert.match(pageSource, /id="companies-treated"/);
  assert.match(pageSource, /id="companies-successful-found"/);
  assert.ok(
    pageSource.indexOf('id="companies-successful-found"') <
      pageSource.indexOf('id="companies-usable"'),
    'Succesvol Gevonden hoort direct voor Bruikbaar te staan'
  );
  assert.doesNotMatch(pageSource, /"companies_found"|"kvk_nummer"|"contact_research_note"/);
  assert.match(pageSource, /id="planning-search-input"/);
  assert.match(pageSource, /<h2>Laatste 10 Fouten van Luna Max<\/h2>/);
  assert.match(pageSource, /id="latest-luna-errors-table-frame"/);
  assert.ok(
    pageSource.indexOf('<h2>Laatste 10 Fouten van Luna Max</h2>') < pageSource.indexOf('<h2>Planning</h2>'),
    'De Luna Max-fouten horen boven Planning te staan'
  );
  assert.doesNotMatch(pageSource, /<h2>Laatste 10 Behandeld<\/h2>/);
  assert.doesNotMatch(pageSource, /id="latest-treated-table-frame"/);
  assert.doesNotMatch(pageSource, /id="progress-bar"/);
  assert.doesNotMatch(pageSource, /id="progress-label"/);
  assert.match(pageSource, /assets\/kvk-database\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/kvk-database-luna-errors\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/kvk-database-control\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/kvk-database-control\.css\?v=20260804a/);
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

test('kvk database visually renders only material Luna Max errors with before and after values', () => {
  const lunaErrors = require('../../assets/kvk-database-luna-errors.js');
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-luna-errors.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.css'), 'utf8');

  assert.match(scriptSource, /snapshot\?\.latestLunaErrors/);
  assert.doesNotMatch(scriptSource, /latestTreated/);
  assert.match(scriptSource, /Geen fouten van Luna Max gevonden\./);
  assert.match(scriptSource, /Luna Max had/);
  assert.match(scriptSource, /Gecorrigeerd naar/);
  assert.match(scriptSource, /controller_model_label/);
  assert.match(scriptSource, /deps\.window\.setInterval\(controller\.render, 1000\)/);

  const html = lunaErrors.findingRowHtml({
    kvk_nummer: '12345678',
    bedrijfsnaam: 'Voorbeeld & Zoon',
    woonplaats: 'Vught',
    provincie: 'Noord-Brabant',
    error_label: 'Onjuiste gegevens',
    incorrect_fields: ['Telefoonnummer'],
    luna_value_summary: 'Telefoonnummer: 0612345678',
    corrected_value_summary: 'Telefoonnummer: 0731234567',
    controller_role_label: 'Controleur',
    controller_model_label: 'Sol 5.6 xhigh',
    detected_at: new Date().toISOString(),
  });
  assert.match(html, /Voorbeeld &amp; Zoon/);
  assert.match(html, /Telefoonnummer: 0612345678/);
  assert.match(html, /Telefoonnummer: 0731234567/);
  assert.match(html, /Sol 5\.6 xhigh/);
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

test('kvk database page loads its protected live snapshot with an empty embedded bootstrap', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');

  assert.match(scriptSource, /activeSnapshot=embeddedSnapshot/);
  assert.match(scriptSource, /function hasUsableSnapshot/);
  assert.match(scriptSource, /async function loadRemoteSnapshot/);
  assert.match(scriptSource, /\/api\/kvk-database\/snapshot\?t=/);
  assert.match(scriptSource, /credentials:"same-origin"/);
  assert.match(scriptSource, /await loadRemoteSnapshot\(\),bindEvents/);
  assert.match(scriptSource, /await loadRemoteSnapshot\(\);const\[t,a\]=await Promise\.all/);
});

test('kvk database refreshes live counters while the page stays open', () => {
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');

  assert.match(scriptSource, /const DASHBOARD_REFRESH_INTERVAL_MS=15e3/);
  assert.match(scriptSource, /window\.setInterval\(\(\)=>refreshDashboardWhenVisible\(\),DASHBOARD_REFRESH_INTERVAL_MS\)/);
  assert.match(scriptSource, /window\.addEventListener\("focus",\(\)=>refreshDashboardWhenVisible\(\{reloadTables:!0\}\)\)/);
  assert.match(scriptSource, /document\.addEventListener\("visibilitychange",\(\)=>refreshDashboardWhenVisible\(\{reloadTables:!0\}\)\)/);
  assert.match(scriptSource, /renderStats\(\),renderLatestTreatedRows\(\),renderLocationList\(\)/);
});

test('kvk database restores the last-hour deltas and unusable grade activity', () => {
  const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');
  const metricsSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-metrics.js'), 'utf8');
  const metricsStyles = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-metrics.css'), 'utf8');

  assert.match(pageSource, /id="companies-treated-last60"/);
  assert.match(pageSource, /id="companies-successful-found"/);
  assert.match(pageSource, /id="companies-successful-found-last60"/);
  assert.match(pageSource, /id="companies-usable-last60"/);
  assert.match(pageSource, /id="companies-with-website-last60"/);
  assert.match(pageSource, /id="companies-without-website-last60"/);
  assert.match(pageSource, /id="companies-unusable-grade-1"/);
  assert.match(pageSource, /id="companies-unusable-grade-2"/);
  assert.match(pageSource, /<span>Controle<\/span>/);
  assert.match(pageSource, /<span>Definitief<\/span>/);
  assert.doesNotMatch(pageSource, /<span>Grade [12]<\/span>/);
  assert.doesNotMatch(pageSource, /id="companies-unusable-grade-3"/);
  assert.doesNotMatch(metricsSource, /companies-unusable-grade-3/);
  assert.match(pageSource, /assets\/kvk-database-metrics\.js\?v=20260804b/);
  assert.match(pageSource, /assets\/kvk-database-metrics\.css\?v=20260803a/);
  assert.match(metricsSource, /companies-successful-found/);
  assert.match(metricsSource, /successful_found/);
  assert.match(metricsStyles, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(metricsSource, /typeof activeSnapshot === 'undefined'/);
  assert.match(metricsSource, /last_60_minutes/);
  assert.match(pageSource, /id="luna-max-found-last60"/);
  assert.match(pageSource, /Luna Max gevonden/);
  assert.match(metricsSource, /last60\.luna_max_found/);
  assert.match(metricsSource, /unusable_grade_activity/);
  assert.match(metricsSource, /unusableGrades\['3'\]/);
  assert.match(metricsSource, /deps\.window\.setInterval\(controller\.renderMetrics, 1000\)/);
  assert.match(metricsSource, /count > 0 \? '\+' : ''/);
  assert.match(metricsStyles, /\.stat-delta-number/);
  assert.match(metricsStyles, /\.unusable-grade-delta-removed/);
  const definitiveDeltaMarkup = pageSource.match(/<small id="companies-unusable-grade-2-last60">([\s\S]*?)<\/small>/)?.[1] || '';
  assert.doesNotMatch(definitiveDeltaMarkup, /unusable-grade-delta-removed/);
  assert.match(metricsSource, /elements\.unusableGrade2Last60,[\s\S]*?false,/);
});

test('kvk database shows completed locations crossed out with usable company totals', () => {
  const mainSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.js'), 'utf8');
  const controlSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-control.js'), 'utf8');
  const controlStyles = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-control.css'), 'utf8');

  assert.match(mainSource, /contact_review_completed_location_codes/);
  assert.match(mainSource, /Controle volledig afgerond/);
  assert.match(mainSource, /Controle nog niet volledig afgerond/);
  assert.match(controlSource, /statusBoxes\.length >= 3/);
  assert.match(controlSource, /slice\(0, 3\)/);
  assert.match(controlSource, /every\(\(box\) => box\.classList\.contains\('is-done'\)\)/);
  assert.match(controlSource, /classList\.toggle\('is-complete', complete\)/);
  assert.match(controlSource, /bruikbareBedrijven/);
  assert.match(controlSource, /\/api\/kvk-database\/location-stats/);
  assert.match(controlSource, /Bruikbare bedrijven/);
  assert.match(controlStyles, /\.location-button\.is-complete \.location-path/);
  assert.match(controlStyles, /text-decoration: line-through/);
});

test('kvk database renders Luna Max throughput and a real fill control', () => {
  const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');
  const controlSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-control.js'), 'utf8');
  const controlStyles = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-control.css'), 'utf8');

  assert.match(pageSource, /id="database-fill-toggle"/);
  assert.match(pageSource, /database-fill-toggle__caption">Database vullen/);
  assert.match(pageSource, /id="database-fill-toggle-label"[^>]*>UIT</);
  assert.match(pageSource, /id="last-refresh-time" class="kvk-visually-hidden"/);
  assert.doesNotMatch(pageSource, /Tijd sinds laatste refresh/);
  assert.match(controlSource, /seconds === 1 \? 'seconde' : 'seconden'/);
  assert.match(controlSource, /window\.setInterval\(renderRefreshAge, 1000\)/);
  assert.match(controlSource, /fetch\('\/api\/kvk-database\/control'/);
  assert.match(controlSource, /'X-Softora-Requested-With': 'premium'/);
  assert.match(controlSource, /JSON\.stringify\(\{ enabled: !state\.control\.enabled \}\)/);
  assert.match(controlSource, /fillButtonLabel\.textContent = enabled \? 'AAN' : 'UIT'/);
  assert.match(controlSource, /\['vuller', 'controle', 'goedgekeurd'\]/);
  assert.match(controlSource, /window\.setInterval\(loadControl, 5_000\)/);
  assert.match(controlStyles, /\.database-fill-toggle__track/);
  assert.match(controlStyles, /translateX\(15px\)/);
});

test('kvk database snapshot API is wired and only public for token-protected sync posts', () => {
  const routesSource = fs.readFileSync(path.join(repoRoot, 'server/routes/kvk-database.js'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'server/services/feature-routes-runtime.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(repoRoot, 'server/security/premium-auth.js'), 'utf8');
  const requestContextSource = fs.readFileSync(path.join(repoRoot, 'server/security/request-context.js'), 'utf8');

  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/snapshot'/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/snapshot'/);
  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/location-stats', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/control', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control\/poll'/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control\/worker'/);
  assert.match(runtimeSource, /createKvkDatabaseSnapshotService/);
  assert.match(runtimeSource, /createKvkDatabaseControlService/);
  assert.match(runtimeSource, /registerKvkDatabaseRoutes/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/snapshot' && method === 'POST'/);
  assert.doesNotMatch(authSource, /requestPath === '\/api\/kvk-database\/snapshot' && method === 'GET'/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/control\/poll'/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/control\/worker'/);
  assert.match(requestContextSource, /'\/api\/kvk-database\/control\/poll'/);
  assert.match(requestContextSource, /'\/api\/kvk-database\/control\/worker'/);
});

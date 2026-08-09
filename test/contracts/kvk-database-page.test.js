const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');

const repoRoot = path.join(__dirname, '../..');

test('kvk database clean URL resolves to the protected premium sidebar shell', () => {
  const slugMap = createKnownPrettyPageSlugToFile(
    new Set([
      'premium-kvk-database.html',
      'premium-kvk-database-shell.html',
      'premium-kvk-company-directory.html',
      'premium-kvk-company-directory-shell.html',
    ])
  );

  assert.equal(slugMap.get('premium-kvk-database'), 'premium-kvk-database.html');
  assert.equal(slugMap.get('kvk-database'), 'premium-kvk-database-shell.html');
  assert.equal(slugMap.get('kvk-database-bedrijven'), 'premium-kvk-company-directory-shell.html');
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
  assert.match(themeSource, /pathname === "\/kvk-database-bedrijven"/);
  assert.match(themeSource, /sidebar\.innerHTML = buildUnifiedPremiumSidebarHtml\(activeKey\)/);
  assert.match(themeSource, /sidebar\.dataset\.sidebarReady = "true"/);
});

test('alle gevonden bedrijven heeft een eigen beschermde pagina met canonical sidebar', () => {
  const shellSource = fs.readFileSync(
    path.join(repoRoot, 'premium-kvk-company-directory-shell.html'),
    'utf8'
  );
  const pageSource = fs.readFileSync(
    path.join(repoRoot, 'premium-kvk-company-directory.html'),
    'utf8'
  );

  assert.match(shellSource, /data-sidebar-shell="canonical"/);
  assert.match(shellSource, /<aside class="sidebar" data-sidebar-ready="false"/);
  assert.match(shellSource, /<main class="main-content company-directory-shell__content"/);
  assert.match(shellSource, /<h1 id="company-directory-title">Alle gevonden bedrijven<\/h1>/);
  assert.match(shellSource, /id="company-directory-search"/);
  assert.match(shellSource, /id="company-directory-table-frame"/);
  assert.match(shellSource, /id="company-directory-total"/);
  assert.match(shellSource, /id="company-directory-retry"/);
  assert.doesNotMatch(shellSource, /<p class="eyebrow">Softora Database<\/p>/);
  assert.match(shellSource, /assets\/kvk-database-total-found\.css\?v=20260809a/);
  assert.match(shellSource, /assets\/kvk-database-total-found\.js\?v=20260809c/);
  assert.match(shellSource, />Opnieuw laden<\/button>/);
  assert.doesNotMatch(shellSource, /assets\/kvk-database\.css/);
  assert.doesNotMatch(shellSource, /<iframe/);
  assert.match(pageSource, /<h1 id="company-directory-title">Alle gevonden bedrijven<\/h1>/);
  assert.match(pageSource, /href="\/kvk-database" target="_top"/);
  assert.match(pageSource, /id="company-directory-search"/);
  assert.match(pageSource, /id="company-directory-table-frame"/);
  assert.match(pageSource, /id="company-directory-total"/);
  assert.doesNotMatch(pageSource, /<p class="eyebrow">Softora Database<\/p>/);
  assert.match(pageSource, /assets\/kvk-database-total-found\.css\?v=20260809a/);
  assert.match(pageSource, /assets\/kvk-database-total-found\.js\?v=20260809c/);
});

test('kvk database snapshot page contains the local Bedrijven Scraper dashboard', () => {
  const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');

  assert.match(pageSource, /<title>Softora Database \| Bedrijven Scraper<\/title>/);
  assert.match(pageSource, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(pageSource, /<script id="kvkSnapshot" type="application\/json">\{\}<\/script>/);
  assert.ok(Buffer.byteLength(pageSource, 'utf8') < 50_000, 'KVK paginashell mag geen datasnapshot bevatten');
  assert.match(pageSource, /<h1>Bedrijven Scraper<\/h1>/);
  assert.match(pageSource, /id="companies-treated"/);
  assert.match(pageSource, /id="companies-total-card"/);
  assert.doesNotMatch(pageSource, /id="companies-total-card"[^>]*role="link"/);
  assert.doesNotMatch(pageSource, /id="companies-total-card"[^>]*tabindex=/);
  assert.match(pageSource, /<button id="companies-total-open"[^>]*aria-label="Bekijk alle bedrijven"[^>]*title="Bekijk alle bedrijven"/);
  assert.match(pageSource, /id="companies-total-open"[\s\S]*?<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(pageSource, /BEKIJK ALLE BEDRIJVEN|Bekijk alle bedrijven →/);
  assert.doesNotMatch(pageSource, /id="companies-total-card"[^>]*aria-controls=/);
  assert.doesNotMatch(pageSource, /id="total-found-source-status"/);
  assert.doesNotMatch(pageSource, /data-collapsible="total-found"/);
  assert.doesNotMatch(pageSource, /<h2 id="table-title">Totaal Gevonden<\/h2>/);
  assert.doesNotMatch(pageSource, /aria-label="Totaal Gevonden inklappen"/);
  assert.match(pageSource, /<div hidden aria-hidden="true">[\s\S]*?id="main-table-frame"/);
  assert.match(pageSource, /id="companies-successful-found"/);
  assert.ok(
    pageSource.indexOf('id="companies-successful-found"') <
      pageSource.indexOf('id="companies-usable"'),
    'Succesvol Gevonden hoort direct voor Bruikbaar te staan'
  );
  assert.doesNotMatch(pageSource, /"companies_found"|"kvk_nummer"|"contact_research_note"/);
  assert.match(pageSource, /id="planning-search-input"/);
  assert.match(pageSource, /<h2>Laatste 10 Behandeld<\/h2>/);
  assert.match(pageSource, /id="latest-luna-errors-table-frame"/);
  assert.ok(
    pageSource.indexOf('<h2>Laatste 10 Behandeld</h2>') < pageSource.indexOf('<h2>Planning</h2>'),
    'De nieuwe Searcher-resultaten en Controleur-correcties horen boven Planning te staan'
  );
  assert.doesNotMatch(pageSource, /id="latest-treated-table-frame"/);
  assert.doesNotMatch(pageSource, /id="progress-bar"/);
  assert.doesNotMatch(pageSource, /id="progress-label"/);
  assert.match(pageSource, /assets\/kvk-database\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/kvk-database-total-found\.js\?v=20260809c/);
  assert.match(pageSource, /assets\/kvk-database-total-found\.css\?v=20260809a/);
  assert.match(pageSource, /assets\/kvk-database-luna-errors\.js\?v=20260804b/);
  assert.match(pageSource, /assets\/kvk-database-control\.js\?v=20260804b/);
  assert.match(pageSource, /assets\/kvk-database-control\.css\?v=20260804b/);
});

test('totaal gevonden opent de productiepagina met de volledige online bedrijfsbron', () => {
  const totalFound = require('../../assets/kvk-database-total-found.js');
  const scriptSource = fs.readFileSync(
    path.join(repoRoot, 'assets/kvk-database-total-found.js'),
    'utf8'
  );
  const styleSource = fs.readFileSync(
    path.join(repoRoot, 'assets/kvk-database-total-found.css'),
    'utf8'
  );

  assert.equal(totalFound.COMPANY_API_URL, '/api/kvk-database/company-directory');
  assert.equal(totalFound.DIRECTORY_PAGE_URL, '/kvk-database-bedrijven');
  assert.equal(totalFound.PAGE_SIZE, 100);
  assert.equal(totalFound.REQUEST_TIMEOUT_MS, 30000);
  assert.match(totalFound.buildCompanyApiUrl('Café & Zoon', 200), /q=Caf%C3%A9\+%26\+Zoon/);
  assert.match(totalFound.buildCompanyApiUrl('Café & Zoon', 200), /after=200/);
  assert.deepEqual(totalFound.companyFetchOptions(), {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  assert.match(scriptSource, /openButton\.addEventListener\('click', openDirectory\)/);
  assert.doesNotMatch(scriptSource, /card\.addEventListener/);
  assert.match(styleSource, /\.stat-card-total-found__open\s*\{/);
  assert.match(styleSource, /\.stat-card-total-found__open:focus-visible/);
  assert.match(
    styleSource,
    /\.company-directory-shell-page \.sidebar\s*\{[^}]*bottom:\s*0 !important;[^}]*height:\s*auto !important;[^}]*min-height:\s*0 !important;[^}]*max-height:\s*none !important;/s
  );
  assert.doesNotMatch(styleSource, /\.company-directory-shell-page\s*\{[^}]*--(?:ink|muted|page|panel):/s);
  assert.match(styleSource, /\.company-directory\s*\{[^}]*--ink:\s*#252229;/s);
  assert.match(scriptSource, /Online bedrijvendatabase is tijdelijk niet bereikbaar\./);
  assert.doesNotMatch(styleSource, /content:\s*["']/);
  assert.match(scriptSource, /targetWindow\?\.location\?\.assign\(DIRECTORY_PAGE_URL\)/);
  assert.match(scriptSource, /frame\.scrollTop \+ frame\.clientHeight >= frame\.scrollHeight - 180/);
  assert.match(scriptSource, /if \(!reset && \(state\.loading \|\| !state\.hasMore\)\) return;/);
  assert.match(scriptSource, /if \(!state\.query\) state\.total = Math\.max/);
  assert.match(scriptSource, /retryButton\?\.addEventListener\('click', \(\) => loadPage\(\{ reset: true \}\)\)/);
  assert.match(scriptSource, /browserWindow\.setTimeout\(\(\) => controller\.abort\(\), REQUEST_TIMEOUT_MS\)/);
  assert.doesNotMatch(scriptSource, /127\.0\.0\.1|localhost|local-network-access|loopback-network|targetAddressSpace/);
  assert.doesNotMatch(scriptSource, /scrollIntoView/);

  let assignedUrl = '';
  totalFound.navigateToDirectory({
    top: { location: { assign(url) { assignedUrl = url; } } },
  });
  assert.equal(assignedUrl, '/kvk-database-bedrijven');
  const untreatedHtml = totalFound.companyRowHtml({
    bedrijfsnaam: 'Nog te doen B.V.',
    kvk_nummer: '12345678',
    lead_status: 'unresearched',
    contact_status: 'unknown',
    woonplaats: 'Vught',
    gemeente: 'Vught',
    provincie: 'Noord-Brabant',
  });
  assert.match(untreatedHtml, /Nog niet behandeld/);
  assert.doesNotMatch(untreatedHtml, /Nog niet uitgezocht/);
  assert.equal((untreatedHtml.match(/Nog niet behandeld/g) || []).length, 4);
  assert.match(untreatedHtml, /Vught, Noord-Brabant/);

  const treatedHtml = totalFound.companyRowHtml({
    bedrijfsnaam: 'Behandeld & Getest',
    kvk_nummer: '87654321',
    lead_status: 'unusable',
    contact_status: 'checked',
    unusable_reason: 'missing_email',
    telefoonnummer: '0612345678',
    email: '',
    website: '',
  });
  assert.match(treatedHtml, /Behandeld &amp; Getest/);
  assert.match(treatedHtml, /Geen mail/);
  assert.equal((treatedHtml.match(/Niet gevonden/g) || []).length, 2);
  assert.doesNotMatch(treatedHtml, /Nog niet behandeld/);
});

test('online bedrijvenpagina laadt dezelfde-origin data zonder Chrome-netwerkprompt', async () => {
  const totalFound = require('../../assets/kvk-database-total-found.js');
  const elements = new Map();
  const makeElement = (extra = {}) => ({
    addEventListener() {},
    dataset: {},
    hidden: false,
    innerHTML: '',
    textContent: '',
    ...extra,
  });
  for (const id of [
    'company-directory',
    'company-directory-table-frame',
    'company-directory-head',
    'company-directory-body',
    'company-directory-search',
    'company-directory-source-status',
    'company-directory-retry',
    'company-directory-total',
  ]) {
    elements.set(id, makeElement());
  }

  let fetchedOptions = null;
  const controller = totalFound.mountDirectory({
    AbortController,
    clearTimeout,
    document: { getElementById(id) { return elements.get(id) || null; } },
    setTimeout,
    async fetch(url, options) {
      fetchedOptions = options;
      assert.match(url, /^\/api\/kvk-database\/company-directory\?/);
      return {
        ok: true,
        async json() {
          return {
            total: 2_924_398,
            has_more: true,
            next_cursor: 123,
            rows: [{ bedrijfsnaam: 'Scouting St. Joris Haaren', kvk_nummer: '40217416' }],
          };
        },
      };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchedOptions.credentials, 'same-origin');
  assert.equal(controller.state.cursor, 123);
  assert.equal(controller.state.total, 2_924_398);
  assert.equal(controller.state.rows.length, 1);
  assert.match(elements.get('company-directory-body').innerHTML, /Scouting St\. Joris Haaren/);
  assert.equal(elements.get('company-directory-total').textContent, '2.924.398');
  assert.equal(elements.get('company-directory-retry').hidden, true);
  assert.equal(elements.get('company-directory-source-status').textContent, '');
  assert.equal(elements.get('company-directory-source-status').dataset.tone, 'ready');
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

test('kvk database shows every new Searcher result and only material Controller corrections', () => {
  const lunaErrors = require('../../assets/kvk-database-luna-errors.js');
  const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-luna-errors.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database.css'), 'utf8');

  assert.match(scriptSource, /snapshot\?\.latestTreated/);
  assert.doesNotMatch(scriptSource, /snapshot\?\.latestLunaErrors/);
  assert.match(scriptSource, /Nog geen nieuwe Searcher-resultaten of Controleur-correcties\./);
  assert.match(scriptSource, /incorrect_approval: 'Onterecht goedgekeurd'/);
  assert.match(scriptSource, /missed_usable: 'Onterecht afgekeurd'/);
  assert.match(scriptSource, /activity\.found_by_model_label/);
  assert.match(scriptSource, /deps\.window\.setInterval\(controller\.render, 1000\)/);

  const html = lunaErrors.activityRowHtml({
    kvk_nummer: '12345678',
    bedrijfsnaam: 'Voorbeeld & Zoon',
    woonplaats: 'Vught',
    provincie: 'Noord-Brabant',
    lead_status: 'unusable',
    unusable_reason: 'missing_email',
    telefoonnummer: '0612345678',
    email: '',
    website: 'https://voorbeeld.nl',
    found_by_role_label: 'Searcher',
    found_by_model_label: 'Luna 5.6 Max',
    contact_checked_at: new Date().toISOString(),
  });
  assert.match(html, /Voorbeeld &amp; Zoon/);
  assert.match(html, /Geen mail/);
  assert.match(html, /0612345678/);
  assert.match(html, /Searcher/);
  assert.match(html, /Luna 5\.6 Max/);
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
  assert.match(pageSource, /assets\/kvk-database\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/kvk-database-metrics\.js\?v=20260804d/);
  assert.match(pageSource, /assets\/kvk-database-metrics\.css\?v=20260804c/);
  assert.match(metricsSource, /companies-successful-found/);
  assert.match(metricsSource, /successful_found/);
  assert.match(metricsSource, /companies-treated/);
  assert.match(metricsSource, /scraperState\.treated/);
  assert.match(metricsSource, /MutationObserver/);
  assert.match(metricsStyles, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(metricsSource, /typeof activeSnapshot === 'undefined'/);
  assert.match(metricsSource, /last_60_minutes/);
  assert.doesNotMatch(pageSource, /id="luna-max-found-last60"/);
  assert.doesNotMatch(pageSource, /Luna Max gevonden/);
  assert.doesNotMatch(metricsSource, /lunaMaxFoundLast60/);
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

test('kvk database renders a read-only live worker status controlled only by Codex chat', () => {
  const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');
  const controlSource = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-control.js'), 'utf8');
  const controlStyles = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-control.css'), 'utf8');
  const metricsStyles = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-metrics.css'), 'utf8');

  assert.match(pageSource, /id="database-fill-toggle"/);
  assert.match(pageSource, /id="database-fill-toggle"[^>]*role="status"/);
  assert.doesNotMatch(pageSource, /<button id="database-fill-toggle"/);
  assert.match(pageSource, /database-fill-toggle__caption">Database vullen/);
  assert.match(pageSource, /id="database-fill-toggle-label"[^>]*>UIT</);
  assert.match(pageSource, /id="last-refresh-time" class="kvk-visually-hidden"/);
  assert.doesNotMatch(pageSource, /Tijd sinds laatste refresh/);
  assert.match(controlSource, /seconds === 1 \? 'seconde' : 'seconden'/);
  assert.match(controlSource, /window\.setInterval\(renderRefreshAge, 1000\)/);
  assert.doesNotMatch(controlSource, /method: 'POST'/);
  assert.doesNotMatch(controlSource, /addEventListener\('click'/);
  assert.doesNotMatch(controlSource, /JSON\.stringify\(\{ enabled:/);
  assert.match(controlSource, /statusLabel = workerState === 'error'/);
  assert.match(controlSource, /uitsluitend via de Codex-chat/);
  assert.match(controlSource, /\['vuller', 'controle', 'goedgekeurd'\]/);
  assert.match(controlSource, /window\.setInterval\(loadControl, 5_000\)/);
  assert.match(controlStyles, /\.database-fill-toggle__track/);
  assert.match(controlStyles, /translateX\(15px\)/);
  assert.match(controlStyles, /cursor: default/);
  assert.match(pageSource, /stat-card stat-card-usable kvk-stat-card-enhanced[\s\S]*?<span>Mét Website<\/span>/);
  assert.match(pageSource, /stat-card stat-card-usable stat-card-without-website kvk-stat-card-enhanced/);
  assert.match(metricsStyles, /\.stat-card-without-website \.stat-main > span/);
  assert.match(metricsStyles, /white-space: nowrap/);
});

test('kvk database APIs keep reads protected and expose only token-protected sync posts', () => {
  const routesSource = fs.readFileSync(path.join(repoRoot, 'server/routes/kvk-database.js'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'server/services/feature-routes-runtime.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(repoRoot, 'server/security/premium-auth.js'), 'utf8');
  const requestContextSource = fs.readFileSync(path.join(repoRoot, 'server/security/request-context.js'), 'utf8');

  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/snapshot'/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/snapshot'/);
  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/company-directory', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/company-directory\/sync'/);
  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/location-stats', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.get\('\/api\/kvk-database\/control', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control', requirePremiumAdminApiAccess/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control\/command'/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control\/poll'/);
  assert.match(routesSource, /app\.post\('\/api\/kvk-database\/control\/worker'/);
  assert.match(runtimeSource, /createKvkDatabaseSnapshotService/);
  assert.match(runtimeSource, /createKvkDatabaseControlService/);
  assert.match(runtimeSource, /createKvkCompanyDirectoryService/);
  assert.match(runtimeSource, /registerKvkDatabaseRoutes/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/snapshot' && method === 'POST'/);
  assert.doesNotMatch(authSource, /requestPath === '\/api\/kvk-database\/snapshot' && method === 'GET'/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/company-directory\/sync' && method === 'POST'/);
  assert.doesNotMatch(authSource, /requestPath === '\/api\/kvk-database\/company-directory' && method === 'GET'/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/control\/poll'/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/control\/command'/);
  assert.match(authSource, /requestPath === '\/api\/kvk-database\/control\/worker'/);
  assert.match(requestContextSource, /'\/api\/kvk-database\/control\/poll'/);
  assert.match(requestContextSource, /'\/api\/kvk-database\/control\/command'/);
  assert.match(requestContextSource, /'\/api\/kvk-database\/control\/worker'/);
  assert.match(requestContextSource, /'\/api\/kvk-database\/company-directory\/sync'/);
});

test('online KVK directory tables are server-only and protected by RLS', () => {
  const migrationSource = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/20260809111248_kvk_company_directory_online.sql'),
    'utf8'
  );

  assert.match(migrationSource, /create table if not exists public\.softora_kvk_company_directory \(/i);
  assert.match(migrationSource, /create table if not exists public\.softora_kvk_company_directory_meta \(/i);
  assert.match(migrationSource, /alter table public\.softora_kvk_company_directory enable row level security;/i);
  assert.match(migrationSource, /revoke all on table public\.softora_kvk_company_directory from anon, authenticated;/i);
  assert.match(migrationSource, /grant select, insert, update, delete on table public\.softora_kvk_company_directory to service_role;/i);
  assert.doesNotMatch(migrationSource, /grant .* to anon|grant .* to authenticated/i);

  const searchMigrationSource = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/20260809123000_kvk_company_directory_search_index.sql'),
    'utf8'
  );
  assert.match(searchMigrationSource, /create extension if not exists pg_trgm with schema extensions;/i);
  assert.match(searchMigrationSource, /using gin \(search_text extensions\.gin_trgm_ops\);/i);
});

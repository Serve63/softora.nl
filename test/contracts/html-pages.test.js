const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createHtmlPageCoordinator,
  removeInternalPremiumSidebarLinks,
} = require('../../server/services/html-pages');

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    sendFilePath: null,
    sendFileCallback: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    sendFile(filePath, callback) {
      this.sendFilePath = filePath;
      this.sendFileCallback = callback;
      if (typeof callback === 'function') callback(null);
      return this;
    },
  };
}

function createFixture() {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-'));
  const knownFiles = new Set([
    'premium-website.html',
    'premium-websites.html',
    'website-laten-maken-oisterwijk.html',
    'premium-bedrijfssoftware.html',
    'premium-chatbot.html',
    'premium-voicesoftware.html',
    'premium-personeel-login.html',
    'premium-personeel-agenda.html',
    'live-momentum.html',
  ]);
  const loggerCalls = [];
  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    logger: {
      error: (...args) => loggerCalls.push(args),
    },
    sanitizeKnownHtmlFileName: (value) => {
      const fileName = String(value || '').trim();
      return knownFiles.has(fileName) ? fileName : '';
    },
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map([
      ['premium-personeel-login', 'premium-personeel-login.html'],
      ['premium-personeel-agenda', 'premium-personeel-agenda.html'],
      ['live-momentum', 'live-momentum.html'],
    ]),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: false,
      authState: null,
    }),
    getSeoConfigCached: async () => ({
      pages: {
        'premium-website.html': {
          title: 'Softora | SEO Test',
        },
      },
    }),
    applySeoOverridesToHtml: (fileName, html, config) => {
      if (fileName === 'premium-website.html' && config.pages[fileName]?.title) {
        return String(html || '').replace(/<title>.*?<\/title>/i, `<title>${config.pages[fileName].title}</title>`);
      }
      return String(html || '');
    },
    getPageBootstrapData: async (_req, fileName) => {
      if (fileName !== 'premium-personeel-agenda.html') return null;
      return {
        marker: 'SOFTORA_AGENDA_BOOTSTRAP',
        scriptId: 'softoraAgendaBootstrap',
        htmlReplacements: {
          SOFTORA_AGENDA_STATUS: '<div class="status">Klaar</div>',
        },
        data: {
          appointments: [{ id: 11, company: 'Softora', date: '2026-04-08', time: '14:00' }],
        },
      };
    },
  });

  return {
    coordinator,
    loggerCalls,
    pagesDir,
  };
}

test('html page coordinator resolves known html files from direct names and slugs', () => {
  const { coordinator } = createFixture();

  assert.equal(
    coordinator.resolveSeoPageFileFromRequest('premium-personeel-login.html', ''),
    'premium-personeel-login.html'
  );
  assert.equal(
    coordinator.resolveSeoPageFileFromRequest('', 'premium-personeel-agenda'),
    'premium-personeel-agenda.html'
  );
  assert.equal(coordinator.resolveSeoPageFileFromRequest('', '../etc/passwd'), '');
});

test('html page coordinator strips internal coldmailing navigation before rendering', () => {
  const source = [
    '<aside class="sidebar">',
    '<a href="/premium-bevestigingsmails" class="sidebar-link" data-sidebar-key="coldmailing"><span>Coldmailing</span></a>',
    '<a href="/premium-database" class="sidebar-link" data-sidebar-key="database"><span>Database</span></a>',
    '</aside>',
  ].join('');

  const rendered = removeInternalPremiumSidebarLinks(source);

  assert.doesNotMatch(rendered, /data-sidebar-key="coldmailing"/);
  assert.doesNotMatch(rendered, />Coldmailing</);
  assert.match(rendered, /data-sidebar-key="database"/);
});

test('html page coordinator reads known html files and returns empty content for missing files', async () => {
  const { coordinator, pagesDir } = createFixture();
  const pagePath = path.join(pagesDir, 'premium-website.html');
  fs.writeFileSync(pagePath, '<!DOCTYPE html><html><head><title>Orig</title></head><body></body></html>');

  const html = await coordinator.readHtmlPageContent('premium-website.html');
  const missing = await coordinator.readHtmlPageContent('premium-personeel-login.html');

  assert.match(html, /<!DOCTYPE html>/i);
  assert.equal(missing, '');
});

test('html page coordinator renders SEO-managed html and respects handled premium access', async () => {
  const handledCoordinator = createHtmlPageCoordinator({
    pagesDir: process.cwd(),
    sanitizeKnownHtmlFileName: (value) => String(value || '').trim(),
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: true,
      isLoginPage: true,
      isProtectedPremiumPage: false,
    }),
    getSeoConfigCached: async () => ({}),
    applySeoOverridesToHtml: (fileName, html) => `${fileName}:${html}`,
  });
  const handledReq = { originalUrl: '/premium-personeel-login' };
  const handledRes = createResponseRecorder();
  let handledNextCalled = false;

  await handledCoordinator.sendSeoManagedHtmlPageResponse(
    handledReq,
    handledRes,
    () => {
      handledNextCalled = true;
    },
    'premium-personeel-login.html'
  );

  assert.equal(handledRes.body, null);
  assert.equal(handledNextCalled, false);

  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'premium-website.html'),
    '<!DOCTYPE html><html><head><title>Orig</title></head><body>Hello</body></html>'
  );

  const req = { originalUrl: '/premium-website' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {
    nextCalled = true;
  }, 'premium-website.html');

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'public, max-age=300, stale-while-revalidate=900');
  assert.match(res.body, /Softora \| SEO Test/);
  assert.match(
    res.body,
    /<link rel="preload" as="image" href="\/assets\/home-hero-generated-v2\.jpg\?v=20260511a">/
  );
  assert.match(res.body, /href="\/assets\/fonts\.css\?v=20260409a"/);
  assert.match(res.body, /href="\/assets\/fonts\/inter-latin\.woff2\?v=20260409a"/);
  assert.doesNotMatch(res.body, /fonts\.googleapis\.com/);
  assert.doesNotMatch(res.body, /fonts\.gstatic\.com/);
});

test('html page coordinator preloads public legacy service hero background images', async () => {
  const { coordinator, pagesDir } = createFixture();
  const pages = [
    {
      fileName: 'premium-websites.html',
      preload: '<link rel="preload" as="image" href="/assets/seo-content/website-leads-analytics-softora.jpg">',
    },
    {
      fileName: 'website-laten-maken-oisterwijk.html',
      preload: '<link rel="preload" as="image" href="/assets/seo-content/website-leads-analytics-softora.jpg">',
    },
    {
      fileName: 'premium-bedrijfssoftware.html',
      preload: '<link rel="preload" as="image" href="/assets/softora-crm-workflow.jpg">',
    },
    {
      fileName: 'premium-chatbot.html',
      preload:
        '<link rel="preload" as="image" href="/assets/seo-content/ai-klantcontact-chatbot-telefonie-softora.jpg">',
    },
    {
      fileName: 'premium-voicesoftware.html',
      preload: '<link rel="preload" as="image" href="/assets/softora-telefonie-studio.jpg">',
    },
  ];

  for (const page of pages) {
    fs.writeFileSync(
      path.join(pagesDir, page.fileName),
      '<!DOCTYPE html><html><head><title>Service</title></head><body>Service</body></html>'
    );

    const res = createResponseRecorder();
    await coordinator.sendSeoManagedHtmlPageResponse({ originalUrl: '/' }, res, () => {}, page.fileName);

    assert.match(res.body, new RegExp(page.preload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal((res.body.match(/rel="preload" as="image"/g) || []).length, 1);
  }
});

test('html page coordinator injects critical premium sidebar shell before theme stylesheet', async () => {
  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    [
      '<!DOCTYPE html><html><head>',
      '<title>Agenda</title>',
      '<link rel="stylesheet" href="assets/personnel-theme.css?v=20260519b">',
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Oswald:wght@400;500;600;700&display=swap" rel="stylesheet">',
      '</head><body>',
      '<aside class="sidebar" data-static-sidebar="1"><a class="sidebar-logo">SOFTORA.NL</a><nav class="sidebar-nav"><a class="sidebar-link"><span class="sidebar-link-text">Dashboard</span></a></nav></aside>',
      '<main class="main-content">Agenda</main>',
      '</body></html>',
    ].join('')
  );

  const req = { originalUrl: '/premium-personeel-agenda' };
  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {}, 'premium-personeel-agenda.html');

  assert.equal(res.statusCode, 200);
  const criticalIndex = res.body.indexOf('id="softora-premium-sidebar-critical"');
  const themeIndex = res.body.indexOf('assets/personnel-theme.css');
  const stabilityIndex = res.body.indexOf('/assets/premium-sidebar-stability.css');
  const interPreloadIndex = res.body.indexOf('/assets/fonts/inter-latin.woff2?v=20260409a');
  assert.ok(criticalIndex > -1, 'premium sidebar critical css hoort geinjecteerd te worden');
  assert.ok(themeIndex > -1, 'personnel theme stylesheet hoort te blijven bestaan');
  assert.ok(stabilityIndex > -1, 'premium sidebar stability stylesheet hoort geinjecteerd te worden');
  assert.ok(criticalIndex < themeIndex, 'kritieke sidebar css hoort voor de gewone theme css te staan');
  assert.ok(themeIndex < stabilityIndex, 'stability stylesheet hoort na pagina-CSS te laden zodat sidebar-polish wint');
  assert.ok(interPreloadIndex < themeIndex, 'lokale sidebar fonts horen voor de theme css te preloaden');
  assert.match(res.body, /softora-personnel-first-paint/);
  assert.match(res.body, /data-personnel-loading/);
  assert.match(res.body, /\/assets\/premium-sidebar-stability\.css\?v=20260715b/);
  assert.match(res.body, /\/assets\/premium-sidebar-stability\.js\?v=20260715b/);
  assert.match(res.body, /\/assets\/premium-sidebar-autopilot\.css\?v=20260611a/);
  assert.match(res.body, /\/assets\/premium-sidebar-autopilot\.js\?v=20260611a/);
  assert.match(res.body, /\/assets\/premium-dashboard-ai-chat-scope\.js\?v=20260611a/);
  assert.match(res.body, /@view-transition\{navigation:auto;\}/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\]\{width:var\(--premium-sidebar-width,320px\) !important;display:flex !important;/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-nav\{[\s\S]*scrollbar-width:none !important;[\s\S]*scrollbar-gutter:auto !important;/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link:focus,[\s\S]*\.sidebar\[data-static-sidebar="1"\] \.sidebar-link:focus-visible\{outline:none !important;box-shadow:none !important;/);
  assert.match(res.body, /view-transition-name:softora-premium-sidebar !important;/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-logo\{[\s\S]*font-size:25px !important;/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\{[\s\S]*min-height:0 !important;[\s\S]*font-size:14px !important;/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\.active\{color:#1a1a2e !important;background:rgba\(139,34,82,\.06\) !important;/);
  assert.match(res.body, /\.sidebar\[data-static-sidebar="1"\]\{position:fixed !important;/);
  assert.doesNotMatch(res.body, /font-size:2rem !important/);
  assert.doesNotMatch(res.body, /min-height:2\.35rem !important/);
  assert.doesNotMatch(res.body, /fonts\.googleapis\.com\/css2\?family=Inter/);
});

test('html page coordinator disables cross-document view transitions on Live Momentum', async () => {
  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'live-momentum.html'),
    [
      '<!DOCTYPE html><html><head>',
      '<title>Live Momentum</title>',
      '<link rel="stylesheet" href="assets/personnel-theme.css?v=20260519b">',
      '</head><body>',
      '<aside class="sidebar" data-static-sidebar="1"><nav class="sidebar-nav"></nav></aside>',
      '<main class="main-content">Momentum</main>',
      '</body></html>',
    ].join('')
  );

  const res = createResponseRecorder();
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'autoplay=(self), camera=()');
  await coordinator.sendSeoManagedHtmlPageResponse(
    { originalUrl: '/live-momentum' },
    res,
    () => {},
    'live-momentum.html'
  );

  assert.equal(res.statusCode, 200);
  const stabilityIndex = res.body.indexOf('/assets/premium-sidebar-stability.css');
  const optoutIndex = res.body.indexOf('id="softora-live-momentum-view-transition-optout"');
  assert.ok(stabilityIndex > -1, 'Live Momentum hoort de sidebar-stability assets te behouden');
  assert.ok(optoutIndex > stabilityIndex, 'de route-optout hoort na de gedeelde stability CSS te staan');
  assert.match(res.body, /@view-transition\{navigation:none;\}/);
  assert.match(
    res.headers['Content-Security-Policy'],
    /default-src 'self'; frame-ancestors 'none'; frame-src 'self' https:\/\/www\.youtube-nocookie\.com/
  );
  assert.match(
    res.headers['Permissions-Policy'],
    /autoplay=\(self "https:\/\/www\.youtube-nocookie\.com"\), camera=\(\)/
  );
  assert.doesNotMatch(res.headers['Content-Security-Policy'], /https:\/\/www\.youtube\.com/);
});

test('html page coordinator renders premium content-frame pages without an active sidebar shell', async () => {
  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    [
      '<!DOCTYPE html><html><head>',
      '<title>Agenda</title>',
      '<link rel="stylesheet" href="assets/personnel-theme.css?v=20260519b">',
      '</head><body>',
      '<div class="dashboard-layout">',
      '<aside class="sidebar" data-static-sidebar="1"><nav class="sidebar-nav"></nav></aside>',
      '<main class="main-content">Agenda</main>',
      '</div>',
      '</body></html>',
    ].join('')
  );

  const req = {
    originalUrl: '/premium-personeel-agenda?softora_sidebar_content=1',
    query: { softora_sidebar_content: '1' },
  };
  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {}, 'premium-personeel-agenda.html');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /data-softora-sidebar-content-frame="1"/);
  assert.match(res.body, /id="softora-premium-sidebar-content-frame"/);
  assert.match(res.body, /html\[data-softora-sidebar-content-frame="1"\]\{--premium-sidebar-width:0px !important;\}/);
  assert.match(res.body, /html\[data-softora-sidebar-content-frame="1"\] \.sidebar\{display:none !important;\}/);
  assert.match(res.body, /html\[data-softora-sidebar-content-frame="1"\] \.dashboard-layout\[data-sidebar-shell="canonical"\] > \.main-content/);
  assert.match(res.body, /html\[data-softora-sidebar-content-frame="1"\] \.premium-boot-loader,\s*html\[data-softora-sidebar-content-frame="1"\] \.monthly-costs-boot-loader\{left:0 !important;\}/);
  assert.doesNotMatch(res.body, /\/assets\/premium-sidebar-stability\.js\?v=/);
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.match(res.headers['Content-Security-Policy'], /frame-ancestors 'self'/);
  assert.match(res.headers['Content-Security-Policy'], /default-src 'self'/);
});

test('html page coordinator serves login pages without seo config or bootstrap reads', async () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-fallback-'));
  const pagePath = path.join(pagesDir, 'premium-personeel-login.html');
  fs.writeFileSync(pagePath, '<!DOCTYPE html><html><head><title>Login</title></head><body>Inloggen</body></html>');
  let seoConfigCalls = 0;
  let seoOverrideCalls = 0;
  let bootstrapCalls = 0;

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    logger: {
      error: () => {},
    },
    sanitizeKnownHtmlFileName: (value) => {
      const fileName = String(value || '').trim();
      return fileName === 'premium-personeel-login.html' ? fileName : '';
    },
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: true,
      isProtectedPremiumPage: false,
    }),
    getSeoConfigCached: async () => {
      seoConfigCalls += 1;
      throw new Error('boom');
    },
    applySeoOverridesToHtml: (fileName, html) => {
      seoOverrideCalls += 1;
      return `${fileName}:${html}`;
    },
    getPageBootstrapData: async () => {
      bootstrapCalls += 1;
      throw new Error('login bootstrap should stay cold');
    },
  });

  const req = { originalUrl: '/premium-personeel-login' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {
    nextCalled = true;
  }, 'premium-personeel-login.html');

  assert.equal(nextCalled, false);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.sendFilePath, null);
  assert.equal(seoConfigCalls, 0);
  assert.equal(seoOverrideCalls, 0);
  assert.equal(bootstrapCalls, 0);
  assert.match(res.body, /Inloggen/);
});

test('html page coordinator caps dashboard bootstrap reads without late error logs', async () => {
  const coordinatorSource = fs.readFileSync(path.join(__dirname, '../../server/services/html-pages.js'), 'utf8');
  assert.match(coordinatorSource, /dashboardPageBootstrapWaitMs = 1500/);
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-protected-timeout-'));
  const loggerInfos = [];
  const loggerErrors = [];
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-dashboard.html'),
    [
      '<!DOCTYPE html><html><head><title>Dashboard</title></head><body><main>Dashboard</main>',
      '<div id="kpiRevenueYear"><!-- SOFTORA_DASHBOARD_TOTAL_REVENUE --></div>',
      '<div id="kpiRecurringRevenue"><!-- SOFTORA_DASHBOARD_RECURRING_REVENUE --></div>',
      '<div id="kpiTotalClients"><!-- SOFTORA_DASHBOARD_TOTAL_CLIENTS --></div>',
      '<div id="revenueChart"><!-- SOFTORA_DASHBOARD_REVENUE_CHART --></div>',
      '<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->',
      '</body></html>',
    ].join('')
  );

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    protectedPageBootstrapWaitMs: 2000,
    dashboardPageBootstrapWaitMs: 250,
    logger: {
      info: (...args) => loggerInfos.push(args),
      error: (...args) => loggerErrors.push(args),
    },
    sanitizeKnownHtmlFileName: (value) =>
      String(value || '').trim() === 'premium-personeel-dashboard.html'
        ? 'premium-personeel-dashboard.html'
        : '',
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: true,
      authState: { authenticated: true, email: 'serve@softora.nl', role: 'admin' },
    }),
    getSeoConfigCached: async () => {
      throw new Error('protected pages should not read seo config');
    },
    applySeoOverridesToHtml: (_fileName, html) => html,
    getPageBootstrapData: async () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('late bootstrap failure')), 300);
      }),
  });

  const res = createResponseRecorder();
  const startedAt = Date.now();

  await coordinator.sendSeoManagedHtmlPageResponse(
    { originalUrl: '/premium-personeel-dashboard' },
    res,
    () => {},
    'premium-personeel-dashboard.html'
  );
  const elapsedMs = Date.now() - startedAt;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assert.equal(res.statusCode, 200);
  assert.ok(elapsedMs < 700, `dashboard bootstrap duurde ${elapsedMs}ms`);
  assert.match(res.body, /Dashboard/);
  assert.match(res.body, /id="kpiRevenueYear">--<\/div>/);
  assert.match(res.body, /id="kpiRecurringRevenue">--<\/div>/);
  assert.match(res.body, /id="kpiTotalClients">--<script>/);
  assert.match(res.body, /Actieve opdrachten tijdelijk niet geladen/);
  assert.match(res.body, /id="softoraCustomersBootstrap" type="application\/json">/);
  assert.match(res.body, /"source":"unavailable"/);
  assert.match(res.body, /<span class="chart-label">Jan<\/span>/);
  assert.doesNotMatch(res.body, /SOFTORA_DASHBOARD_TOTAL_REVENUE/);
  assert.equal(
    loggerInfos.some(
      (args) => args[0] === '[HTML][BootstrapTimeout]' && args[1] === 'premium-personeel-dashboard.html'
    ),
    true
  );
  assert.equal(
    loggerErrors.some((args) => /\[HTML\]\[(SeoConfig|Bootstrap)Error\]/.test(String(args[0] || ''))),
    false
  );
});

test('html page coordinator gives protected premium bootstrap enough time for Supabase-backed data', async () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-protected-bootstrap-'));
  const loggerInfos = [];
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-dashboard.html'),
    [
      '<!DOCTYPE html><html><head><title>Dashboard</title></head><body>',
      '<div id="kpiRevenueYear"><!-- SOFTORA_DASHBOARD_TOTAL_REVENUE --></div>',
      '<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->',
      '</body></html>',
    ].join('')
  );

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    logger: {
      info: (...args) => loggerInfos.push(args),
      error: () => {},
    },
    sanitizeKnownHtmlFileName: (value) =>
      String(value || '').trim() === 'premium-personeel-dashboard.html'
        ? 'premium-personeel-dashboard.html'
        : '',
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: true,
      authState: { authenticated: true, email: 'serve@softora.nl', role: 'admin' },
    }),
    getSeoConfigCached: async () => {
      throw new Error('protected pages should not read seo config');
    },
    applySeoOverridesToHtml: (_fileName, html) => html,
    getPageBootstrapData: async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({
          marker: 'SOFTORA_CUSTOMERS_BOOTSTRAP',
          scriptId: 'softoraCustomersBootstrap',
          htmlReplacements: {
            SOFTORA_DASHBOARD_TOTAL_REVENUE: '€1.234',
          },
          data: { ok: true, customers: [{ id: 'cust-1' }] },
        }), 650);
      }),
  });

  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(
    { originalUrl: '/premium-personeel-dashboard' },
    res,
    () => {},
    'premium-personeel-dashboard.html'
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /€1\.234/);
  assert.match(res.body, /id="softoraCustomersBootstrap"/);
  assert.equal(
    loggerInfos.some(
      (args) => args[0] === '[HTML][BootstrapTimeout]' && args[1] === 'premium-personeel-dashboard.html'
    ),
    false
  );
});

test('html page coordinator serves public pages when seo config and bootstrap reads time out', async () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-timeout-'));
  const loggerInfos = [];
  const loggerErrors = [];
  const seoConfigCalls = [];
  fs.writeFileSync(
    path.join(pagesDir, 'premium-website.html'),
    '<!DOCTYPE html><html><head><title>Orig</title></head><body><main>Publieke pagina</main></body></html>'
  );

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    logger: {
      info: (...args) => loggerInfos.push(args),
      error: (...args) => loggerErrors.push(args),
    },
    sanitizeKnownHtmlFileName: (value) =>
      String(value || '').trim() === 'premium-website.html' ? 'premium-website.html' : '',
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    publicPageDependencyWaitMs: 5,
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: false,
      authState: null,
    }),
    getSeoConfigCached: async (...args) => {
      seoConfigCalls.push(args);
      return new Promise(() => {});
    },
    applySeoOverridesToHtml: (_fileName, html, config) => {
      assert.deepEqual(config, {});
      return html;
    },
    getPageBootstrapData: async () => new Promise(() => {}),
  });

  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(
    { originalUrl: '/premium-website' },
    res,
    () => {},
    'premium-website.html'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'public, max-age=300, stale-while-revalidate=900');
  assert.match(res.body, /Publieke pagina/);
  assert.deepEqual(seoConfigCalls, [[false, {
    suppressReadFailureCooldown: true,
    suppressReadFailureLog: true,
  }]]);
  assert.equal(
    loggerInfos.some(
      (args) => args[0] === '[HTML][SeoConfigTimeout]' && args[1] === 'premium-website.html'
    ),
    false
  );
  assert.equal(
    loggerInfos.some(
      (args) => args[0] === '[HTML][BootstrapTimeout]' && args[1] === 'premium-website.html'
    ),
    true
  );
  assert.equal(
    loggerErrors.some((args) => /\[HTML\]\[(SeoConfig|Bootstrap)Timeout\]/.test(String(args[0] || ''))),
    false
  );
});

test('html page coordinator injects bootstrap json into html markers for dynamic pages', async () => {
  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    '<!DOCTYPE html><html><body><!-- SOFTORA_AGENDA_STATUS --><!-- SOFTORA_AGENDA_BOOTSTRAP --><main>Agenda</main></body></html>'
  );

  const req = { originalUrl: '/premium-personeel-agenda' };
  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {}, 'premium-personeel-agenda.html');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<div class="status">Klaar<\/div>/);
  assert.match(res.body, /id="softoraAgendaBootstrap"/);
  assert.match(res.body, /"appointments":\[\{"id":11,"company":"Softora"/);
});

test('html page coordinator inlines the premium sidebar profile prefill script', async () => {
  const { coordinator, pagesDir } = createFixture();
  fs.mkdirSync(path.join(pagesDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, 'assets', 'premium-sidebar-profile-prefill.js'),
    'window.__prefillLoaded = true;'
  );
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    '<!DOCTYPE html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap" rel="stylesheet"></head><body><aside>Sidebar</aside><script src="assets/premium-sidebar-profile-prefill.js?v=20260417e"></script></body></html>'
  );

  const req = { originalUrl: '/premium-personeel-agenda' };
  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {}, 'premium-personeel-agenda.html');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /window\.__prefillLoaded = true;/);
  assert.doesNotMatch(res.body, /premium-sidebar-profile-prefill\.js\?v=/);
});

test('html page coordinator injects premium session watchdog on authenticated premium pages', async () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-watchdog-'));
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    '<!DOCTYPE html><html><head></head><body><aside class="sidebar" data-static-sidebar="1"></aside></body></html>'
  );

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    sanitizeKnownHtmlFileName: (value) =>
      String(value || '').trim() === 'premium-personeel-agenda.html' ? 'premium-personeel-agenda.html' : '',
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: true,
      authState: { authenticated: true, email: 'serve@softora.nl', role: 'admin' },
    }),
    getSeoConfigCached: async () => ({}),
    applySeoOverridesToHtml: (_fileName, html) => html,
  });
  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(
    { originalUrl: '/premium-personeel-agenda' },
    res,
    () => {},
    'premium-personeel-agenda.html'
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /assets\/premium-session-watchdog\.js\?v=20260516a/);
  assert.match(res.body, /<script src="\/assets\/premium-session-watchdog\.js\?v=20260516a" defer><\/script>\s*<\/head>/);
});

test('html page coordinator injects authenticated premium sidebar profile html before first paint', async () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-profile-'));
  fs.mkdirSync(path.join(pagesDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(pagesDir, 'assets', 'premium-sidebar-profile-prefill.js'), 'window.__prefillLoaded = true;');
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    '<!DOCTYPE html><html><body><aside class="sidebar" data-sidebar-ready="true" data-static-sidebar="1"><div class="sidebar-user"><div class="sidebar-user-trigger" role="group" aria-label="Gebruikersinfo"><div class="sidebar-avatar" data-sidebar-avatar>SP</div><div class="sidebar-user-info"><div class="sidebar-user-name" data-sidebar-user-name>Softora Premium</div><div class="sidebar-user-role" data-sidebar-user-role>Full Acces</div></div></div></div></aside><script src="assets/premium-sidebar-profile-prefill.js?v=20260417e"></script></body></html>'
  );

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    sanitizeKnownHtmlFileName: (value) =>
      String(value || '').trim() === 'premium-personeel-agenda.html' ? 'premium-personeel-agenda.html' : '',
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: true,
      authState: {
        authenticated: true,
        displayName: 'Servé Creusen',
        role: 'admin',
        email: 'serve@softora.nl',
        avatarDataUrl: '',
      },
    }),
    getSeoConfigCached: async () => ({}),
    applySeoOverridesToHtml: (_fileName, html) => html,
  });

  const res = createResponseRecorder();
  await coordinator.sendSeoManagedHtmlPageResponse(
    { originalUrl: '/premium-personeel-agenda' },
    res,
    () => {},
    'premium-personeel-agenda.html'
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /data-sidebar-profile-render-key=/);
  assert.match(res.body, /Ingelogd als Servé Creusen/);
  assert.match(res.body, /data-sidebar-user-name>Servé Creusen</);
  assert.match(res.body, /data-sidebar-avatar>SC</);
});

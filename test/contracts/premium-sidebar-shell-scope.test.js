const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function extractSidebarSections(source) {
  const asideMatch = source.match(/<aside class="sidebar"[^>]*data-static-sidebar="1"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(asideMatch, 'pagina hoort een statische premium-sidebar te hebben');
  return asideMatch[1]
    .split(/<div class="sidebar-section(?:\s[^"]*)?">/)
    .slice(1)
    .map((sectionSource) => {
      const label = (sectionSource.match(/<div class="sidebar-section-label">([^<]+)<\/div>/) || [])[1];
      const links = Array.from(
        sectionSource.matchAll(/data-sidebar-key="([^"]+)"[\s\S]*?<span class="sidebar-link-text">([^<]+)<\/span>/g),
        (match) => `${match[1]}:${match[2]}`
      );
      return { label, links };
    })
    .filter((section) => section.label);
}

function extractSidebarLinkTargets(source) {
  const asideMatch = source.match(/<aside class="sidebar"[^>]*data-static-sidebar="1"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(asideMatch, 'pagina hoort een statische premium-sidebar te hebben');
  return Object.fromEntries(
    Array.from(
      asideMatch[1].matchAll(/href="([^"]+)" class="[^"]*\bsidebar-link\b[^"]*" data-sidebar-key="([^"]+)"/g),
      (match) => [match[2], match[1]]
    )
  );
}

const canonicalPages = [
  'premium-actieve-opdrachten.html',
  'premium-ai-coldmailing.html',
  'premium-ai-lead-generator.html',
  'premium-bevestigingsmails.html',
  'premium-boekhouding.html',
  'premium-instellingen.html',
  'premium-kladblok.html',
  'premium-word.html',
  'premium-pakketten.html',
  'premium-pdfs.html',
  'premium-personeel-agenda.html',
  'premium-personeel-dashboard.html',
  'premium-seo-crm-system.html',
  'premium-seo.html',
  'premium-wachtwoordenregister.html',
];

const customLayoutPages = [
  'premium-analytics.html',
  'premium-database.html',
  'premium-instellingen-personeel.html',
  'premium-klanten.html',
  'premium-mailbox.html',
  'premium-vaste-lasten.html',
  'premium-opdracht-dossier.html',
  'premium-websitegenerator.html',
  'premium-websitepreview.html',
];

const staticSidebarPages = [
  ...canonicalPages,
  ...customLayoutPages,
  'premium-advertenties.html',
  'premium-socialmedia.html',
];

test('personnel theme canonical shell is explicitly opt-in', () => {
  const themeSource = readRepoFile('assets/personnel-theme.css');
  const themeJsSource = readRepoFile('assets/personnel-theme.js');
  const stabilitySource = readRepoFile('assets/premium-sidebar-stability.css');
  const stabilityJsSource = readRepoFile('assets/premium-sidebar-stability.js');
  const prefillSource = readRepoFile('assets/premium-sidebar-profile-prefill.js');
  const htmlPagesSource = readRepoFile('server/services/html-pages.js');

  assert.match(
    themeSource,
    /\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.main-content/
  );
  assert.doesNotMatch(
    themeSource,
    /\.dashboard-layout > \.main-content,\s*\.dashboard-layout > main\.main-content/s
  );
  assert.match(themeJsSource, /function neutralizeSidebarAnchors\(\) \{/);
  assert.match(themeJsSource, /anchor\.removeAttribute\("href"\);/);
  assert.match(themeJsSource, /openSidebarNavigationTarget\(anchor\.dataset\.sidebarHref, event\);/);
  assert.match(themeJsSource, /document\.body\.setAttribute\("data-sidebar-nav-ready", "1"\);/);
  assert.match(themeSource, /\.sidebar a\.sidebar-logo,[\s\S]*pointer-events:\s*none;/);
  assert.match(themeSource, /body\[data-sidebar-nav-ready="1"\] \.sidebar a\.sidebar-logo,[\s\S]*pointer-events:\s*auto;/);
  assert.match(themeSource, /\.sidebar a\.sidebar-logo,[\s\S]*transform:\s*none !important;/);
  assert.match(themeSource, /font-family:\s*'SoftoraSidebarOswald';[\s\S]*font-display:\s*block;[\s\S]*oswald-latin\.woff2\?v=20260409a/);
  assert.match(themeSource, /font-family:\s*'SoftoraSidebarInter';[\s\S]*font-display:\s*block;[\s\S]*inter-latin\.woff2\?v=20260409a/);
  assert.match(themeSource, /@view-transition\s*\{[\s\S]*navigation:\s*auto;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*view-transition-name:\s*softora-premium-sidebar;/);
  assert.match(themeSource, /::view-transition-old\(softora-premium-sidebar\),[\s\S]*::view-transition-new\(softora-premium-sidebar\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(stabilitySource, /::view-transition-old\(root\),[\s\S]*::view-transition-new\(root\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(themeSource, /--premium-sidebar-font-display:\s*'SoftoraSidebarOswald', 'Oswald', sans-serif;/);
  assert.match(themeSource, /\.sidebar-logo\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-display\) !important;[\s\S]*font-synthesis:\s*none !important;/);
  assert.match(themeSource, /\.sidebar-link \.sidebar-link-text\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans\) !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.2 !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-logo\s*\{[\s\S]*margin:\s*0 0 11px !important;[\s\S]*font-size:\s*25px !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*min-height:\s*0 !important;[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.12 !important;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*transition:\s*none !important;[\s\S]*transform:\s*none !important;/);
  assert.match(stabilitySource, /html\[data-premium-sidebar-route-changing="true"\] \.sidebar\[data-static-sidebar="1"\],[\s\S]*body\[data-premium-sidebar-route-changing="true"\] \.sidebar\[data-static-sidebar="1"\]/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-flow-section::before\s*\{[\s\S]*top:\s*59px !important;/);
  assert.match(themeSource, /\.sidebar\s*\{[\s\S]*transform:\s*none !important;[\s\S]*overflow-anchor:\s*none !important;[\s\S]*overscroll-behavior:\s*contain !important;/);
  assert.match(themeSource, /\.sidebar-nav\s*\{[\s\S]*overflow-anchor:\s*none !important;[\s\S]*scrollbar-gutter:\s*stable !important;/);
  assert.match(themeSource, /\.sidebar,\s*\.sidebar \*,\s*\.sidebar \*::before,\s*\.sidebar \*::after\s*\{[\s\S]*transition:\s*none !important;/);
  assert.match(themeSource, /\.sidebar\s*\{[\s\S]*contain:\s*layout paint style !important;/);
  assert.match(themeJsSource, /function resetPremiumSidebarMotionState\(sidebar, options\) \{/);
  assert.match(themeJsSource, /const warmedSidebarNavigationTargets = new Set\(\);/);
  assert.match(themeJsSource, /function warmSidebarNavigationTarget\(url\) \{/);
  assert.match(themeJsSource, /link\.rel = "prefetch";/);
  assert.match(themeJsSource, /link\.setAttribute\("data-sidebar-prefetch", "1"\);/);
  assert.match(themeJsSource, /function warmVisibleSidebarNavigationTargets\(\) \{/);
  assert.match(stabilityJsSource, /NAV_STATE_KEY = "softora_premium_sidebar_nav_state_v1"/);
  assert.match(stabilityJsSource, /function persistSidebarNavState\(sidebar, targetHref\) \{/);
  assert.match(stabilityJsSource, /function isCurrentTarget\(href\) \{/);
  assert.match(stabilityJsSource, /event\.stopImmediatePropagation\(\);/);
  assert.match(stabilityJsSource, /document\.documentElement\.setAttribute\("data-premium-sidebar-route-changing", "true"\);/);
  assert.match(stabilityJsSource, /document\.addEventListener\("click", handleSidebarNavigationStart, true\);/);
  assert.match(themeJsSource, /function initPremiumSidebarStabilityGuards\(\) \{/);
  assert.match(themeJsSource, /document\.addEventListener\("pointerdown", function \(event\) \{/);
  assert.match(themeJsSource, /window\.addEventListener\("focus", function \(\) \{\s*schedulePremiumSidebarStability\(\);/s);
  assert.match(themeJsSource, /const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set\(\["passwords"\]\);/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeJsSource, /premiumInitialSessionFetched/);
  assert.match(themeJsSource, /premiumSessionSnapshotFromStorage/);
  assert.match(themeJsSource, /function stabilizePremiumStaticSidebar\(sidebar, activeKey\) \{/);
  assert.doesNotMatch(themeJsSource, /sidebar\.dataset\.staticSidebar === "1"\) \{\s*sidebar\.innerHTML/);
  assert.doesNotMatch(themeJsSource, /getWebsiteGeneratorLibrarySidebarLink/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Bibliotheek"/);
  assert.match(
    themeJsSource,
    /window\.SoftoraPersonnelTheme\.refreshPremiumStaticSidebarActiveState\s*=\s*refreshPremiumStaticSidebarActiveState/
  );
  assert.match(themeJsSource, /persistPremiumSidebarSessionSnapshot/);
  assert.match(themeJsSource, /window\.SoftoraPremiumSidebarProfileSession/);
  assert.match(themeJsSource, /profileSessionHelper\.enrichSession\(payload, fetchJsonNoStore\)/);
  assert.match(themeJsSource, /buildSidebarProfileRenderKey/);
  assert.match(themeJsSource, /sidebar\.dataset\.sidebarProfileRenderKey === renderKey/);
  assert.match(themeJsSource, /document\.querySelector\("\[data-sidebar-profile-trigger\]"\) \|\| document\.querySelector\("\.sidebar-user \.sidebar-user-trigger"\);/);
  assert.match(themeJsSource, /if \(!document\.querySelector\("\[data-sidebar-user-name\]"\)\) \{[\s\S]*markPremiumSidebarProfileResolved\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(themeJsSource, /loadPremiumSession\(\);/);
  assert.match(themeSource, /\.sidebar-link \.sidebar-link-text[\s\S]*white-space:\s*nowrap !important;/);
  assert.match(
    themeSource,
    /@media \(min-width: 901px\) \{[\s\S]*?\.sidebar-nav \{[\s\S]*?overflow-y:\s*auto !important;/m
  );
  assert.match(themeJsSource, /function schedulePremiumSidebarFit\(sidebar\) \{/);
  assert.match(themeSource, /\.sidebar-user-name[\s\S]*text-overflow:\s*ellipsis !important;/);
  assert.match(prefillSource, /data-sidebar-profile-render-key/);
  assert.match(prefillSource, /getAttribute\("data-sidebar-profile-render-key"\)/);
  assert.match(prefillSource, /function prefillPremiumSidebarActiveState\(\) \{/);
  assert.match(prefillSource, /link\.classList\.toggle\("active", key === activeKey\);/);
  assert.match(prefillSource, /NAV_STATE_KEY = "softora_premium_sidebar_nav_state_v1"/);
  assert.match(prefillSource, /function readCookieValue\(name\) \{/);
  assert.match(prefillSource, /function prefillPremiumSidebarScrollState\(\) \{/);
  assert.match(prefillSource, /nav\.scrollTop = Math\.max\(0, scrollTop\);/);
  assert.match(prefillSource, /avatarEl\.replaceChildren\(\);/);
  assert.doesNotMatch(prefillSource, /avatarEl\.innerHTML\s*=/);
  assert.match(prefillSource, /function mergeSessions\(primarySession, fallbackSession\) \{/);
  assert.match(prefillSource, /function shouldEnrichSession\(sessionLike\) \{/);
  assert.match(prefillSource, /function enrichSession\(sessionLike, fetchJsonNoStore\) \{/);
  assert.match(prefillSource, /window\.SoftoraPremiumSidebarProfileSession = \{/);
  assert.match(prefillSource, /data-sidebar-active-prefilled/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_CRITICAL_HEAD_SNIPPET/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_STABILITY_ASSETS/);
  assert.match(htmlPagesSource, /premium-sidebar-stability\.css\?v=/);
  assert.match(htmlPagesSource, /premium-sidebar-stability\.js\?v=/);
  assert.match(htmlPagesSource, /id="softora-premium-sidebar-critical"/);
  assert.match(htmlPagesSource, /function injectSnippetAfterHeadOpen\(html, snippet, marker\) \{/);
  assert.match(htmlPagesSource, /function hasPremiumStaticSidebar\(html\) \{/);
  assert.match(htmlPagesSource, /margin-left:var\(--premium-sidebar-width,320px\) !important;/);
  assert.doesNotMatch(
    themeJsSource,
    /if \(sidebar\.dataset\.staticSidebar === "1"\) \{[\s\S]*ensureStaticSidebarLink\(sidebar, "beheer", getWebsitePreviewSidebarLink\(\), \["seo", "packages", "pdfs"\]\);/s
  );
});

test('canonical premium pages opt into the shared sidebar shell', () => {
  for (const relativePath of canonicalPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /<div class="dashboard-layout" data-sidebar-shell="canonical">/,
      `${relativePath} hoort expliciet de canonical shell te activeren`
    );
  }
});

test('premium dashboard keeps its first-paint boot overlay in the shell contract', () => {
  const pageSource = readRepoFile('premium-personeel-dashboard.html');
  const coreSource = readRepoFile('assets/premium-dashboard-core.js');

  assert.match(pageSource, /setAttribute\("data-dashboard-boot-loading", "true"\)/);
  assert.match(pageSource, /html\[data-dashboard-boot-loading="true"\] body::before/);
  assert.doesNotMatch(pageSource, /html\[data-dashboard-boot-loading="true"\] body::after/);
  assert.match(pageSource, /id="dashboardHardBootLoader" data-dashboard-hard-boot-loader="true"/);
  assert.match(pageSource, /#dashboardHardBootLoader\{position:fixed;[\s\S]*z-index:20000/);
  assert.match(pageSource, /class="premium-boot-spinner dashboard-hard-boot-spinner"/);
  assert.match(pageSource, /softora-dossier-loader__orbit--outer/);
  assert.doesNotMatch(pageSource, /@keyframes softora-dashboard-boot-spin/);
  assert.match(pageSource, /data-dashboard-boot-loader="true"/);
  assert.match(pageSource, /releasePremiumDashboardBootShellAfterMinimum\(bootStartedAt, 1000\);/);
  assert.match(coreSource, /const PREMIUM_DASHBOARD_BOOT_MINIMUM_MS = 1000;/);
  assert.match(coreSource, /removeAttribute\('data-dashboard-boot-loading'\)/);
  assert.match(coreSource, /getElementById\('dashboardHardBootLoader'\)/);
  assert.match(coreSource, /function showPremiumDashboardBootShellForMinimum\(minimumMs = PREMIUM_DASHBOARD_BOOT_MINIMUM_MS\) \{/);
  assert.match(coreSource, /root\.addEventListener\('pageshow', function \(event\) \{/);
  assert.match(coreSource, /event\.persisted[\s\S]*showPremiumDashboardBootShellForMinimum\(PREMIUM_DASHBOARD_BOOT_MINIMUM_MS\);/);
  assert.match(coreSource, /root\.addEventListener\('error', releaseAfterMinimum\);/);
});

test('custom premium layouts stay outside the shared sidebar shell', () => {
  for (const relativePath of customLayoutPages) {
    const pageSource = readRepoFile(relativePath);
    assert.doesNotMatch(
      pageSource,
      /<div class="dashboard-layout" data-sidebar-shell="canonical">/,
      `${relativePath} hoort niet door de canonical shell overgenomen te worden`
    );
  }
});

test('premium mailbox behoudt eigen layout en vaste sidebar bij responsive mailweergave', () => {
  const pageSource = readRepoFile('premium-mailbox.html');

  assert.match(pageSource, /<aside class="sidebar"[^>]*data-static-sidebar="1"[^>]*>/);
  assert.match(pageSource, /data-sidebar-key="mailbox"[^>]*>[\s\S]*<span class="sidebar-link-text">Mailbox<\/span>/);
  assert.match(pageSource, /<main class="main-content is-premium-boot-host">[\s\S]*<div class="mail-page-shell">/);
  assert.match(pageSource, /\.main-content \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.mail-page-shell \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.topbar \{[\s\S]*overflow:\s*visible;[\s\S]*position:\s*relative;[\s\S]*z-index:\s*40;/);
  assert.match(pageSource, /\.topbar-title-wrap \{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*45;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*overflow-y:\s*auto;[\s\S]*z-index:\s*60;/);
  assert.match(pageSource, /\.mail-detail \{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script><script src="assets\/premium-campaign-sender-settings\.js\?v=20260513a"><\/script><script src="assets\/premium-mailbox-outreach\.js\?v=20260516a"><\/script>\s*<script src="assets\/premium-mailbox\.js\?v=20260518a"><\/script>/);
});

test('premium flynow gebruikt de dynamische canonical sidebar-host', () => {
  const pageSource = readRepoFile('premium-flynow.html');
  const flynowCssSource = readRepoFile('assets/flynow.css');

  assert.match(
    pageSource,
    /<div class="dashboard-layout flynow-layout" data-sidebar-shell="canonical">/
  );
  assert.match(
    pageSource,
    /<aside class="sidebar" aria-label="Premium navigatie"><\/aside>/,
    'FLYNOW hoort de gedeelde premium-sidebar dynamisch te laten vullen'
  );
  assert.match(pageSource, /<main class="main-content flynow-main">/);
  assert.match(pageSource, /href="\/assets\/personnel-theme\.css\?v=20260513a"/);
  assert.match(pageSource, /src="\/assets\/personnel-theme\.js\?v=20260513a" defer/);
  assert.doesNotMatch(pageSource, /data-static-sidebar="1"/);
  assert.match(
    flynowCssSource,
    /\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.flynow-main/
  );
  assert.match(
    flynowCssSource,
    /body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*z-index:\s*120 !important/
  );
  assert.match(
    flynowCssSource,
    /@media \(min-width:\s*901px\)\s*\{[\s\S]*body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*height:\s*100vh !important[\s\S]*\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.flynow-main\s*\{[\s\S]*margin-left:\s*var\(--premium-sidebar-width,\s*320px\) !important/
  );
  assert.match(
    flynowCssSource,
    /\.deals-header\s*\{[\s\S]*position:\s*sticky;/
  );
  assert.match(
    flynowCssSource,
    /\.deals-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(230px,\s*1fr\)\)/
  );
});

test('static premium sidebars ship the webdesign link in html', () => {
  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /data-sidebar-key="websitegenerator"/,
      `${relativePath} hoort Webdesign direct in de sidebar html te hebben`
    );
    assert.match(
      pageSource,
      /<span class="sidebar-link-text">Webdesign<\/span>/,
      `${relativePath} hoort de sidebarnaam Webdesign te tonen`
    );
    assert.match(
      pageSource,
      /data-sidebar-key="qr_code"/,
      `${relativePath} hoort QR Code direct in de sidebar html te hebben`
    );
    assert.match(
      pageSource,
      /<span class="sidebar-link-text">QR Code<\/span>/,
      `${relativePath} hoort de sidebarnaam QR Code te tonen`
    );
  }
});

test('static premium sidebars ship the klanten link in html', () => {
  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /href="\/premium-klanten"[\s\S]*<span class="sidebar-link-text">Klanten<\/span>/,
      `${relativePath} hoort Klanten direct in de sidebar html te hebben`
    );
  }
});

test('static premium sidebars ship the database link in html', () => {
  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /href="\/premium-database"[\s\S]*<span class="sidebar-link-text">Database<\/span>/,
      `${relativePath} hoort Database direct in de sidebar html te hebben`
    );
  }
});

test('logged-in premium sidebar pages always have a profile host for session refresh', () => {
  const profileCriticalPages = [
    'premium-ai-lead-generator.html',
    'premium-bevestigingsmails.html',
    'premium-websitegenerator.html',
    'premium-pakketten.html',
    'premium-wachtwoordenregister.html',
  ];

  for (const relativePath of profileCriticalPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /<div class="sidebar-user-name" data-sidebar-user-name>Softora Premium<\/div>/,
      `${relativePath} hoort een herkenbare profielnaam-host te hebben`
    );
    assert.match(
      pageSource,
      /<div class="sidebar-user-trigger" role="group" aria-label="Gebruikersinfo">/,
      `${relativePath} hoort het gedeelde profielblok te hebben zodat personnel-theme.js de sessie kan verversen`
    );
    assert.match(
      pageSource,
      /assets\/premium-sidebar-profile-prefill\.js\?v=/,
      `${relativePath} hoort de profiel-prefill direct na de sidebar te laden`
    );
  }
});

test('websitegenerator page loads website preview script via shared asset', () => {
  const pageSource = readRepoFile('premium-websitegenerator.html');
  assert.match(
    pageSource,
    /<script src="assets\/premium-websitegenerator\.js\?v=[^"]+" defer><\/script>/,
    'premium-websitegenerator.html moet de website-generator script uit assets laden'
  );
});

test('websitegenerator layout gebruikt dezelfde sidebarbreedte als de premium shell', () => {
  const pageSource = readRepoFile('premium-websitegenerator.html');

  assert.match(
    pageSource,
    /\.sidebar\s*\{[\s\S]*width:\s*var\(--premium-sidebar-width,\s*320px\);/s,
    'premium-websitegenerator.html hoort de gedeelde premium sidebarbreedte te gebruiken'
  );
  assert.match(
    pageSource,
    /\.main-content\s*\{[\s\S]*margin-left:\s*var\(--premium-sidebar-width,\s*320px\);[\s\S]*width:\s*calc\(100% - var\(--premium-sidebar-width,\s*320px\)\);/s,
    'premium-websitegenerator.html hoort de contentbreedte af te stemmen op de gedeelde sidebarbreedte'
  );
});

test('static premium sidebars share the same section order and public labels', () => {
  const expectedSections = [
    {
      label: 'Overzicht',
      links: [
        'dashboard:Dashboard',
        'active_orders:Actieve Opdrachten',
        'agenda:Agenda',
        'leads:Leads',
        'coldcalling:Coldcalling',
        'coldmailing:Coldmailing',
        'database:Database',
      ],
    },
    {
      label: 'Beheer',
      links: [
        'customers:Klanten',
        'mailbox:Mailbox',
        'websitegenerator:Webdesign',
        'seo:SEO',
        'qr_code:QR Code',
        'packages:Pakketten',
        "pdfs:PDF'S",
      ],
    },
    {
      label: "ADVERTENTIE'S",
      links: [
        'ads_trustoo:Trustoo',
        'ads_pinterest:Pinterest',
        'ads_facebook:Facebook',
        'ads_twitter:X / Twitter',
        'ads_google:Google',
        'ads_linkedin:LinkedIn',
      ],
    },
    {
      label: 'Socialmedia',
      links: [
        'social_instagram:Instagram',
        'social_linkedin:LinkedIn',
        'social_facebook:Facebook',
        'social_twitter:X / Twitter',
      ],
    },
    {
      label: 'Extra',
      links: [
        'passwords:Wachtwoordenregister',
        'monthly_costs:Terugkerende kosten',
        'bookkeeping:Boekhouding',
        'notepad:Kladblok',
        'word:Word',
        'settings:Instellingen',
      ],
    },
  ];

  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    assert.deepEqual(
      extractSidebarSections(pageSource),
      expectedSections,
      `${relativePath} hoort dezelfde premium-sidebar te hebben`
    );
    const linkTargets = extractSidebarLinkTargets(pageSource);
    assert.equal(linkTargets.ads_facebook, '/premium-advertenties#facebook');
    assert.equal(linkTargets.social_facebook, '/premium-socialmedia#facebook');
    assert.equal(linkTargets.ads_twitter, '/premium-advertenties#twitter');
    assert.equal(linkTargets.social_twitter, '/premium-socialmedia#twitter');
    assert.equal(linkTargets.ads_google, '/premium-advertenties#google');
    assert.equal(linkTargets.ads_linkedin, '/premium-advertenties#linkedin');
    assert.equal(linkTargets.social_linkedin, '/premium-socialmedia#linkedin');
    assert.equal(linkTargets.qr_code, '/premium-qr-code');
    for (const lockedKey of [
      'seo',
      'qr_code',
      'ads_trustoo',
      'ads_pinterest',
      'ads_facebook',
      'ads_twitter',
      'ads_google',
      'ads_linkedin',
      'social_instagram',
      'social_linkedin',
      'social_facebook',
      'social_twitter',
    ]) {
      const lockedLink = pageSource.match(
        new RegExp(`<a [^>]*data-sidebar-key="${lockedKey}"[^>]*>[\\s\\S]*?<\\/a>`)
      );
      assert.ok(lockedLink, `${relativePath} mist locked sidebar-link ${lockedKey}`);
      assert.match(lockedLink[0], /sidebar-link--coming-soon/);
      assert.match(lockedLink[0], /sidebar-link-lock/);
    }
    assert.doesNotMatch(pageSource, /Snapchat/);
  }
});

test('unified premium sidebar splits ad channels from social media channels', () => {
  const themeJsSource = readRepoFile('assets/personnel-theme.js');

  assert.match(themeJsSource, /sidebar-section-label\\">ADVERTENTIE'S</);
  assert.match(themeJsSource, /sidebar-section-label">Socialmedia</);
  assert.match(themeJsSource, /href:\s*"\/premium-advertenties#trustoo"[\s\S]*label:\s*"Trustoo"/);
  assert.match(themeJsSource, /href:\s*"\/premium-advertenties#pinterest"[\s\S]*label:\s*"Pinterest"/);
  assert.match(themeJsSource, /key:\s*"ads_facebook"[\s\S]*href:\s*"\/premium-advertenties#facebook"[\s\S]*label:\s*"Facebook"/);
  assert.match(themeJsSource, /key:\s*"ads_twitter"[\s\S]*href:\s*"\/premium-advertenties#twitter"[\s\S]*label:\s*"X \/ Twitter"/);
  assert.match(themeJsSource, /key:\s*"ads_google"[\s\S]*href:\s*"\/premium-advertenties#google"[\s\S]*label:\s*"Google"/);
  assert.match(themeJsSource, /key:\s*"ads_linkedin"[\s\S]*href:\s*"\/premium-advertenties#linkedin"[\s\S]*label:\s*"LinkedIn"/);
  assert.match(themeJsSource, /href:\s*"\/premium-socialmedia#instagram"[\s\S]*label:\s*"Instagram"/);
  assert.match(themeJsSource, /href:\s*"\/premium-socialmedia#linkedin"[\s\S]*label:\s*"LinkedIn"/);
  assert.match(themeJsSource, /href:\s*"\/premium-socialmedia#facebook"[\s\S]*label:\s*"Facebook"/);
  assert.match(themeJsSource, /href:\s*"\/premium-socialmedia#twitter"[\s\S]*label:\s*"X \/ Twitter"/);
  assert.match(themeJsSource, /if \(hashRaw === "google"\) return "ads_google";/);
  assert.match(themeJsSource, /if \(p\.indexOf\("\/premium-socialmedia"\) === 0\) \{/);
  assert.doesNotMatch(themeJsSource, /social_google/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-socialmedia#google"/);
  assert.doesNotMatch(themeJsSource, /social_snapchat/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-advertenties#snapchat"/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-socialmedia#snapchat"/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Snapchat"/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

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
  const autopilotSource = readRepoFile('assets/premium-sidebar-autopilot.css');
  const autopilotJsSource = readRepoFile('assets/premium-sidebar-autopilot.js');
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
  assert.match(themeJsSource, /function isSidebarNavigationCurrentTarget\(href\) \{/);
  assert.match(themeJsSource, /anchor\.dataset\.sidebarHref = normalizeSidebarNavigationTarget\(href\);[\s\S]*anchor\.setAttribute\("href", anchor\.dataset\.sidebarHref\);/);
  assert.doesNotMatch(themeJsSource, /window\.location\.assign\(href\);/);
  assert.doesNotMatch(themeJsSource, /openSidebarNavigationTarget\(anchor\.dataset\.sidebarHref, event\);/);
  assert.match(themeJsSource, /document\.body\.setAttribute\("data-sidebar-nav-ready", "1"\);/);
  assert.match(themeJsSource, /function enforceDashboardAiChatScope\(\)/);
  assert.match(themeJsSource, /#dashboardAiChat, \.dashboard-ai-chat/);
  assert.match(themeJsSource, /\/premium-personeel-dashboard/);
  assert.match(themeJsSource, /removeChild\(element\)/);
  assert.match(themeSource, /\.sidebar a\.sidebar-logo,[\s\S]*pointer-events:\s*none;/);
  assert.match(themeSource, /body\[data-sidebar-nav-ready="1"\] \.sidebar a\.sidebar-logo,[\s\S]*pointer-events:\s*auto;/);
  assert.match(themeSource, /\.sidebar a\.sidebar-logo,[\s\S]*transform:\s*none !important;/);
  assert.match(themeSource, /font-family:\s*'SoftoraSidebarOswald';[\s\S]*font-display:\s*block;[\s\S]*oswald-latin\.woff2\?v=20260409a/);
  assert.match(themeSource, /font-family:\s*'SoftoraSidebarInter';[\s\S]*font-display:\s*block;[\s\S]*inter-latin\.woff2\?v=20260409a/);
  assert.match(themeSource, /@view-transition\s*\{[\s\S]*navigation:\s*auto;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*view-transition-name:\s*softora-premium-sidebar;/);
  assert.match(themeSource, /::view-transition-old\(softora-premium-sidebar\),[\s\S]*::view-transition-new\(softora-premium-sidebar\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(stabilitySource, /@view-transition\s*\{[\s\S]*navigation:\s*auto;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*view-transition-name:\s*softora-premium-sidebar;/);
  assert.match(stabilitySource, /::view-transition-old\(softora-premium-sidebar\),[\s\S]*::view-transition-new\(softora-premium-sidebar\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(stabilitySource, /::view-transition-old\(root\),[\s\S]*::view-transition-new\(root\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(themeSource, /--premium-sidebar-font-display:\s*'SoftoraSidebarOswald', 'Oswald', sans-serif;/);
  assert.match(themeSource, /\.sidebar-logo\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-display\) !important;[\s\S]*font-synthesis:\s*none !important;/);
  assert.match(themeSource, /\.sidebar-link \.sidebar-link-text\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans\) !important;/);
  assert.match(autopilotSource, /\.sidebar-link\.sidebar-link--autopilot\s*\{[\s\S]*pointer-events:\s*none !important;[\s\S]*cursor:\s*default !important;/);
  assert.match(autopilotSource, /\.sidebar-link \.sidebar-autopilot-badge\s*\{[\s\S]*margin-left:\s*auto !important;[\s\S]*text-transform:\s*lowercase !important;/);
  assert.match(autopilotJsSource, /const AUTOPILOT_KEY = "coldmailing";/);
  assert.match(autopilotJsSource, /link\.removeAttribute\("href"\);/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.2 !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-logo\s*\{[\s\S]*margin:\s*0 0 11px !important;[\s\S]*font-size:\s*25px !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*min-height:\s*0 !important;[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.12 !important;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*transition:\s*none !important;[\s\S]*transform:\s*none !important;/);
  assert.match(stabilitySource, /html\[data-premium-sidebar-route-changing="true"\] \.sidebar\[data-static-sidebar="1"\],[\s\S]*body\[data-premium-sidebar-route-changing="true"\] \.sidebar\[data-static-sidebar="1"\]/);
  assert.match(stabilityJsSource, /anchor\.getAttribute\("aria-disabled"\) === "true"/);
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
  assert.match(stabilityJsSource, /CONTENT_FRAME_PARAM = "softora_sidebar_content"/);
  assert.match(stabilityJsSource, /CONTENT_FRAME_ID = "softoraPremiumContentFrame"/);
  assert.match(stabilityJsSource, /function persistSidebarNavState\(sidebar, targetHref\) \{/);
  assert.match(stabilityJsSource, /function isCurrentTarget\(href\) \{/);
  assert.match(stabilityJsSource, /function navigatePersistentSidebarShell\(href, options\) \{/);
  assert.match(stabilityJsSource, /isCurrentTarget\(visibleUrl\) && \(!options \|\| options\.pushHistory !== false\)/);
  assert.match(stabilityJsSource, /function ensureContentFrame\(\) \{/);
  assert.match(stabilityJsSource, /frame\.className = "softora-premium-content-frame";/);
  assert.match(stabilityJsSource, /targetUrl\.searchParams\.set\(CONTENT_FRAME_PARAM, "1"\);/);
  assert.match(stabilityJsSource, /window\.history\.pushState\(\{ softoraPremiumSidebarShell: true, href: visibleUrl \}, "", visibleUrl\);/);
  assert.match(stabilityJsSource, /window\.addEventListener\("popstate", function \(\) \{/);
  assert.match(stabilityJsSource, /event\.stopImmediatePropagation\(\);/);
  assert.match(stabilityJsSource, /document\.documentElement\.toggleAttribute\("data-premium-sidebar-route-changing", Boolean\(isChanging\)\);/);
  assert.match(stabilityJsSource, /document\.addEventListener\("click", handleSidebarNavigationStart, true\);/);
  assert.match(themeSource, /\.dashboard-layout\[data-sidebar-shell="canonical"\] > :is\(\.main-content, main\.main-content, \.main, main\.main\) > \.premium-boot-shell > :is\(\.page-content, \.page-header, \.topbar, \.page-hero, \.register-shell, \.coming-shell, \.screen, \.notepad-shell, \.word-shell\)/);
  assert.match(stabilitySource, /\.softora-premium-content-frame\s*\{[\s\S]*position:\s*fixed;[\s\S]*left:\s*var\(--premium-sidebar-width, 320px\);/);
  assert.match(stabilitySource, /\.softora-premium-content-frame\s*\{[\s\S]*z-index:\s*45;/);
  assert.match(stabilitySource, /html\[data-premium-sidebar-shell-active\],[\s\S]*body\[data-premium-sidebar-shell-active\]\s*\{[\s\S]*overflow:\s*hidden !important;/);
  assert.match(themeJsSource, /function initPremiumSidebarStabilityGuards\(\) \{/);
  assert.match(themeJsSource, /document\.addEventListener\("pointerdown", function \(event\) \{/);
  assert.match(themeJsSource, /window\.addEventListener\("focus", function \(\) \{\s*schedulePremiumSidebarStability\(\);/s);
  assert.match(themeJsSource, /const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set\(\["passwords"\]\);/);
  assert.match(themeJsSource, /PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set\(\[[\s\S]*"leads"/);
  assert.match(themeJsSource, /PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set\(\[[\s\S]*"coldcalling"/);
  const comingSoonSetMatch = themeJsSource.match(/const PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(comingSoonSetMatch, 'coming soon set hoort expliciet te blijven bestaan');
  assert.doesNotMatch(comingSoonSetMatch[1], /"seo"/);
  assert.match(comingSoonSetMatch[1], /"qr_code"/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeJsSource, /premiumInitialSessionFetched/);
  assert.match(themeJsSource, /premiumSessionSnapshotFromStorage/);
  assert.match(themeJsSource, /function stabilizePremiumStaticSidebar\(sidebar, activeKey\) \{/);
  assert.match(themeJsSource, /if \(p\.indexOf\("\/premium-coldmailing-lead"\) === 0\) return "coldmailing";/);
  assert.doesNotMatch(themeJsSource, /key:\s*"coldmailing_lead"/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Lead"/);
  assert.doesNotMatch(themeJsSource, /getColdmailingLeadSidebarLink/);
  assert.doesNotMatch(themeJsSource, /ensureStaticSidebarLink\(sidebar, "overzicht",[\s\S]*\/premium-coldmailing-lead/);
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
  assert.match(themeJsSource, /avatarMutation: "unchanged"/);
  assert.match(themeJsSource, /if \(premiumProfileModalRef\.avatarMutation === "replace"\) profilePayload\.avatarDataUrl/);
  assert.match(themeJsSource, /if \(premiumProfileModalRef\.avatarMutation === "remove"\) profilePayload\.removeAvatar = true;/);
  assert.doesNotMatch(themeJsSource, /removeAvatar:\s*premiumProfileModalRef\.pendingAvatarDataUrl \? false : true/);
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
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_STABILITY_VERSION = '20260519d'/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_AUTOPILOT_VERSION = '20260609a'/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_CONTENT_FRAME_PARAM = 'softora_sidebar_content'/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_CONTENT_FRAME_STYLE/);
  assert.match(htmlPagesSource, /function isPremiumSidebarContentFrameRequest\(req\) \{/);
  assert.match(htmlPagesSource, /function applyPremiumSidebarContentFrameHtml\(html\) \{/);
  assert.match(htmlPagesSource, /html\[data-softora-sidebar-content-frame="1"\]\{--premium-sidebar-width:0px !important;\}/);
  assert.match(htmlPagesSource, /html\[data-softora-sidebar-content-frame="1"\] \.dashboard-layout\[data-sidebar-shell="canonical"\] > \.main-content/);
  assert.match(htmlPagesSource, /html\[data-softora-sidebar-content-frame="1"\] \.premium-boot-loader,\s*html\[data-softora-sidebar-content-frame="1"\] \.monthly-costs-boot-loader\{left:0 !important;\}/);
  assert.match(htmlPagesSource, /res\.setHeader\('X-Frame-Options', 'SAMEORIGIN'\);/);
  assert.match(htmlPagesSource, /frame-ancestors 'self'/);
  assert.match(htmlPagesSource, /premium-sidebar-stability\.css\?v=/);
  assert.match(htmlPagesSource, /premium-sidebar-stability\.js\?v=/);
  assert.match(htmlPagesSource, /premium-sidebar-autopilot\.css\?v=/);
  assert.match(htmlPagesSource, /premium-sidebar-autopilot\.js\?v=/);
  assert.match(htmlPagesSource, /id="softora-premium-sidebar-critical"/);
  assert.match(htmlPagesSource, /@view-transition\{navigation:auto;\}/);
  assert.match(htmlPagesSource, /view-transition-name:softora-premium-sidebar !important;/);
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

test('premium sidebar profile helper stays available when tab profile cache is empty', async () => {
  const prefillSource = readRepoFile('assets/premium-sidebar-profile-prefill.js');
  const context = {
    window: {
      location: {
        pathname: '/premium-personeel-dashboard',
        hash: '',
      },
    },
    document: {
      cookie: '',
      querySelector: () => null,
    },
    sessionStorage: {
      getItem: () => null,
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.sessionStorage = context.sessionStorage;

  vm.runInNewContext(prefillSource, context);

  const helper = context.window.SoftoraPremiumSidebarProfileSession;
  assert.equal(typeof helper?.enrichSession, 'function');

  const enriched = await helper.enrichSession(
    {
      ok: true,
      authenticated: true,
      email: 'serve@softora.nl',
      userId: 'usr_serve',
      displayName: 'serve@softora.nl',
      avatarDataUrl: '',
      role: 'admin',
    },
    async () => ({
      ok: true,
      user: {
        id: 'usr_serve',
        email: 'serve@softora.nl',
        firstName: 'Servé',
        lastName: 'Creusen',
        avatarDataUrl: 'data:image/png;base64,abcd',
      },
      session: {
        ok: true,
        authenticated: true,
        email: 'serve@softora.nl',
        userId: 'usr_serve',
        firstName: 'Servé',
        lastName: 'Creusen',
        displayName: 'Servé Creusen',
        avatarDataUrl: 'data:image/png;base64,abcd',
        role: 'admin',
      },
    })
  );

  assert.equal(enriched.displayName, 'Servé Creusen');
  assert.equal(enriched.avatarDataUrl, 'data:image/png;base64,abcd');
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

test('premium vaste lasten centreert bootloader in het zichtbare hoofdvlak', () => {
  const pageSource = readRepoFile('premium-vaste-lasten.html');

  assert.match(pageSource, /<aside class="sidebar"[^>]*data-static-sidebar="1"[^>]*>/);
  assert.match(
    pageSource,
    /\.monthly-costs-boot-loader\s*\{[\s\S]*position:\s*fixed;[\s\S]*left:\s*280px;[\s\S]*min-height:\s*100dvh;/,
    'de laadspinner moet aan het viewport-vlak naast de vaste sidebar hangen'
  );
  assert.match(
    pageSource,
    /@media \(max-width: 1100px\) \{[\s\S]*\.monthly-costs-boot-loader\s*\{[\s\S]*left:\s*0;/,
    'op mobiel hoort de loader weer over de volledige breedte te centreren'
  );
  assert.match(
    readRepoFile('server/services/html-pages.js'),
    /html\[data-softora-sidebar-content-frame="1"\] \.monthly-costs-boot-loader\{left:0 !important;\}/,
    'binnen de persistente sidebar-frame mag de vaste-lasten-loader geen tweede sidebar-offset optellen'
  );
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
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260605a"><\/script><script src="assets\/premium-campaign-sender-settings\.js\?v=20260602b"><\/script><script src="assets\/premium-mailbox-outreach\.js\?v=20260519a"><\/script><script src="assets\/premium-mailbox-display\.js\?v=20260522a"><\/script><script src="assets\/premium-mailbox-index\.js\?v=20260520a"><\/script>\s*<script src="assets\/premium-mailbox\.js\?v=20260522a"><\/script>/);
});

test('premium flynow gebruikt een statisch gestylde dynamische canonical sidebar-host', () => {
  const pageSource = readRepoFile('premium-flynow.html');
  const flynowCssSource = readRepoFile('assets/flynow.css');

  assert.match(
    pageSource,
    /<div class="dashboard-layout flynow-layout" data-sidebar-shell="canonical">/
  );
  assert.match(
    pageSource,
    /<aside class="sidebar" data-flynow-sidebar-host="1" aria-label="Premium navigatie"><\/aside>/,
    'FLYNOW hoort leeg te starten en daarna de gedeelde premium-sidebar dynamisch te laten vullen'
  );
  assert.match(pageSource, /<main class="main-content flynow-main">/);
  assert.match(pageSource, /href="\/assets\/personnel-theme\.css\?v=20260519b"/);
  assert.match(pageSource, /href="\/assets\/premium-sidebar-autopilot\.css\?v=20260609a"/);
  assert.match(pageSource, /src="\/assets\/personnel-theme\.js\?v=20260519b" defer/);
  assert.match(pageSource, /src="\/assets\/premium-sidebar-autopilot\.js\?v=20260609a" defer/);
  assert.doesNotMatch(pageSource, /data-static-sidebar="1"/);
  assert.match(
    flynowCssSource,
    /body\[data-flynow-page\]\s+\.dashboard-layout\[data-sidebar-shell="canonical"\]\s*>\s*main\.flynow-main/
  );
  assert.match(
    flynowCssSource,
    /body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*z-index:\s*120 !important/
  );
  assert.match(
    flynowCssSource,
    /body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*box-sizing:\s*border-box !important/
  );
  assert.match(
    flynowCssSource,
    /@media \(min-width:\s*901px\)\s*\{[\s\S]*body\[data-flynow-page\]\s+\.dashboard-layout\[data-sidebar-shell="canonical"\]\s*>\s*main\.flynow-main\s*\{[\s\S]*margin-left:\s*var\(--premium-sidebar-width,\s*320px\) !important/
  );
  assert.match(
    flynowCssSource,
    /@media \(min-width:\s*901px\)\s*\{[\s\S]*body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*height:\s*100vh !important/
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

test('static premium sidebar logo links to the clean public homepage', () => {
  const themeJsSource = readRepoFile('assets/personnel-theme.js');

  assert.match(
    themeJsSource,
    /'<a href="\/" class="sidebar-logo magnetic">Softora\.nl<\/a>'/,
    'de gedeelde sidebar-template hoort het logo naar de homepage te sturen'
  );
  assert.doesNotMatch(
    themeJsSource,
    /'<a href="\/premium-website" class="sidebar-logo magnetic">Softora\.nl<\/a>'/
  );

  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    const logoLink = pageSource.match(/<a href="([^"]+)" class="sidebar-logo magnetic">Softora\.nl<\/a>/);
    assert.ok(logoLink, `${relativePath} mist het premium sidebar-logo`);
    assert.equal(logoLink[1], '/', `${relativePath} hoort het sidebar-logo naar / te laten gaan`);
    assert.doesNotMatch(
      pageSource,
      /<a href="\/premium-website" class="sidebar-logo magnetic">Softora\.nl<\/a>/,
      `${relativePath} mag het sidebar-logo niet naar /premium-website sturen`
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
    assert.equal(linkTargets.ads_pinterest, '/premium-advertenties#pinterest');
    assert.equal(linkTargets.ads_facebook, '/premium-advertenties#facebook');
    assert.equal(linkTargets.social_facebook, '/premium-socialmedia#facebook');
    assert.equal(linkTargets.ads_twitter, '/premium-advertenties#twitter');
    assert.equal(linkTargets.social_twitter, '/premium-socialmedia#twitter');
    assert.equal(linkTargets.ads_google, '/premium-advertenties#google');
    assert.equal(linkTargets.ads_linkedin, '/premium-advertenties#linkedin');
    assert.equal(linkTargets.social_linkedin, '/premium-socialmedia#linkedin');
    assert.equal(linkTargets.seo, '/premium-seo');
    assert.equal(linkTargets.qr_code, '/premium-qr-code');
    const seoLink = pageSource.match(
      new RegExp(`<a [^>]*data-sidebar-key="seo"[^>]*>[\\s\\S]*?<\\/a>`)
    );
    assert.ok(seoLink, `${relativePath} mist SEO sidebar-link`);
    assert.doesNotMatch(seoLink[0], /sidebar-link--coming-soon/);
    assert.doesNotMatch(seoLink[0], /sidebar-link-lock/);
    assert.doesNotMatch(seoLink[0], /aria-disabled/);
    assert.doesNotMatch(seoLink[0], /tabindex="-1"/);
    const coldmailingLink = pageSource.match(
      new RegExp(`<a [^>]*data-sidebar-key="coldmailing"[^>]*>[\\s\\S]*?<\\/a>`)
    );
    assert.ok(coldmailingLink, `${relativePath} mist coldmailing autopilot sidebar-link`);
    assert.match(coldmailingLink[0], /sidebar-link--autopilot/);
    assert.match(coldmailingLink[0], /aria-disabled="true"/);
    assert.match(coldmailingLink[0], /tabindex="-1"/);
    assert.match(coldmailingLink[0], /<span class="sidebar-autopilot-badge" aria-hidden="true">autopilot<\/span>/);
    assert.doesNotMatch(coldmailingLink[0], /href=/);
    assert.doesNotMatch(coldmailingLink[0], /sidebar-link-lock/);
    for (const lockedKey of [
      'leads',
      'coldcalling',
      'mailbox',
      'qr_code',
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
      if (lockedKey === 'leads') {
        assert.match(lockedLink[0], /aria-disabled="true"/);
        assert.match(lockedLink[0], /tabindex="-1"/);
        assert.doesNotMatch(lockedLink[0], /data-sidebar-count-key="leads"/);
      }
    }
    assert.doesNotMatch(pageSource, /data-sidebar-key="ads_trustoo"/);
    assert.doesNotMatch(pageSource, /premium-advertenties#trustoo/);
    assert.doesNotMatch(pageSource, /Snapchat/);
  }
});

test('unified premium sidebar splits ad channels from social media channels', () => {
  const themeJsSource = readRepoFile('assets/personnel-theme.js');

  assert.match(themeJsSource, /sidebar-section-label\\">ADVERTENTIE'S</);
  assert.match(themeJsSource, /sidebar-section-label">Socialmedia</);
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
  assert.match(themeJsSource, /return "ads_pinterest";/);
  assert.match(themeJsSource, /if \(p\.indexOf\("\/premium-socialmedia"\) === 0\) \{/);
  assert.doesNotMatch(themeJsSource, /ads_trustoo/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-advertenties#trustoo"/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Trustoo"/);
  assert.doesNotMatch(themeJsSource, /social_google/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-socialmedia#google"/);
  assert.doesNotMatch(themeJsSource, /social_snapchat/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-advertenties#snapchat"/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-socialmedia#snapchat"/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Snapchat"/);
});

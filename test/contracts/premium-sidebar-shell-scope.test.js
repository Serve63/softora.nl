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
  'premium-gezondheidsdossier.html',
  'premium-instellingen.html',
  'premium-omzetwerk.html',
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

test('Winnen gebruikt standaard de canonical premium-shell en page-only focusmodus', () => {
  const pageSource = readRepoFile('live-momentum.html');
  const accessSource = readRepoFile('live-momentum-access.html');
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const focusSource = readRepoFile('assets/live-momentum-focus-mode.js');

  assert.match(pageSource, /data-sidebar-shell="canonical"/);
  assert.match(pageSource, /<aside class="sidebar" data-live-momentum-sidebar-host/);
  assert.match(pageSource, /premium-sidebar-links\.js\?v=20260818a/);
  assert.match(pageSource, /assets\/personnel-theme\.(?:css|js)\?v=/);
  assert.match(pageSource, /<main class="main-content momentum-page"/);
  assert.match(pageSource, /data-momentum-focus-toggle/);
  assert.match(themeSource, /pathname === "\/winnen"/);
  assert.match(themeSource, /return p === "\/winnen" \|\| p === "\/live-momentum" \|\| p === "\/live-momentum\.html" \? "live_momentum" : "dashboard";/);
  assert.match(themeSource, /PREMIUM_SIDEBAR_DEEP_LINK_ONLY_KEYS = new Set\(\["live_momentum", "pdfs"\]\)/);
  assert.match(themeSource, /PREMIUM_SIDEBAR_DEEP_LINK_ONLY_KEYS\.has\(key\)/);
  assert.match(themeSource, /a\[data-sidebar-key="live_momentum"\][^']*a\[href="\/winnen"\]/);
  assert.doesNotMatch(themeSource, /getLiveMomentumSidebarLink|label: "Winnen"/);
  assert.match(focusSource, /body\.classList\.toggle\("momentum-focus-mode", next\)/);
  assert.match(focusSource, /event\.key !== "Escape"/);
  assert.doesNotMatch(focusSource, /localStorage|sessionStorage|location\.(?:assign|replace|reload)/);
  assert.match(accessSource, /data-sidebar-shell="canonical"/);
  assert.match(accessSource, /<aside class="sidebar" data-live-momentum-sidebar-host/);
  assert.match(accessSource, /premium-sidebar-links\.js\?v=20260818a/);
  assert.match(accessSource, /assets\/personnel-theme\.(?:css|js)\?v=/);
  assert.doesNotMatch(accessSource, /ATTACK, ATTACK, ATTACK\.|THE END GAME IS TO WIN|momentum-access-art/i);
});

test('Winnen blijft deep-link-only en wordt door geen premium-sidebarvariant zichtbaar gemaakt', () => {
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const pageSource = readRepoFile('live-momentum.html');
  const accessSource = readRepoFile('live-momentum-access.html');

  assert.match(pageSource, /<aside class="sidebar" data-live-momentum-sidebar-host/);
  assert.doesNotMatch(pageSource, /data-sidebar-key="live_momentum"|href="\/winnen"[^>]*sidebar-link|sidebar-link-text">Winnen/);
  assert.doesNotMatch(accessSource, /data-sidebar-key="live_momentum"|href="\/winnen"[^>]*sidebar-link|sidebar-link-text">Winnen/);
  assert.doesNotMatch(
    themeSource.match(/function buildUnifiedPremiumSidebarHtml\(activeKey\) \{[\s\S]*?function pruneDeprecatedSidebarLinks/)?.[0] || '',
    /data-sidebar-key="live_momentum"|href="\/winnen"|sidebar-link-text">Winnen/
  );
  staticSidebarPages.forEach((fileName) => {
    const source = readRepoFile(fileName);
    assert.doesNotMatch(
      source,
      /data-sidebar-key="live_momentum"|href="\/winnen"[^>]*sidebar-link|sidebar-link-text">Winnen/,
      `${fileName} mag geen zichtbare Winnen-entry bevatten`
    );
  });
});

test('PDF blijft deep-link-only en is uit elke premium-sidebarbron verwijderd', () => {
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const htmlPagesSource = readRepoFile('server/services/html-pages.js');
  const pdfPageSource = readRepoFile('premium-pdfs.html');
  const smokeSource = readRepoFile('test/smoke/pages.smoke.test.js');

  assert.match(themeSource, /if \(p\.indexOf\("\/premium-pdfs"\) === 0\) return "pdfs"/);
  assert.match(themeSource, /PREMIUM_SIDEBAR_DEEP_LINK_ONLY_KEYS = new Set\(\["live_momentum", "pdfs"\]\)/);
  assert.doesNotMatch(themeSource, /key: "pdfs",\s*href: "\/premium-pdfs",\s*label: "PDF'S"/);
  assert.match(themeSource, /a\[data-sidebar-key="pdfs"\]/);
  assert.match(htmlPagesSource, /bookkeeping\|pdfs/);

  [...staticSidebarPages, 'premium-lead-radar-shell.html'].forEach((fileName) => {
    const source = readRepoFile(fileName);
    assert.doesNotMatch(
      source,
      /data-sidebar-key="pdfs"|href="\/premium-pdfs"[^>]*sidebar-link|sidebar-link-text">PDF(?:'|’)?S/i,
      `${fileName} mag geen PDF-sidebarentry bevatten`
    );
  });

  assert.match(pdfPageSource, /<title>PDF's - Softora\.nl<\/title>/);
  assert.match(pdfPageSource, /assets\/premium-pdfs-builder\.js\?v=/);
  assert.match(smokeSource, /'premium-pdfs\.html'/);
});

test('vergrendeld wachtwoordenregister houdt de globale sidebar direct bruikbaar', () => {
  const pageSource = readRepoFile('premium-wachtwoordenregister.html');
  const themeSource = readRepoFile('assets/personnel-theme.css');
  const htmlPagesSource = readRepoFile('server/services/html-pages.js');
  const reauthStyleSource = readRepoFile('assets/premium-password-register-reauth.css');
  const reauthSource = readRepoFile('assets/premium-password-register-reauth.js');

  assert.match(pageSource, /<body data-sidebar-nav-ready="1">/);
  assert.doesNotMatch(pageSource, /assets\/personnel-theme\.js/);
  assert.match(themeSource, /body\[data-sidebar-nav-ready="1"\][\s\S]*?\.sidebar a\.sidebar-link[\s\S]*?pointer-events:\s*auto/);
  assert.match(themeSource, /\.sidebar-link\.sidebar-link--coming-soon[\s\S]*?pointer-events:\s*none\s*!important/);
  assert.match(pageSource, /<main class="main-content">[\s\S]*?<div id="screen-pin">/);
  assert.doesNotMatch(pageSource.match(/<div id="screen-pin">[\s\S]*?<\/main>/)[0], /aria-modal="true"|\binert\b/);
  assert.match(htmlPagesSource, /id="password-register-auth-recovery"/);
  assert.match(htmlPagesSource, /id="password-register-auth-retry"[^>]*>Opnieuw bevestigen<\/button>/);
  assert.match(htmlPagesSource, /href="\/premium-instellingen#extra">Terug<\/a>/);
  assert.match(htmlPagesSource, /const recoveryMarkup[\s\S]*?screen-pin[\s\S]*?recoveryMarkup/);
  assert.match(htmlPagesSource, /premium-password-register-reauth\.css/);
  assert.match(reauthStyleSource, /#password-register-auth-recovery[\s\S]*?display:\s*flex/);
  assert.match(reauthStyleSource, /data-password-register-auth-recovery="1"[\s\S]*?#screen-pin/);
  assert.match(reauthSource, /automaticDelaysMs = \[900, 2400\]/);
  assert.match(reauthSource, /"Accept": "application\/json"/);
  assert.match(reauthSource, /credentials: "same-origin"/);
  assert.match(reauthSource, /global\.location\.replace\("\/premium-wachtwoordenregister"\)/);
  assert.match(reauthSource, /next=%2Fpremium-wachtwoordenregister/);
  assert.match(reauthSource, /global\.addEventListener\("pagehide"[\s\S]*abortActiveRequest/);
  assert.doesNotMatch(reauthSource, /localStorage|sessionStorage|verify-pin|master-secret|ciphertext/);
});

test('premium database consistency assets stay outside the static sidebar', () => {
  const source = readRepoFile('premium-database.html');
  const asideEnd = source.indexOf('</aside>');
  assert.ok(asideEnd > 0);
  assert.ok(source.indexOf('assets/premium-database-lead-delete.js?v=20260716a') > asideEnd);
  assert.ok(source.indexOf('assets/premium-database-customers-loader.js?v=20260804a') > asideEnd);
  assert.ok(source.indexOf('assets/premium-database-mail-ready-snapshot.js?v=20260805h') > asideEnd);
  assert.ok(source.indexOf('assets/premium-database-webdesign-variant-picker.js?v=20260726a') > asideEnd);
});

test('premium klanten opslagasset blijft buiten de statische sidebar', () => {
  const source = readRepoFile('premium-klanten.html');
  const asideEnd = source.indexOf('</aside>');
  const storeAssetIndex = source.indexOf('assets/premium-customers-store.js?v=20260824a');

  assert.ok(asideEnd > 0, 'klantenpagina hoort de statische sidebar te behouden');
  assert.ok(storeAssetIndex > asideEnd, 'klantenopslaglogica hoort buiten de sidebar-shell te laden');
  assert.match(source, /class="sidebar-link magnetic active" data-sidebar-key="customers"/);
});

test('gezondheidsdossier houdt WHOOP-logica buiten de statische sidebar', () => {
  const source = readRepoFile('premium-gezondheidsdossier.html');
  const asideEnd = source.indexOf('</aside>');

  assert.ok(asideEnd > 0);
  assert.ok(source.indexOf('assets/premium-health-dossier.css?v=20260716a') < asideEnd);
  assert.ok(source.indexOf('assets/premium-health-dossier.js?v=20260812a') > asideEnd);
  assert.match(source, /data-health-dossier/);
  const healthScript = readRepoFile('assets/premium-health-dossier.js');
  assert.match(healthScript, /\/api\/health\/whoop\/status/);
  assert.match(healthScript, /status\.needsReauthorization/);
  assert.match(healthScript, /\/api\/health\/whoop\/authorize/);
  assert.doesNotMatch(healthScript, /\/api\/health\/whoop\/sync/);
});

test('gezondheidsdossier blijft bereikbaar zonder item in de premium-sidebar', () => {
  const pageSource = readRepoFile('premium-gezondheidsdossier.html');
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const settingsLink = pageSource.match(/<a [^>]*data-sidebar-key="settings"[^>]*>/);

  assert.ok(settingsLink, 'gezondheidsdossier mist de instellingenlink');
  assert.doesNotMatch(settingsLink[0], /\bactive\b/);
  assert.doesNotMatch(pageSource, /data-sidebar-key="health_dossier"/);
  assert.doesNotMatch(themeSource, /getHealthDossierSidebarLink/);
  assert.doesNotMatch(themeSource, /label: "Gezondheidsdossier"/);
  assert.match(themeSource, /a\[data-sidebar-key="health_dossier"\]/);
});

test('verborgen premium-sidebar-items behouden hun deep-link pagina en onderliggende assets', () => {
  const hiddenItems = [
    ['agenda', 'premium-personeel-agenda.html', '/premium-personeel-agenda'],
    ['websitegenerator', 'premium-websitegenerator.html', '/premium-websitegenerator'],
    ['bookkeeping', 'premium-boekhouding.html', '/premium-boekhouding'],
  ];
  const themeSource = readRepoFile('assets/personnel-theme.js');

  for (const [key, pageFile, href] of hiddenItems) {
    const pageSource = readRepoFile(pageFile);
    assert.ok(fs.existsSync(path.join(__dirname, '../..', pageFile)), `${pageFile} mag niet zijn verwijderd`);
    assert.match(pageSource, new RegExp(`href="${href}"`), `${pageFile} moet direct bereikbaar blijven`);
    assert.match(themeSource, new RegExp(`data-sidebar-key="${key}"`), `${key} blijft in de gedeelde bron beschikbaar`);
  }
});

test('OMZETWERK behoudt de canonical premium-sidebar en markeert Instellingen actief', () => {
  const pageSource = readRepoFile('premium-omzetwerk.html');
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const prefillSource = readRepoFile('assets/premium-sidebar-profile-prefill.js');

  assert.match(pageSource, /<body data-omzetwerk-page>/);
  assert.match(pageSource, /<div class="dashboard-layout" data-sidebar-shell="canonical">/);
  assert.match(pageSource, /<aside class="sidebar" data-sidebar-ready="true" data-static-sidebar="1">/);
  assert.match(pageSource, /<main class="main-content omzetwerk-main">/);
  assert.match(pageSource, /class="sidebar-link magnetic active" data-sidebar-key="settings"/);
  assert.match(pageSource, /assets\/personnel-theme\.css\?v=20260519b/);
  assert.match(pageSource, /assets\/personnel-theme\.js\?v=20260519b/);
  assert.match(pageSource, /assets\/premium-sidebar-profile-prefill\.js\?v=20260424a/);
  assert.match(themeSource, /p\.indexOf\("\/premium-omzetwerk"\) === 0 \|\| p\.indexOf\("\/premium-instellingen"\) === 0\) return "settings"/);
  assert.match(prefillSource, /p\.indexOf\("\/premium-omzetwerk"\) === 0\) return "settings"/);
});

test('opdrachtdossier editor-assets blijven buiten de statische premium-sidebar', () => {
  const source = readRepoFile('premium-opdracht-dossier.html');
  const asideEnd = source.indexOf('</aside>');
  const editorScriptIndex = source.indexOf('assets/premium-opdracht-dossier.js?v=20260722a');
  const editorStyleIndex = source.indexOf('assets/premium-opdracht-dossier-editor.css?v=20260629a');

  assert.ok(asideEnd > 0, 'opdrachtdossier hoort de statische sidebar te behouden');
  assert.ok(editorStyleIndex > -1, 'opdrachtdossier hoort de editor-stylesheet te laden');
  assert.ok(editorScriptIndex > asideEnd, 'opdrachtdossier editor-script hoort buiten de sidebar te staan');
  assert.deepEqual(
    extractSidebarSections(source).map((section) => section.label),
    ['Overzicht', 'Beheer', "ADVERTENTIE'S", 'Socialmedia', 'Extra']
  );
});

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
  assert.match(themeSource, /\.premium-boot-loader,[\s\S]*#dashboardHardBootLoader\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(themeSource, /\.premium-boot-shell\.is-booting\s*\{[\s\S]*opacity:\s*1[\s\S]*pointer-events:\s*auto/);
  assert.doesNotMatch(
    themeSource,
    /\.dashboard-layout > \.main-content,\s*\.dashboard-layout > main\.main-content/s
  );
  assert.match(themeJsSource, /function neutralizeSidebarAnchors\(\) \{/);
  assert.match(themeJsSource, /const isPremiumPersonnelContext = [^;]*pathname === "\/mailbox"/);
  assert.match(themeJsSource, /targetUrl\.pathname === "\/mailbox" \|\| targetUrl\.pathname === "\/winnen" \|\| targetUrl\.pathname\.indexOf\("\/premium-"\) === 0/);
  assert.match(prefillSource, /if \(p === "\/mailbox" \|\| p\.indexOf\("\/premium-mailbox"\) === 0\) return "mailbox";/);
  assert.match(stabilityJsSource, /path\.indexOf\("\/premium-"\) === 0 \|\| path === "\/mailbox"/);
  assert.doesNotMatch(
    themeJsSource.match(/function buildUnifiedPremiumSidebarHtml\(activeKey\) \{[\s\S]*?function pruneDeprecatedSidebarLinks/)?.[0] || '',
    /key:\s*"coldmailing"/,
    'de gedeelde sidebar-template mag Coldmailing niet meer tonen'
  );
  assert.match(
    themeJsSource,
    /a\[data-sidebar-key="coldmailing"\]/,
    'oude statische Coldmailing-links horen client-side te worden opgeruimd'
  );
  assert.match(themeJsSource, /anchor\.removeAttribute\("href"\);/);
  assert.match(themeJsSource, /function isSidebarNavigationCurrentTarget\(href\) \{/);
  assert.match(themeJsSource, /pathname === "\/winnen" \|\| pathname === "\/live-momentum" \|\| pathname === "\/live-momentum\.html"/);
  assert.match(themeJsSource, /return p === "\/winnen" \|\| p === "\/live-momentum" \|\| p === "\/live-momentum\.html" \? "live_momentum" : "dashboard"/);
  assert.match(prefillSource, /p === "\/winnen" \|\| p === "\/live-momentum" \|\| p === "\/live-momentum\.html"\) return "live_momentum"/);
  assert.match(stabilityJsSource, /path === "\/winnen" \|\| path === "\/live-momentum" \|\| path === "\/live-momentum\.html"/);
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
  assert.match(themeSource, /@view-transition\s*\{[\s\S]*navigation:\s*none;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*view-transition-name:\s*softora-premium-sidebar;/);
  assert.match(themeSource, /::view-transition-old\(softora-premium-sidebar\),[\s\S]*::view-transition-new\(softora-premium-sidebar\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(stabilitySource, /@view-transition\s*\{[\s\S]*navigation:\s*none;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*view-transition-name:\s*softora-premium-sidebar;/);
  assert.match(stabilitySource, /::view-transition-old\(softora-premium-sidebar\),[\s\S]*::view-transition-new\(softora-premium-sidebar\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(stabilitySource, /::view-transition-old\(root\),[\s\S]*::view-transition-new\(root\)\s*\{[\s\S]*animation-duration:\s*1ms !important;/);
  assert.match(themeSource, /--premium-sidebar-font-display:\s*'SoftoraSidebarOswald', 'Oswald', sans-serif;/);
  assert.match(themeSource, /\.sidebar-logo\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-display\) !important;[\s\S]*font-synthesis:\s*none !important;/);
  assert.match(themeSource, /\.sidebar-link \.sidebar-link-text\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans\) !important;/);
  assert.match(autopilotSource, /\.sidebar-link\.sidebar-link--autopilot\s*\{[\s\S]*opacity:\s*0\.58 !important;[\s\S]*pointer-events:\s*none !important;[\s\S]*cursor:\s*default !important;/);
  assert.match(autopilotSource, /\.sidebar-link\.sidebar-link--autopilot\.active\s*\{[\s\S]*opacity:\s*0\.62 !important;/);
  assert.match(autopilotSource, /\.sidebar-link \.sidebar-autopilot-badge\s*\{[\s\S]*margin-left:\s*auto !important;[\s\S]*text-transform:\s*uppercase !important;/);
  assert.match(autopilotJsSource, /const AUTOPILOT_KEY = "coldmailing";/);
  assert.match(autopilotJsSource, /link\.removeAttribute\("href"\);/);
  assert.match(autopilotJsSource, /badge\.textContent = "AUTOPILOT";/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.2 !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-logo\s*\{[\s\S]*margin:\s*0 0 11px !important;[\s\S]*font-size:\s*25px !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*min-height:\s*0 !important;[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.12 !important;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*transition:\s*none !important;[\s\S]*transform:\s*none !important;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link:focus,[\s\S]*\.sidebar\[data-static-sidebar="1"\] \.sidebar-link:focus-visible\s*\{[\s\S]*outline:\s*none !important;[\s\S]*box-shadow:\s*none !important;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-nav\s*\{[\s\S]*scrollbar-width:\s*none !important;[\s\S]*-ms-overflow-style:\s*none !important;[\s\S]*scrollbar-gutter:\s*auto !important;/);
  assert.match(stabilitySource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-nav::-webkit-scrollbar\s*\{[\s\S]*display:\s*none !important;[\s\S]*width:\s*0 !important;[\s\S]*height:\s*0 !important;/);
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
  assert.doesNotMatch(themeJsSource, /warmVisibleSidebarNavigationTargets/);
  assert.doesNotMatch(themeJsSource, /requestIdleCallback\(run, \{ timeout: 1800 \}\)/);
  assert.match(themeJsSource, /anchor\.addEventListener\("pointerenter", function \(\) \{\s*warmSidebarNavigationTarget\(anchor\.dataset\.sidebarHref\);/s);
  assert.match(themeJsSource, /anchor\.addEventListener\("focus", function \(\) \{\s*warmSidebarNavigationTarget\(anchor\.dataset\.sidebarHref\);/s);
  assert.match(stabilityJsSource, /NAV_STATE_KEY = "softora_premium_sidebar_nav_state_v1"/);
  assert.match(stabilityJsSource, /function persistSidebarNavState\(sidebar, targetHref\) \{/);
  assert.match(stabilityJsSource, /function isCurrentTarget\(href\) \{/);
  assert.doesNotMatch(stabilityJsSource, /document\.createElement\("iframe"\)/);
  assert.doesNotMatch(stabilityJsSource, /softora_sidebar_content/);
  assert.doesNotMatch(stabilityJsSource, /softoraPremiumContentFrame/);
  assert.doesNotMatch(stabilityJsSource, /window\.history\.pushState/);
  assert.match(stabilityJsSource, /event\.stopImmediatePropagation\(\);/);
  assert.match(stabilityJsSource, /document\.documentElement\.toggleAttribute\("data-premium-sidebar-route-changing", Boolean\(isChanging\)\);/);
  assert.match(stabilityJsSource, /document\.addEventListener\("click", handleSidebarNavigationStart, true\);/);
  assert.match(themeSource, /\.dashboard-layout\[data-sidebar-shell="canonical"\] > :is\(\.main-content, main\.main-content, \.main, main\.main\) > \.premium-boot-shell > :is\(\.page-content, \.page-header, \.topbar, \.page-hero, \.register-shell, \.coming-shell, \.screen, \.notepad-shell, \.word-shell\)/);
  assert.doesNotMatch(stabilitySource, /softora-premium-content-frame/);
  assert.doesNotMatch(stabilitySource, /data-premium-sidebar-shell-active/);
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
  assert.doesNotMatch(comingSoonSetMatch[1], /"ads_facebook"/);
  assert.match(themeJsSource, /function activateFacebookAdsSidebarLink\(sidebar\)/);
  assert.match(themeJsSource, /activateFacebookAdsSidebarLink\(sidebar\)/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeJsSource, /premiumInitialSessionFetched/);
  assert.match(themeJsSource, /premiumSessionSnapshotFromStorage/);
  assert.match(themeJsSource, /function stabilizePremiumStaticSidebar\(sidebar, activeKey\) \{/);
  assert.match(
    themeJsSource,
    /function stabilizePremiumStaticSidebar\(sidebar, activeKey\) \{[\s\S]*?pruneDeprecatedSidebarLinks\(sidebar\);\s*syncPremiumSidebarManagementLinks\(sidebar, activeKey\);/
  );
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
  assert.match(prefillSource, /function normalizePremiumSidebarStructure\(\) \{/);
  assert.match(prefillSource, /FIRST_PAINT_DEPRECATED_SIDEBAR_KEYS[\s\S]*"coldmailing"[\s\S]*"agenda"[\s\S]*"websitegenerator"[\s\S]*"bookkeeping"/);
  assert.match(prefillSource, /ensureFirstPaintSidebarLink\(sidebar, overview, getFirstPaintSidebarLink\("lead_radar"\), \["database"\]\);/);
  assert.match(prefillSource, /ensureFirstPaintSidebarLink\(sidebar, management, getFirstPaintSidebarLink\("summarize"\), \["seo", "qr_code", "packages"\]\);/);
  assert.match(prefillSource, /normalizePremiumSidebarStructure\(\);\s*prefillPremiumSidebarActiveState\(\);/);
  assert.match(prefillSource, /data-sidebar-structure-prefilled/);
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
  assert.match(htmlPagesSource, /PREMIUM_PERSONNEL_THEME_VERSION = '20260818b'/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_PREFILL_VERSION = '20260824a'/);
  assert.match(htmlPagesSource, /assets\/premium-sidebar-profile-prefill\.js\?v=\$\{PREMIUM_SIDEBAR_PREFILL_VERSION\}/);
  assert.doesNotMatch(htmlPagesSource, /LEAD_RADAR_SIDEBAR_VERSION|lead-radar-sidebar\.js/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_STABILITY_VERSION = '20260818a'/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_AUTOPILOT_VERSION = '20260611a'/);
  assert.match(htmlPagesSource, /PREMIUM_DASHBOARD_AI_CHAT_SCOPE_VERSION = '20260611a'/);
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
  assert.match(htmlPagesSource, /premium-dashboard-ai-chat-scope\.js\?v=/);
  assert.match(htmlPagesSource, /id="softora-premium-sidebar-critical"/);
  assert.match(htmlPagesSource, /@view-transition\{navigation:none;\}/);
  assert.match(htmlPagesSource, /view-transition-name:softora-premium-sidebar !important;/);
  assert.match(htmlPagesSource, /LIVE_MOMENTUM_VIEW_TRANSITION_OPTOUT/);
  assert.match(htmlPagesSource, /@view-transition\{navigation:none;\}/);
  assert.match(htmlPagesSource, /fileName === 'live-momentum\.html'/);
  assert.match(htmlPagesSource, /function injectSnippetAfterHeadOpen\(html, snippet, marker\) \{/);
  assert.match(htmlPagesSource, /function hasPremiumStaticSidebar\(html\) \{/);
  assert.match(htmlPagesSource, /margin-left:var\(--premium-sidebar-width,320px\) !important;/);
  assert.doesNotMatch(
    themeJsSource,
    /if \(sidebar\.dataset\.staticSidebar === "1"\) \{[\s\S]*ensureStaticSidebarLink\(sidebar, "beheer", getWebsitePreviewSidebarLink\(\), \["seo", "packages", "pdfs"\]\);/s
  );
  assert.match(themeJsSource, /a\[data-sidebar-key="agenda"\][\s\S]*a\[data-sidebar-key="websitegenerator"\][\s\S]*a\[data-sidebar-key="bookkeeping"\][\s\S]*a\[data-sidebar-key="pdfs"\]/);
  assert.match(htmlPagesSource, /coldmailing\|agenda\|websitegenerator\|bookkeeping\|pdfs/);
  assert.match(stabilitySource, /navigation:\s*none/);
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

test('kvk database route keeps the canonical sidebar outside its scraper frame', () => {
  const pageSource = readRepoFile('premium-kvk-database-shell.html');
  const dashboardSource = readRepoFile('premium-kvk-database.html');
  const directoryContentSource = readRepoFile('premium-kvk-company-directory.html');
  const directoryShellSource = readRepoFile('premium-kvk-company-directory-shell.html');
  const directoryStyleSource = readRepoFile('assets/kvk-database-total-found.css');
  const directoryScriptSource = readRepoFile('assets/kvk-database-total-found.js');
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const sidebarLinksSource = readRepoFile('assets/premium-sidebar-links.js');

  assert.match(pageSource, /class="dashboard-layout kvk-database-shell" data-sidebar-shell="canonical"/);
  assert.match(pageSource, /<aside class="sidebar" data-sidebar-ready="false"/);
  assert.match(pageSource, /premium-sidebar-links\.js\?v=20260818a/);
  assert.match(pageSource, /class="main-content kvk-database-shell__content"/);
  assert.match(pageSource, /src="\/premium-kvk-database\?softora_sidebar_content=1"/);
  assert.doesNotMatch(pageSource, /settings-module-route-header|data-settings-module-back-host/);
  assert.match(dashboardSource, /<main class="app-shell">\s*<span data-settings-module-back-host><\/span>\s*<header class="page-header">/);
  assert.equal((pageSource.match(/background:\s*#f4f1ed/g) || []).length, 3);
  assert.doesNotMatch(pageSource, /background:\s*#f8f7f4/);
  assert.match(themeSource, /pathname === "\/kvk-database"/);
  assert.match(themeSource, /pathname === "\/kvk-database\.html"/);
  assert.match(sidebarLinksSource, /function getLeadRadarSidebarLink\(\)/);
  assert.match(themeSource, /ensureStaticSidebarLink\(sidebar, "overzicht", window\.SoftoraPremiumSidebarLinks\.getLeadRadarSidebarLink\(\), \["database"\]\)/);
  assert.match(directoryShellSource, /class="dashboard-layout company-directory-shell" data-sidebar-shell="canonical"/);
  assert.match(directoryShellSource, /<aside class="sidebar" data-sidebar-ready="false"/);
  assert.match(directoryShellSource, /premium-sidebar-links\.js\?v=20260818a/);
  assert.match(directoryShellSource, /<main class="main-content company-directory-shell__content"/);
  assert.match(directoryShellSource, /id="company-directory-table-frame"/);
  assert.doesNotMatch(directoryShellSource, /<p class="eyebrow">Softora Database<\/p>/);
  assert.match(directoryShellSource, /assets\/kvk-database-total-found\.css\?v=20260809f/);
  assert.match(directoryShellSource, /assets\/kvk-database-total-found\.js\?v=20260809e/);
  assert.doesNotMatch(directoryShellSource, /<iframe/);
  assert.match(
    directoryStyleSource,
    /\.company-directory-shell-page \.sidebar\s*\{[^}]*bottom:\s*0 !important;[^}]*height:\s*auto !important;[^}]*min-height:\s*0 !important;[^}]*max-height:\s*none !important;/s
  );
  assert.match(directoryStyleSource, /height:\s*calc\(100dvh - 48px\)/);
  assert.match(directoryStyleSource, /margin:\s*24px auto/);
  assert.match(
    directoryStyleSource,
    /\.dashboard-layout\[data-sidebar-shell="canonical"\] > main\.company-directory-shell__content\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0 !important;[^}]*padding:\s*0 !important;/s
  );
  assert.match(directoryStyleSource, /grid-template-columns:\s*minmax\(300px, 390px\) minmax\(0, 1fr\)/);
  assert.ok(
    directoryShellSource.indexOf('class="search-field company-directory__search"') <
      directoryShellSource.indexOf('class="company-directory__connection"'),
    'de zoekbalk hoort links voor de verbindingsstatus te staan'
  );
  assert.match(themeSource, /pathname === "\/kvk-database-bedrijven"/);
  assert.match(themeSource, /pathname === "\/kvk-database-bedrijven\.html"/);
  assert.match(dashboardSource, /assets\/kvk-database-total-found\.js\?v=20260809e/);
  assert.match(directoryScriptSource, /params\.get\(SIDEBAR_CONTENT_PARAM\) === '1'/);
  assert.match(directoryScriptSource, /browserWindow\.location\?\.assign\(directoryContentPageUrl\(category\)\)/);
  assert.match(directoryContentSource, /href="\/premium-kvk-database\?softora_sidebar_content=1"/);
  assert.doesNotMatch(directoryContentSource, /target="_top"/);
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
  assert.match(pageSource, /releasePremiumDashboardBootShell\(\);\s*if \(!hadPremiumDashboardCustomers \|\| !hadPremiumDashboardOrders\) void refreshPremiumDashboard\(true, true\);/s);
  assert.doesNotMatch(pageSource, /await refreshPremiumDashboard\(true\)/);
  assert.match(coreSource, /const PREMIUM_DASHBOARD_BOOT_MINIMUM_MS = 0;/);
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
  assert.equal(
    helper.shouldPreferPersistedSession(
      enriched,
      'usr_serve',
      ['serve@softora.nl', 'admin', ''].join('\u0001')
    ),
    true
  );
  assert.equal(
    helper.shouldPreferPersistedSession(
      enriched,
      'usr_other',
      ['Softora Premium', 'admin', ''].join('\u0001')
    ),
    false
  );

  const source = readRepoFile('assets/premium-sidebar-profile-prefill.js');
  assert.match(
    source,
    /if \(!serverRenderKey \|\| shouldPreferPersistedSession\(s, serverUserKey, serverRenderKey\)\)/
  );
  assert.match(
    source,
    /var serverUserKey = sidebarEl && String\(sidebarEl\.getAttribute\("data-sidebar-profile-user-key"\)/
  );
  assert.match(
    source,
    /var displayName = String\(s\.displayName \|\| s\.firstName \|\| s\.email \|\| "Softora Premium"\)/
  );
  assert.match(source, /persistedUserKey !== normalizedServerUserKey/);
  assert.match(source, /function buildProfileUserKey\(session\)/);
  assert.match(source, /session && \(session\.userId \|\| session\.email\)/);
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

test('premium mailbox behoudt alleen de vaste premium-sidebar bij responsive mailweergave', () => {
  const pageSource = readRepoFile('premium-mailbox.html');
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const mobileCssSource = readRepoFile('assets/premium-mailbox-mobile.css');

  assert.match(pageSource, /<aside class="sidebar"[^>]*data-static-sidebar="1"[^>]*>/);
  assert.match(pageSource, /data-sidebar-key="mailbox"[^>]*>[\s\S]*<span class="sidebar-link-text">Mailbox<\/span>/);
  assert.match(themeSource, /function getMailboxSidebarLink\(\)[\s\S]*key:\s*"mailbox",[\s\S]*href:\s*"\/mailbox",[\s\S]*label:\s*"Mailbox",[\s\S]*sidebar-link-mailbox-icon[\s\S]*m3 8 9 6 9-6/);
  assert.match(themeSource, /function activateMailboxSidebarLink\(sidebar\)[\s\S]*insertAdjacentHTML\("afterbegin", mailboxLink\.icon\)[\s\S]*label\.textContent = mailboxLink\.label/);
  assert.match(themeSource, /getMailboxSidebarLink\(\),/);
  assert.doesNotMatch(themeSource, /label:\s*"Coldmail Inbox"/);
  assert.doesNotMatch(pageSource, /class="mail-sidebar"/);
  assert.doesNotMatch(pageSource, /\.mail-sidebar\s*\{/);
  assert.doesNotMatch(pageSource, /data-mailbox-folder=/);
  assert.match(pageSource, /class="mailbox-mobile-sidebar-backdrop"[\s\S]*data-mailbox-mobile-action="close-navigation"/);
  assert.match(mobileCssSource, /\.dashboard-layout > \.sidebar\[data-static-sidebar="1"\][\s\S]*position: fixed !important/);
  assert.match(mobileCssSource, /body\.mailbox-mobile-nav-open \.dashboard-layout > \.sidebar/);
  assert.match(pageSource, /<main class="main-content is-premium-boot-host">[\s\S]*<div class="mail-page-shell">/);
  assert.match(pageSource, /\.main-content \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.mail-page-shell \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.topbar \{[\s\S]*overflow:\s*visible;[\s\S]*position:\s*relative;[\s\S]*z-index:\s*40;/);
  assert.match(pageSource, /\.topbar-title-wrap \{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*45;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*overflow-y:\s*auto;[\s\S]*z-index:\s*60;/);
  assert.match(pageSource, /\.mail-detail \{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
  assert.match(pageSource, /class="mail-results-scroll" id="mail-results-scroll"[\s\S]*id="mail-items"[\s\S]*id="mailbox-search-more"/);
  assert.doesNotMatch(pageSource, /mailbox-search-clear|mail-search-clear/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*width:\s*min\(100%,\s*900px\);[\s\S]*margin:\s*0 auto;/);
  assert.match(pageSource, /\.detail-mail-block \{[^}]*min-height:\s*min\(620px,\s*calc\(100vh - 92px\)\)/);
  assert.doesNotMatch(pageSource, /\.detail-more/);
  assert.match(pageSource, /\.detail-reply \{[^}]*border:\s*1px solid rgba\(155,35,85,\.34\);[^}]*border-radius:\s*6px;[^}]*padding:\s*8px 14px;/);
  assert.match(pageSource, /\.detail-footer \{[^}]*padding:\s*2px 0 16px;[^}]*border-bottom:\s*0;/);
  assert.match(pageSource, /\.detail-mail-contact-item \{[^}]*display:\s*flex;[^}]*gap:\s*0 \.35em;/);
  assert.match(pageSource, /\.compose-attach-button \{[^}]*display:\s*inline-flex;[^}]*gap:\s*8px;[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(pageSource, /id="compose-attachment-dropzone" role="group" aria-label="Bijlagen toevoegen: kies bestanden of sleep ze hierheen"/);
  assert.match(pageSource, /\.compose-attachment-row\.is-dragover \{[^}]*box-shadow:\s*inset 0 0 0 2px/);
  assert.equal((pageSource.match(/data-mailbox-compose-resize-zone=/g) || []).length, 8);
  assert.doesNotMatch(pageSource, /compose-resize-grip|data-mailbox-compose-resize-handle/);
  assert.match(pageSource, /data-mailbox-compose-no-drag aria-label="Sluiten"/);
  assert.match(pageSource, /\.compose-box \{[^}]*height:\s*min\(700px,\s*calc\(100vh - 28px\)\);[^}]*min-height:\s*min\(480px,\s*calc\(100vh - 28px\)\);/);
  assert.match(mobileCssSource, /\.compose-resize-zone \{ display: none; \}/);
  const composeAssetIndex = pageSource.indexOf('assets/premium-mailbox-compose.js?v=20260828g');
  const browserStorageAssetIndex = pageSource.indexOf('assets/premium-browser-storage.js?v=20260828b');
  const attachmentDigestAssetIndex = pageSource.indexOf('assets/premium-mailbox-attachment-digest.js?v=20260828c');
  const sendStateAssetIndex = pageSource.indexOf('assets/premium-mailbox-compose-send-state.js?v=20260828d');
  const sendResilienceAssetIndex = pageSource.indexOf('assets/premium-mailbox-compose-send-resilience.js?v=20260828h');
  const acceptedSendAssetIndex = pageSource.indexOf('assets/premium-mailbox-compose-accepted-send.js?v=20260827b');
  const composeControllerAssetIndex = pageSource.indexOf('assets/premium-mailbox-compose-controller.js?v=20260828f');
  assert.ok(composeAssetIndex >= 0, 'compose asset met actuele cachebuster ontbreekt');
  assert.ok(browserStorageAssetIndex >= 0, 'browser-storage asset ontbreekt');
  assert.ok(attachmentDigestAssetIndex >= 0, 'attachment-digest asset ontbreekt');
  assert.ok(sendStateAssetIndex >= 0, 'send-state asset ontbreekt');
  assert.ok(sendResilienceAssetIndex >= 0, 'send-resilience asset ontbreekt');
  assert.ok(acceptedSendAssetIndex >= 0, 'accepted-send asset ontbreekt');
  assert.ok(composeAssetIndex < browserStorageAssetIndex, 'compose hoort vóór browser-storage te laden');
  assert.ok(browserStorageAssetIndex < attachmentDigestAssetIndex, 'browser-storage hoort vóór attachment-digest te laden');
  assert.ok(attachmentDigestAssetIndex < sendStateAssetIndex, 'attachment-digest hoort vóór send-state te laden');
  assert.ok(sendStateAssetIndex < sendResilienceAssetIndex, 'send-state hoort vóór send-resilience te laden');
  assert.ok(sendResilienceAssetIndex < composeControllerAssetIndex, 'send-resilience hoort vóór de controller te laden');
  assert.ok(acceptedSendAssetIndex < composeControllerAssetIndex, 'accepted-send state hoort vóór de controller te laden');
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260723c"><\/script>[\s\S]*<script src="assets\/premium-mailbox-owner-session\.js\?v=20260826a"><\/script>[\s\S]*<script src="assets\/premium-mailbox-discovery\.js\?v=20260826a"><\/script><script src="assets\/premium-mailbox-list\.js\?v=20260818b"><\/script><script src="assets\/premium-mailbox-detail-state\.js\?v=20260821a"><\/script><script src="assets\/premium-mailbox-detail-stability\.js\?v=20260826a"><\/script><script src="assets\/premium-mailbox-index\.js\?v=20260826b"><\/script>/);
  assert.match(pageSource, /<script src="assets\/premium-mailbox-compose-window\.js\?v=20260817c"><\/script><script src="assets\/premium-browser-storage\.js\?v=20260828b"><\/script><script src="assets\/premium-mailbox-attachment-digest\.js\?v=20260828c"><\/script><script src="assets\/premium-mailbox-compose-send-state\.js\?v=20260828d"><\/script><script src="assets\/premium-mailbox-compose-send-resilience\.js\?v=20260828h"><\/script>[\s\S]*<script src="assets\/premium-mailbox-delete\.js\?v=20260820a"><\/script><script src="assets\/premium-mailbox-state-outbox\.js\?v=20260826a"><\/script><script src="assets\/premium-mailbox-read\.js\?v=20260826a"><\/script><script src="assets\/premium-mailbox-ui-state\.js\?v=20260827a"><\/script>\s*<script src="assets\/premium-mailbox-boot\.js\?v=20260806a"><\/script><script src="assets\/premium-mailbox\.js\?v=20260826a"><\/script>/);
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
  assert.match(pageSource, /premium-sidebar-links\.js\?v=20260818a/);
  assert.match(pageSource, /<main class="main-content flynow-main">/);
  assert.match(pageSource, /href="\/assets\/personnel-theme\.css\?v=20260519b"/);
  assert.match(pageSource, /href="\/assets\/premium-sidebar-autopilot\.css\?v=20260611a"/);
  assert.match(pageSource, /src="\/assets\/personnel-theme\.js\?v=20260519b" defer/);
  assert.match(pageSource, /src="\/assets\/premium-sidebar-autopilot\.js\?v=20260611a" defer/);
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

test('Lead Radar shell gebruikt de gedeelde premium navigatie en iframe-opbouw', () => {
  const shellSource = readRepoFile('premium-lead-radar-shell.html');
  const canonicalSource = readRepoFile('premium-personeel-dashboard.html');
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const sidebarLinksSource = readRepoFile('assets/premium-sidebar-links.js');

  assert.match(shellSource, /data-sidebar-shell="canonical"/);
  assert.match(shellSource, /<aside class="sidebar"[^>]*data-static-sidebar="1"[^>]*aria-label="Premium navigatie"/);
  assert.match(shellSource, /<body data-sidebar-nav-ready="1">/);
  assert.match(shellSource, /assets\/personnel-theme\.css\?v=20260519b/);
  assert.match(shellSource, /assets\/personnel-theme\.js\?v=20260519b/);
  assert.doesNotMatch(shellSource, /assets\/lead-radar-sidebar\.js/);
  assert.doesNotMatch(shellSource, /data-sidebar-key="lead_radar"/);
  assert.match(shellSource, /src="\/premium-lead-radar\?softora_sidebar_content=1"/);
  assert.match(shellSource, /html, body \{[^}]*scrollbar-width:\s*none/);
  assert.match(shellSource, /\.lead-radar-shell \.sidebar-nav \{[^}]*scrollbar-width:\s*none !important/);
  assert.match(shellSource, /\.lead-radar-shell \.sidebar-nav::-webkit-scrollbar \{[^}]*display:\s*none !important/);
  assert.match(shellSource, /\.lead-radar-shell > \.sidebar \{[^}]*pointer-events:\s*auto !important/);
  const serverHiddenKeys = new Set(['agenda', 'coldmailing', 'websitegenerator', 'bookkeeping', 'pdfs']);
  const visibleSections = (source) => extractSidebarSections(source).map((section) => ({
    ...section,
    links: section.links.filter((link) => {
      const key = link.split(':', 1)[0];
      return key !== 'lead_radar' && !serverHiddenKeys.has(key);
    }),
  }));
  assert.deepEqual(
    visibleSections(shellSource),
    visibleSections(canonicalSource),
    'Lead Radar hoort via dezelfde runtimebron aan de bestaande sidebar te worden toegevoegd'
  );
  assert.match(sidebarLinksSource, /function getLeadRadarSidebarLink\(\)/);
  assert.match(themeSource, /SoftoraPremiumSidebarLinks\.getLeadRadarSidebarLink\(\),\s*getDatabaseSidebarLink\(\)/);
  assert.match(themeSource, /ensureStaticSidebarLink\(sidebar, "overzicht", window\.SoftoraPremiumSidebarLinks\.getLeadRadarSidebarLink\(\), \["database"\]\)/);
  assert.match(themeSource, /pathname === "\/lead-radar"/);
  assert.match(themeSource, /if \(p === "\/lead-radar"\) return "lead_radar"/);
  assert.match(readRepoFile('assets/premium-sidebar-stability.js'), /path === "\/lead-radar"/);
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
    const googleAdsLink = pageSource.match(
      new RegExp(`<a [^>]*data-sidebar-key="ads_google"[^>]*>[\\s\\S]*?<\\/a>`)
    );
    assert.ok(googleAdsLink, `${relativePath} mist Google Ads sidebar-link`);
    assert.doesNotMatch(googleAdsLink[0], /sidebar-link--coming-soon/);
    assert.doesNotMatch(googleAdsLink[0], /sidebar-link-lock/);
    assert.doesNotMatch(googleAdsLink[0], /aria-disabled/);
    assert.doesNotMatch(googleAdsLink[0], /tabindex="-1"/);
    assert.doesNotMatch(pageSource, /data-sidebar-key="ads_trustoo"/);
    assert.doesNotMatch(pageSource, /premium-advertenties#trustoo/);
    assert.doesNotMatch(pageSource, /Snapchat/);
  }
});

test('Samenvatten staat als werkende beheerlink in de gedeelde premium-sidebar', () => {
  const themeSource = readRepoFile('assets/personnel-theme.js');
  const sidebarLinksSource = readRepoFile('assets/premium-sidebar-links.js');
  const pageSource = readRepoFile('premium-samenvatten.html');

  assert.match(themeSource, /if \(p\.indexOf\("\/premium-samenvatten"\) === 0\) return "summarize"/);
  assert.match(sidebarLinksSource, /function getSummarizeSidebarLink\(\)[\s\S]*key:\s*'summarize'[\s\S]*href:\s*'\/premium-samenvatten'[\s\S]*label:\s*'Samenvatten'/);
  assert.match(sidebarLinksSource, /Object\.freeze\(\{ getLeadRadarSidebarLink, getSummarizeSidebarLink \}\)/);
  assert.match(themeSource, /getMailboxSidebarLink\(\),\s*window\.SoftoraPremiumSidebarLinks\.getSummarizeSidebarLink\(\),/);
  assert.match(themeSource, /ensureStaticSidebarLink\(sidebar, "beheer", window\.SoftoraPremiumSidebarLinks\.getSummarizeSidebarLink\(\), \["websitegenerator", "seo", "qr_code", "packages"\]\)/);
  const comingSoonKeys = themeSource.match(/const PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
  assert.doesNotMatch(comingSoonKeys, /"summarize"/);
  assert.match(pageSource, /<title>Samenvatten – Softora\.nl<\/title>/);
  assert.match(pageSource, /data-sidebar-shell="canonical"/);
  assert.match(pageSource, /assets\/premium-sidebar-links\.js\?v=20260818a/);
  assert.match(pageSource, /assets\/personnel-theme\.js\?v=20260519b/);
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
  assert.match(themeJsSource, /return "ads_google";/);
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

test('premium instellingen centreert personeel PIN binnen de canonical shell', () => {
  const pageSource = readRepoFile('premium-instellingen.html');
  const layoutRule = pageSource.match(/\.dashboard-layout\s*\{[\s\S]*?\}/);
  const mainBootRule = pageSource.match(/main\.main\.is-premium-boot-host\s*\{[\s\S]*?\}/);
  const pinRule = pageSource.match(/#settings-screen-pin:not\(\[hidden\]\)\s*\{[\s\S]*?\}/);

  assert.ok(layoutRule, 'premium instellingen moet dashboard-layout styling houden');
  assert.match(layoutRule[0], /width:\s*100%;/);

  assert.ok(mainBootRule, 'premium instellingen moet boot-host styling houden');
  assert.match(
    mainBootRule[0],
    /flex:\s*0 0 calc\(100% - var\(--premium-sidebar-width,\s*320px\)\);/
  );

  assert.ok(pinRule, 'premium instellingen moet personeel PIN layoutregel houden');
  assert.match(pinRule[0], /position:\s*static;/);
  assert.match(pinRule[0], /width:\s*min\(1000px,\s*100%\);/);
  assert.match(pinRule[0], /margin:\s*0 auto;/);
  assert.match(pinRule[0], /background:\s*transparent;/);
  assert.doesNotMatch(pinRule[0], /position:\s*fixed;/);
  assert.doesNotMatch(pinRule[0], /\b(?:left|right|top|bottom):/);
});

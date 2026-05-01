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
  assert.match(themeSource, /--premium-sidebar-font-display:\s*'SoftoraSidebarOswald', 'Oswald', sans-serif;/);
  assert.match(themeSource, /\.sidebar-logo\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-display\) !important;[\s\S]*font-synthesis:\s*none !important;/);
  assert.match(themeSource, /\.sidebar-link \.sidebar-link-text\s*\{[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans\) !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\]\s*\{[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.2 !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-logo\s*\{[\s\S]*margin:\s*0 0 11px !important;[\s\S]*font-size:\s*25px !important;/);
  assert.match(themeSource, /\.sidebar\[data-static-sidebar="1"\] \.sidebar-link\s*\{[\s\S]*min-height:\s*0 !important;[\s\S]*font-size:\s*14px !important;[\s\S]*line-height:\s*1\.12 !important;/);
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
  assert.match(themeJsSource, /function initPremiumSidebarStabilityGuards\(\) \{/);
  assert.match(themeJsSource, /document\.addEventListener\("pointerdown", function \(event\) \{/);
  assert.match(themeJsSource, /window\.addEventListener\("focus", function \(\) \{\s*schedulePremiumSidebarStability\(\);/s);
  assert.match(themeJsSource, /const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set\(\["passwords"\]\);/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeJsSource, /premiumInitialSessionFetched/);
  assert.match(themeJsSource, /function stabilizePremiumStaticSidebar\(sidebar, activeKey\) \{/);
  assert.doesNotMatch(themeJsSource, /sidebar\.dataset\.staticSidebar === "1"\) \{\s*sidebar\.innerHTML/);
  assert.doesNotMatch(themeJsSource, /getWebsiteGeneratorLibrarySidebarLink/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Bibliotheek"/);
  assert.match(
    themeJsSource,
    /window\.SoftoraPersonnelTheme\.refreshPremiumStaticSidebarActiveState\s*=\s*refreshPremiumStaticSidebarActiveState/
  );
  assert.match(themeJsSource, /persistPremiumSidebarSessionSnapshot/);
  assert.match(themeJsSource, /buildSidebarProfileRenderKey/);
  assert.match(themeJsSource, /sidebar\.dataset\.sidebarProfileRenderKey === renderKey/);
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
  assert.match(prefillSource, /avatarEl\.replaceChildren\(\);/);
  assert.doesNotMatch(prefillSource, /avatarEl\.innerHTML\s*=/);
  assert.match(prefillSource, /data-sidebar-active-prefilled/);
  assert.match(htmlPagesSource, /PREMIUM_SIDEBAR_CRITICAL_HEAD_SNIPPET/);
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
  assert.match(pageSource, /softora-dashboard-boot-spin/);
  assert.match(pageSource, /data-dashboard-boot-loader="true"/);
  assert.match(pageSource, /releasePremiumDashboardBootShellAfterMinimum\(bootStartedAt, 1200\);/);
  assert.match(coreSource, /removeAttribute\('data-dashboard-boot-loading'\)/);
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

test('websitegenerator page loads website preview script via shared asset', () => {
  const pageSource = readRepoFile('premium-websitegenerator.html');
  assert.match(
    pageSource,
    /<script src="assets\/premium-websitegenerator\.js\?v=20260501a" defer><\/script>/,
    'premium-websitegenerator.html moet de website-generator script uit assets laden'
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

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
      asideMatch[1].matchAll(/href="([^"]+)" class="sidebar-link magnetic(?: active)?" data-sidebar-key="([^"]+)"/g),
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
  'premium-analytics.html',
  'premium-database.html',
  'premium-instellingen-personeel.html',
  'premium-klanten.html',
  'premium-mailbox.html',
  'premium-opdracht-dossier.html',
  'premium-vaste-lasten.html',
];

test('personnel theme canonical shell is explicitly opt-in', () => {
  const themeSource = readRepoFile('assets/personnel-theme.css');
  const themeJsSource = readRepoFile('assets/personnel-theme.js');
  const prefillSource = readRepoFile('assets/premium-sidebar-profile-prefill.js');

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
  assert.match(themeJsSource, /const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set\(\["passwords"\]\);/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeJsSource, /premiumInitialSessionFetched/);
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

test('static premium sidebars ship the websitedesign link in html', () => {
  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /data-sidebar-key="websitegenerator"/,
      `${relativePath} hoort Websitedesign direct in de sidebar html te hebben`
    );
    assert.match(
      pageSource,
      /<span class="sidebar-link-text">Websitedesign<\/span>/,
      `${relativePath} hoort de sidebarnaam Websitedesign te tonen`
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
        'websitegenerator:Websitedesign',
        'seo:SEO',
        'packages:Pakketten',
        "pdfs:PDF'S",
      ],
    },
    {
      label: 'Advertenties',
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
        'social_google:Google',
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
    assert.equal(linkTargets.social_google, '/premium-socialmedia#google');
    assert.equal(linkTargets.ads_linkedin, '/premium-advertenties#linkedin');
    assert.equal(linkTargets.social_linkedin, '/premium-socialmedia#linkedin');
    assert.doesNotMatch(pageSource, /Snapchat/);
  }
});

test('unified premium sidebar splits ad channels from social media channels', () => {
  const themeJsSource = readRepoFile('assets/personnel-theme.js');

  assert.match(themeJsSource, /sidebar-section-label">Advertenties</);
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
  assert.match(themeJsSource, /href:\s*"\/premium-socialmedia#google"[\s\S]*label:\s*"Google"/);
  assert.match(themeJsSource, /if \(hashRaw === "google"\) return "ads_google";/);
  assert.match(themeJsSource, /if \(p\.indexOf\("\/premium-socialmedia"\) === 0\) \{/);
  assert.match(themeJsSource, /if \(hashRaw === "google"\) return "social_google";/);
  assert.doesNotMatch(themeJsSource, /social_snapchat/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-advertenties#snapchat"/);
  assert.doesNotMatch(themeJsSource, /href:\s*"\/premium-socialmedia#snapchat"/);
  assert.doesNotMatch(themeJsSource, /label:\s*"Snapchat"/);
});

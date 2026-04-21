const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
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
  assert.match(themeJsSource, /const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set\(\["passwords", "settings"\]\);/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeJsSource, /premiumInitialSessionFetched/);
  assert.match(themeJsSource, /persistPremiumSidebarSessionSnapshot/);
  assert.match(themeJsSource, /buildSidebarProfileRenderKey/);
  assert.match(themeJsSource, /sidebar\.dataset\.sidebarProfileRenderKey === renderKey/);
  assert.match(themeSource, /\.sidebar-link \.sidebar-link-text[\s\S]*white-space:\s*nowrap !important;/);
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

test('static premium sidebars ship the websitegenerator link in html', () => {
  for (const relativePath of staticSidebarPages) {
    const pageSource = readRepoFile(relativePath);
    assert.match(
      pageSource,
      /data-sidebar-key="websitegenerator"/,
      `${relativePath} hoort Websitegenerator direct in de sidebar html te hebben`
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

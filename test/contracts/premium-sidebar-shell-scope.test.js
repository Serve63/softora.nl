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
  'premium-instellingen-personeel.html',
  'premium-klanten.html',
  'premium-mailbox.html',
  'premium-maandelijkse-kosten.html',
  'premium-opdracht-dossier.html',
  'premium-websitegenerator.html',
  'premium-websitepreview.html',
];

test('personnel theme canonical shell is explicitly opt-in', () => {
  const themeSource = readRepoFile('assets/personnel-theme.css');
  const themeJsSource = readRepoFile('assets/personnel-theme.js');

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
  assert.match(themeJsSource, /const PREMIUM_SIDEBAR_ADMIN_ONLY_KEYS = new Set\(\["passwords", "settings"\]\);/);
  assert.match(themeJsSource, /filterPremiumSidebarLinksForSession\(/);
  assert.match(themeJsSource, /syncPremiumSidebarAdminLinks\(/);
  assert.match(themeSource, /:root\[data-personnel-loading="true"\] \.sidebar-link\[data-sidebar-key="passwords"\],/);
  assert.match(themeSource, /:root\[data-personnel-loading="true"\] \.sidebar-link\[data-sidebar-key="settings"\] \{/);
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

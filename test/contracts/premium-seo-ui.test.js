const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium seo page shows unlocked prestaties dashboard in premium shell', () => {
  const filePath = path.join(__dirname, '../../premium-seo.html');
  const source = fs.readFileSync(filePath, 'utf8');
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-seo-performance.css'),
    'utf8'
  );
  const jsSource = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-seo-performance.js'),
    'utf8'
  );
  const drCssSource = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-seo-dr-rating.css'),
    'utf8'
  );

  assert.match(source, /assets\/premium-seo-performance\.css\?v=20260520b/);
  assert.match(source, /assets\/premium-seo-dr-rating\.css\?v=20260520a/);
  assert.match(source, /assets\/premium-seo-performance\.js\?v=20260520a/);
  assert.ok(
    source.indexOf('</style>') < source.indexOf('assets/premium-seo-performance.css?v=20260520b'),
    'dashboard CSS hoort na de legacy SEO-styles te laden zodat de 4-koloms layout wint'
  );
  assert.match(source, /<main class="main-content seo-performance-main">/);
  assert.match(source, /<span class="topbar-title">Prestaties<\/span>/);
  assert.match(source, /Laatste update: 4 uur geleden/);
  assert.match(source, /<button class="filter-pill active" type="button">3 maanden<\/button>/);
  assert.match(source, /<span class="metric-label">Totaal klikken<\/span>/);
  assert.match(source, /<span class="metric-label">Totaal vertoningen<\/span>/);
  assert.match(source, /<span class="metric-label">Gemiddelde CTR<\/span>/);
  assert.match(source, /<span class="metric-label">Gemiddelde positie<\/span>/);
  assert.match(source, /<div class="authority-card" aria-label="DR backlink rating 50 procent">/);
  assert.match(source, /<h2 class="authority-title">DR Backlink Rating<\/h2>/);
  assert.match(source, /<div class="dr-rating-ring" data-rating="50">/);
  assert.match(source, /<span class="dr-rating-value">50%<\/span>/);
  assert.match(source, /<div class="chart-legend"><span class="legend-dot c1"><\/span>Klikken<\/div>/);
  assert.match(source, /<button class="chart-toggle active" type="button">Dagelijks<\/button>/);
  assert.match(source, /<div class="chart-date-label">18-05-2026<\/div>/);
  assert.match(source, /<button class="tab active" type="button">Zoekopdrachten<\/button>/);
  assert.match(source, /<span class="th-query">Meest uitgevoerde zoekopdracht<\/span>/);
  assert.match(source, /<div class="empty-title">Geen gegevens gevonden<\/div>/);
  assert.match(cssSource, /\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.seo-performance-main/);
  assert.match(cssSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(cssSource, /@media \(max-width: 1180px\)/);
  assert.match(cssSource, /@media \(max-width: 900px\)[\s\S]*display: block;[\s\S]*margin-left: 0 !important;/);
  assert.match(cssSource, /@media \(max-width: 760px\)/);
  assert.match(jsSource, /document\.querySelectorAll\('\.filter-pill:not\(\.secondary\)'/);
  assert.match(jsSource, /document\.querySelectorAll\('\.chart-toggle'\)/);
  assert.match(jsSource, /document\.querySelectorAll\('\.tab'\)/);
  assert.match(drCssSource, /\.authority-card/);
  assert.match(drCssSource, /\.dr-rating-ring/);
  assert.match(drCssSource, /stroke-dasharray: 50 100;/);
  assert.doesNotMatch(source, /id="contentLockOverlay"/);
  assert.doesNotMatch(source, /data-seo-lock-input/);
  assert.doesNotMatch(source, /data-seo-lock-submit/);
  assert.doesNotMatch(source, /CONTENT_LOCK_CODE/);
  assert.doesNotMatch(source, /onclick="/);
  assert.doesNotMatch(source, /class="export-btn"/);
  assert.doesNotMatch(source, /Exporteren/);
  assert.doesNotMatch(source, /Zoektype: Web/);
  assert.doesNotMatch(source, /Filter toevoegen/);
  assert.doesNotMatch(source, /class="filter-divider"/);
  assert.doesNotMatch(source, /class="filter-add"/);

  const seoLink = source.match(/<a href="\/premium-seo"[^>]*data-sidebar-key="seo"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(seoLink, 'SEO hoort als sidebar-link in de pagina te staan');
  assert.match(seoLink[0], /class="sidebar-link magnetic active"/);
  assert.match(seoLink[0], /<span class="sidebar-link-text">SEO<\/span>/);
  assert.doesNotMatch(seoLink[0], /sidebar-link--coming-soon/);
  assert.doesNotMatch(seoLink[0], /sidebar-link-lock/);
  assert.doesNotMatch(seoLink[0], /aria-disabled/);
  assert.doesNotMatch(seoLink[0], /tabindex="-1"/);
});

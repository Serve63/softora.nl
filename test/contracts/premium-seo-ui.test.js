const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium seo page shows unlocked prestaties dashboard in premium shell', () => {
  const filePath = path.join(__dirname, '../../premium-seo.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /<main class="main-content seo-performance-main">/);
  assert.match(source, /<span class="topbar-title">Prestaties<\/span>/);
  assert.match(source, /Laatste update: 4 uur geleden/);
  assert.match(source, /<button class="filter-pill active" type="button">3 maanden<\/button>/);
  assert.match(source, /<button class="filter-pill secondary" type="button">Zoektype: Web<\/button>/);
  assert.match(source, /<button class="filter-add" type="button">/);
  assert.match(source, /<span class="metric-label">Totaal klikken<\/span>/);
  assert.match(source, /<span class="metric-label">Totaal vertoningen<\/span>/);
  assert.match(source, /<span class="metric-label">Gemiddelde CTR<\/span>/);
  assert.match(source, /<span class="metric-label">Gemiddelde positie<\/span>/);
  assert.match(source, /<div class="chart-legend"><span class="legend-dot c1"><\/span>Klikken<\/div>/);
  assert.match(source, /<button class="chart-toggle active" type="button">Dagelijks<\/button>/);
  assert.match(source, /<div class="chart-date-label">18-05-2026<\/div>/);
  assert.match(source, /<button class="tab active" type="button">Zoekopdrachten<\/button>/);
  assert.match(source, /<span class="th-query">Meest uitgevoerde zoekopdracht<\/span>/);
  assert.match(source, /<div class="empty-title">Geen gegevens gevonden<\/div>/);
  assert.match(source, /\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.seo-performance-main/);
  assert.match(source, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(source, /@media \(max-width: 1180px\)/);
  assert.match(source, /@media \(max-width: 900px\)[\s\S]*display: block;[\s\S]*margin-left: 0 !important;/);
  assert.match(source, /@media \(max-width: 760px\)/);
  assert.match(source, /document\.querySelectorAll\('\.filter-pill:not\(\.secondary\)'/);
  assert.match(source, /document\.querySelectorAll\('\.chart-toggle'\)/);
  assert.match(source, /document\.querySelectorAll\('\.tab'\)/);
  assert.doesNotMatch(source, /id="contentLockOverlay"/);
  assert.doesNotMatch(source, /data-seo-lock-input/);
  assert.doesNotMatch(source, /data-seo-lock-submit/);
  assert.doesNotMatch(source, /CONTENT_LOCK_CODE/);
  assert.doesNotMatch(source, /onclick="/);

  const seoLink = source.match(/<a href="\/premium-seo"[^>]*data-sidebar-key="seo"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(seoLink, 'SEO hoort als sidebar-link in de pagina te staan');
  assert.match(seoLink[0], /class="sidebar-link magnetic active"/);
  assert.match(seoLink[0], /<span class="sidebar-link-text">SEO<\/span>/);
  assert.doesNotMatch(seoLink[0], /sidebar-link--coming-soon/);
  assert.doesNotMatch(seoLink[0], /sidebar-link-lock/);
  assert.doesNotMatch(seoLink[0], /aria-disabled/);
  assert.doesNotMatch(seoLink[0], /tabindex="-1"/);
});

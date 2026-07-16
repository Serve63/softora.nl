const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium seo page provides a live decision console in the premium shell', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../premium-seo.html'), 'utf8');
  const cssSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-seo-performance.css'), 'utf8');
  const jsSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-seo-performance.js'), 'utf8');

  assert.match(source, /assets\/premium-seo-performance\.css\?v=20260716a/);
  assert.match(source, /assets\/premium-seo-performance\.js\?v=20260716a/);
  assert.ok(
    source.indexOf('</style>') < source.indexOf('assets/premium-seo-performance.css?v=20260716a'),
    'console CSS hoort na de legacy SEO-styles te laden'
  );
  assert.match(source, /<main class="main-content seo-performance-main">/);
  assert.match(source, /<h1>SEO Console<\/h1>/);
  assert.match(source, /Google Search Console &amp; site-audit/);
  assert.match(source, /data-seo-performance-status/);
  assert.match(source, /data-seo-last-updated>Live data laden\.\.\.<\/span>/);
  assert.match(source, /data-seo-refresh/);
  assert.match(source, /data-seo-property>softora\.nl/);
  assert.match(source, /data-seo-days="90">3 maanden<\/button>/);

  ['clicks', 'impressions', 'ctr', 'position'].forEach((metric) => {
    assert.match(source, new RegExp(`data-seo-metric="${metric}"`));
    assert.match(source, new RegExp(`data-seo-delta="${metric}"`));
  });

  assert.match(source, /<h2>Prestatietrend<\/h2>/);
  assert.match(source, /data-seo-chart/);
  assert.match(source, /data-seo-date-label>Laatste beschikbare dagen<\/div>/);
  assert.match(source, /<h2>Kansen &amp; winnaars<\/h2>/);
  assert.match(source, /data-seo-opportunities/);
  assert.match(source, /<h2>Technische SEO-gezondheid<\/h2>/);
  assert.match(source, /data-seo-health-score/);
  assert.match(source, /data-seo-health-metrics/);
  assert.match(source, /<h2>Prioriteiten<\/h2>/);
  assert.match(source, /data-seo-actions/);
  assert.match(source, /data-seo-action-count/);
  assert.match(source, /data-seo-table-search/);
  assert.match(source, /data-seo-table-tab="queries">Zoekwoorden<\/button>/);
  assert.match(source, /data-seo-table-label>Zoekwoord<\/span>/);
  assert.match(source, /<span class="th-num">CTR<\/span>/);
  assert.match(source, /<span class="th-num">Positie<\/span>/);
  assert.match(source, /data-seo-table-body/);

  assert.match(cssSource, /\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.seo-performance-main/);
  assert.match(cssSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(cssSource, /\.seo-overview-grid/);
  assert.match(cssSource, /\.seo-health-grid/);
  assert.match(cssSource, /\.seo-performance-chart__line--clicks/);
  assert.match(cssSource, /@media \(max-width: 1160px\)/);
  assert.match(cssSource, /@media \(max-width: 900px\)[\s\S]*display: block;[\s\S]*margin-left: 0 !important;/);
  assert.match(cssSource, /@media \(max-width: 720px\)/);

  assert.match(jsSource, /\/api\/seo\/search-console-performance/);
  assert.match(jsSource, /\/api\/seo\/site-audit/);
  assert.match(jsSource, /renderMetrics/);
  assert.match(jsSource, /renderOpportunities/);
  assert.match(jsSource, /renderAudit/);
  assert.match(jsSource, /renderActions/);
  assert.match(jsSource, /data-seo-table-search/);
  assert.match(jsSource, /data-seo-refresh/);

  assert.doesNotMatch(source, /premium-seo-dr-rating\.css/);
  assert.doesNotMatch(source, /DR Backlink Rating/);
  assert.doesNotMatch(source, /data-rating="50"/);
  assert.doesNotMatch(source, /voorbeelddata|demodata/);
  assert.doesNotMatch(source, /id="contentLockOverlay"|CONTENT_LOCK_CODE/);
  assert.doesNotMatch(source, /onclick="/);

  const seoLink = source.match(/<a href="\/premium-seo"[^>]*data-sidebar-key="seo"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(seoLink, 'SEO hoort als sidebar-link in de pagina te staan');
  assert.match(seoLink[0], /class="sidebar-link magnetic active"/);
  assert.doesNotMatch(seoLink[0], /sidebar-link--coming-soon|sidebar-link-lock|aria-disabled|tabindex="-1"/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

test('premium flynow gebruikt de deals-layout binnen de premium sidebar', () => {
  const html = fs.readFileSync(path.join(root, 'premium-flynow.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/flynow.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'assets/flynow.js'), 'utf8');

  assert.match(html, /<title>Mijn Beste Deals - Fly Now<\/title>/);
  assert.match(html, /data-flynow-page/);
  assert.match(html, /<div class="dashboard-layout flynow-layout" data-sidebar-shell="canonical">/);
  assert.match(html, /<aside class="sidebar" data-flynow-sidebar-host="1" aria-label="Premium navigatie"><\/aside>/);
  assert.match(html, /<main class="main-content flynow-main">/);
  assert.match(html, /href="\/assets\/personnel-theme\.css\?v=20260519a"/);
  assert.match(html, /src="\/assets\/personnel-theme\.js\?v=20260519a" defer/);
  assert.match(html, /href="\/assets\/flynow\.css\?v=20260519c"/);
  assert.match(html, /src="\/assets\/flynow\.js\?v=20260519c" defer/);
  assert.match(html, /<span class="deals-logo-text">My Deals<\/span>/);
  assert.match(html, /data-flynow-tab="zon"/);
  assert.match(html, /data-flynow-tab="snow"/);
  assert.match(html, /data-flynow-panel="zon"/);
  assert.match(html, /data-flynow-panel="snow"/);
  assert.match(html, /Top Zondeals/);
  assert.match(html, /Top Ski Deals/);
  assert.match(html, /deal-photo--mallorca/);
  assert.match(html, /deal-photo--zermatt/);
  assert.doesNotMatch(html, /bg-canvas/);
  assert.doesNotMatch(html, /collage-btn/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/);
  assert.doesNotMatch(html, /\son(?:click|input|change|error|submit)=/);

  assert.match(js, /function setActiveDealPanel\(mode\)/);
  assert.match(js, /function lockFlyNowSidebarShell\(\)/);
  assert.match(js, /data-static-sidebar", "1"/);
  assert.match(js, /data-flynow-type/);
  assert.match(js, /data-flynow-tab/);
  assert.match(js, /data-flynow-panel/);
  assert.match(js, /function bindFilters\(\)/);
  assert.match(js, /function showToast\(message\)/);
  assert.match(js, /function bindScrollButtons\(\)/);
  assert.doesNotMatch(js, /images\.unsplash\.com/);
  assert.doesNotMatch(js, /spawnParticles/);

  const zonFiles = new Set(css.match(/\/assets\/flynow\/flynow-zon-photo-\d+\.jpg/g) || []);
  const sneeuwFiles = new Set(css.match(/\/assets\/flynow\/flynow-sneeuw-photo-\d+\.jpg/g) || []);
  assert.equal(zonFiles.size, 6);
  assert.equal(sneeuwFiles.size, 6);

  assert.match(css, /:where\(\s*body\[data-flynow-page\] \.flynow-main/);
  assert.match(css, /body\[data-flynow-page\] \.flynow-main :is\(button,\s*a\)\s*\{[\s\S]*appearance:\s*none/);
  assert.match(css, /body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*box-sizing:\s*border-box !important;[\s\S]*z-index:\s*120 !important/);
  assert.match(css, /body\[data-flynow-page\] \.sidebar \*,body\[data-flynow-page\] \.sidebar \*::before,body\[data-flynow-page\] \.sidebar \*::after\s*\{[\s\S]*box-sizing:\s*border-box !important/);
  assert.match(css, /body\[data-flynow-page\]\s+\.dashboard-layout\[data-sidebar-shell="canonical"\]\s*>\s*main\.flynow-main\s*\{[\s\S]*padding:\s*0 !important/);
  assert.match(css, /body\[data-flynow-page\]\s+\.dashboard-layout\[data-sidebar-shell="canonical"\]\s*>\s*main\.flynow-main\s*\{[\s\S]*margin-top:\s*0 !important/);
  assert.match(css, /@media \(min-width:\s*901px\)\s*\{[\s\S]*body\[data-flynow-page\]\s+\.dashboard-layout\[data-sidebar-shell="canonical"\]\s*>\s*main\.flynow-main\s*\{[\s\S]*margin-left:\s*var\(--premium-sidebar-width,320px\) !important/);
  assert.match(css, /@media \(min-width:\s*901px\)\s*\{[\s\S]*body\[data-flynow-page\] \.sidebar\s*\{[\s\S]*height:\s*100vh !important/);
  assert.doesNotMatch(css, /body\[data-flynow-page\]\s+\.sidebar-logo\s*\{[\s\S]*font-size:\s*24px !important/);
  assert.doesNotMatch(css, /body\[data-flynow-page\]\s+\.sidebar-link\s*\{[\s\S]*font-size:\s*12\.5px !important/);
  assert.doesNotMatch(css, /body\[data-flynow-page\]\s+\.sidebar-footer\s+\.sidebar-user\s+\.sidebar-user-role\s*\{[\s\S]*display:\s*none !important/);
  assert.match(css, /\.deals-header\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(css, /\.deals-tab\.active\s*\{[\s\S]*border-color:\s*var\(--flynow-cream\)/);
  assert.match(css, /body\[data-flynow-page\] \.flynow-main \.hero-deal \.hero-title\s*\{[\s\S]*color:\s*var\(--flynow-white\) !important/);
  assert.match(css, /\.hero-deal--zon\s*\{background-image:\s*url\("\/assets\/flynow\/flynow-zon-photo-1\.jpg"\)/);
  assert.match(css, /\.deal-photo--mallorca\s*\{\s*background-image:\s*url\("\/assets\/flynow\/flynow-zon-photo-5\.jpg"\)/);
  assert.match(css, /\.deal-photo--zermatt\s*\{\s*background-image:\s*url\("\/assets\/flynow\/flynow-sneeuw-photo-1\.jpg"\)/);
  assert.doesNotMatch(css, /flynow-particle/);
  assert.doesNotMatch(css, /flynowDrift/);
  assert.match(css, /\.deals-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(230px,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.hero-deal\s*\{[\s\S]*flex-direction:\s*column/);
});

test('premium flynow lokale plekfoto assets dekken alle collage-slots', () => {
  [
    'flynow-zon-photo-1.jpg',
    'flynow-zon-photo-2.jpg',
    'flynow-zon-photo-3.jpg',
    'flynow-zon-photo-4.jpg',
    'flynow-zon-photo-5.jpg',
    'flynow-zon-photo-6.jpg',
    'flynow-zon-photo-7.jpg',
    'flynow-zon-photo-8.jpg',
    'flynow-zon-photo-9.jpg',
    'flynow-zon-photo-10.jpg',
    'flynow-sneeuw-photo-1.jpg',
    'flynow-sneeuw-photo-2.jpg',
    'flynow-sneeuw-photo-3.jpg',
    'flynow-sneeuw-photo-4.jpg',
    'flynow-sneeuw-photo-5.jpg',
    'flynow-sneeuw-photo-6.jpg',
    'flynow-sneeuw-photo-7.jpg',
    'flynow-sneeuw-photo-8.jpg',
    'flynow-sneeuw-photo-9.jpg',
  ].forEach((fileName) => {
    const source = fs.readFileSync(path.join(root, 'assets/flynow', fileName));
    assert.equal(source[0], 0xff);
    assert.equal(source[1], 0xd8);
    assert.equal(source[2], 0xff);
  });
});

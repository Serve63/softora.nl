const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

test('premium flynow gebruikt losse assets en lokale reisfoto\'s voor collage en bestemmingen', () => {
  const html = fs.readFileSync(path.join(root, 'premium-flynow.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/flynow.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'assets/flynow.js'), 'utf8');

  assert.match(html, /<title>FLYNOW - AI Trips<\/title>/);
  assert.match(html, /data-flynow-page/);
  assert.match(html, /<div class="dashboard-layout flynow-layout" data-sidebar-shell="canonical">/);
  assert.match(html, /<aside class="sidebar" aria-label="Premium navigatie"><\/aside>/);
  assert.match(html, /<main class="main-content flynow-main">/);
  assert.match(html, /href="\/assets\/personnel-theme\.css\?v=20260502a"/);
  assert.match(html, /src="\/assets\/personnel-theme\.js\?v=20260502a" defer/);
  assert.match(html, /href="\/assets\/flynow\.css\?v=20260509b"/);
  assert.match(html, /src="\/assets\/flynow\.js\?v=20260510a" defer/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/);
  assert.doesNotMatch(html, /\son(?:click|input|change|error|submit)=/);

  assert.match(js, /DESTINATION_PHOTOS/);
  assert.match(js, /COLLAGE_PHOTOS/);
  assert.match(js, /\/assets\/flynow\/flynow-zon-photo-1\.jpg/);
  assert.match(js, /\/assets\/flynow\/flynow-zon-photo-10\.jpg/);
  assert.match(js, /\/assets\/flynow\/flynow-sneeuw-photo-1\.jpg/);
  assert.match(js, /\/assets\/flynow\/flynow-sneeuw-photo-9\.jpg/);
  assert.match(js, /data-flynow-type/);
  assert.match(js, /window\.open\('https:\/\/www\.google\.com\/travel\/search\?q='/);
  assert.doesNotMatch(js, /images\.unsplash\.com/);

  const zonFiles = new Set(js.match(/\/assets\/flynow\/flynow-zon-photo-\d+\.jpg/g) || []);
  const sneeuwFiles = new Set(js.match(/\/assets\/flynow\/flynow-sneeuw-photo-\d+\.jpg/g) || []);
  assert.equal(zonFiles.size, 10);
  assert.equal(sneeuwFiles.size, 9);

  assert.match(css, /body\[data-flynow-page\] \.flynow-main/);
  assert.match(css, /body\[data-flynow-page\] \.sidebar\{[\s\S]*z-index:120 !important/);
  assert.match(css, /@media \(min-width:761px\)\{[\s\S]*\.bg-canvas\{left:var\(--premium-sidebar-width,320px\)\}/);
  assert.match(css, /\.flynow-nav\{left:var\(--premium-sidebar-width,320px\)\}/);
  assert.match(css, /\.trips-grid\{[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:1100px\)\{[\s\S]*\.trips-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:760px\)\{[\s\S]*\.trips-grid\{grid-template-columns:1fr\}/);
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

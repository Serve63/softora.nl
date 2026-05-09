const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

test('premium flynow gebruikt losse assets en lokale gegenereerde reisbeelden', () => {
  const html = fs.readFileSync(path.join(root, 'premium-flynow.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/flynow.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'assets/flynow.js'), 'utf8');

  assert.match(html, /<title>FLYNOW - AI Trips<\/title>/);
  assert.match(html, /data-flynow-page/);
  assert.match(html, /href="\/assets\/flynow\.css\?v=20260509a"/);
  assert.match(html, /src="\/assets\/flynow\.js\?v=20260509a" defer/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/);
  assert.doesNotMatch(html, /\son(?:click|input|change|error|submit)=/);

  assert.match(js, /GENERATED_PHOTOS/);
  assert.match(js, /\/assets\/flynow\/flynow-zon-1\.svg/);
  assert.match(js, /\/assets\/flynow\/flynow-sneeuw-1\.svg/);
  assert.match(js, /data-flynow-type/);
  assert.match(js, /window\.open\('https:\/\/www\.google\.com\/travel\/search\?q='/);
  assert.doesNotMatch(js, /images\.unsplash\.com/);

  assert.match(css, /\.trips-grid\{[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:1100px\)\{[\s\S]*\.trips-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:760px\)\{[\s\S]*\.trips-grid\{grid-template-columns:1fr\}/);
});

test('premium flynow gegenereerde beelden zijn lokale svg assets', () => {
  [
    'flynow-zon-1.svg',
    'flynow-zon-2.svg',
    'flynow-zon-3.svg',
    'flynow-zon-4.svg',
    'flynow-sneeuw-1.svg',
    'flynow-sneeuw-2.svg',
    'flynow-sneeuw-3.svg',
    'flynow-sneeuw-4.svg',
  ].forEach((fileName) => {
    const source = fs.readFileSync(path.join(root, 'assets/flynow', fileName), 'utf8');
    assert.match(source, /^<svg /);
    assert.match(source, /<filter id="grain">/);
  });
});

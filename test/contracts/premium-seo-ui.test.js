const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium seo NL UI: tabs, paginas, blogcampagne', () => {
  const filePath = path.join(__dirname, '../../premium-seo.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /<button class="tab active" onclick="switchTab\('scan', this\)">SEO Scan<\/button>\s*<button class="tab" onclick="switchTab\('paginas', this\)">Pagina's<\/button>\s*<button class="tab" onclick="switchTab\('productpaginas', this\)">Productpagina's<\/button>\s*<button class="tab" onclick="switchTab\('blogs', this\)">Blogs<\/button>\s*<button class="tab" onclick="switchTab\('analytics', this\)">Google Analytics<\/button>/
  );
  assert.match(source, /<div class="tab-panel" id="tab-productpaginas">/);
  assert.match(source, /<div class="tab-panel" id="tab-analytics">/);
  assert.doesNotMatch(source, /id="tab-keywords"/);
  assert.doesNotMatch(source, /switchTab\('keywords'/);
  assert.match(source, /<div class="tab-panel" id="tab-paginas">/);
  assert.match(source, /id="seo-pages-root"/);
  assert.match(source, /id="home-meta-title"/);
  assert.doesNotMatch(source, /id="btn-all"/);
  assert.doesNotMatch(source, /function optimiseAllPages/);
  assert.match(source, /function optimisePage\(/);
  assert.match(source, /Pagina optimaliseren/);
  assert.match(source, /<div class="tab-panel" id="tab-blogs">/);
  assert.match(source, /id="blog-campaign-wrap"/);
  assert.match(source, /id="blog-word-count"/);
  assert.match(source, /Campagne online zetten/);
  assert.match(source, /activateBlogCampaign\(\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium seo toont blogs-tab direct na keywords met eigen paneel', () => {
  const filePath = path.join(__dirname, '../../premium-seo.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /<button class="tab active" onclick="switchTab\('scan', this\)">SEO Scan<\/button>\s*<button class="tab" onclick="switchTab\('paginas', this\)">Pagina's<\/button>\s*<button class="tab" onclick="switchTab\('keywords', this\)">Keywords<\/button>\s*<button class="tab" onclick="switchTab\('blogs', this\)">Blogs<\/button>/
  );
  assert.match(source, /<div class="tab-panel" id="tab-paginas">/);
  assert.match(source, /id="seo-pages-root"/);
  assert.match(source, /id="home-meta-title"/);
  assert.match(source, /function optimiseAllPages\(\)/);
  assert.match(source, /<div class="tab-panel" id="tab-blogs">/);
  assert.match(source, /id="blog-campaign-wrap"/);
  assert.match(source, /id="blog-word-count"/);
  assert.match(source, /Campagne online zetten/);
  assert.match(source, /activateBlogCampaign\(\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium kladblok gebruikt dezelfde layout-ruggengraat en titelmaat als dashboard', () => {
  const pagePath = path.join(__dirname, '../../premium-kladblok.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /\.sidebar\s*\{[\s\S]*width:\s*280px;[\s\S]*height:\s*100vh;/s);
  assert.match(pageSource, /\.main-content\s*\{[\s\S]*margin-left:\s*280px;[\s\S]*width:\s*calc\(100% - 280px\);[\s\S]*padding:\s*3rem 3rem 1\.8rem;/s);
  assert.match(pageSource, /\.notepad-shell\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*none;[\s\S]*margin:\s*0;/s);
  assert.match(pageSource, /\.page-title\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;[\s\S]*font-size:\s*2rem;[\s\S]*letter-spacing:\s*0\.02em;/s);
  assert.match(pageSource, /\.page-subtitle\s*\{[\s\S]*font-size:\s*0\.9rem;[\s\S]*color:\s*var\(--text-tertiary\);/s);
  assert.match(pageSource, /<h1 class="page-title">Kladblok<\/h1>/);
  assert.match(pageSource, /<p class="page-subtitle">Typ hier je losse notities\.<\/p>/);
});

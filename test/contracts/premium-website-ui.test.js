const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium website over-ons paneel gebruikt dezelfde accentrand-taal als wat we bouwen', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /<div class="content-side about-panel fade-up">/);
  assert.match(
    source,
    /\.content-side\.about-panel\s*\{[\s\S]*border:\s*1px solid var\(--accent\);[\s\S]*border-top:\s*3px solid var\(--accent\);[\s\S]*box-shadow:\s*0 0 0 1px var\(--accent\);[\s\S]*clip-path:\s*polygon\(0 0,\s*calc\(100% - 20px\) 0,\s*100% 20px,\s*100% 100%,\s*20px 100%,\s*0 calc\(100% - 20px\)\);/s
  );
});

test('premium website werkwijze stats gebruiken een vaste paarse lijn zonder hover-effect', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /\.stat-item\s*\{[\s\S]*border-left:\s*4px solid var\(--accent\);/s
  );
  assert.doesNotMatch(source, /\.stat-item::before\s*\{/);
  assert.doesNotMatch(source, /\.stat-item:hover\s*\{/);
  assert.doesNotMatch(source, /\.stat-item:hover::before\s*\{/);
  assert.doesNotMatch(source, /\.stat-item:hover \.stat-number\s*\{/);
});

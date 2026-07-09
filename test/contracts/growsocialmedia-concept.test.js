const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'growsocialmedia-concept.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'growsocialmedia-concept.css'), 'utf8');

test('GrowSocial concept is an isolated, responsive local page', () => {
  assert.match(html, /<html lang="nl">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /href="\/assets\/growsocialmedia-concept\.css\?v=\d+[a-z]"/);
  assert.match(html, /id="cases"/);
  assert.match(html, /id="contact"/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('GrowSocial concept only references bundled image assets', () => {
  const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(imageSources.length >= 10);
  for (const source of imageSources) {
    assert.match(source, /^\/assets\/growsocialmedia\//);
    assert.ok(fs.existsSync(path.join(root, source.slice(1))), `missing asset: ${source}`);
  }
});

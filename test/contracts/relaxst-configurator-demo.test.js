const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'relaxst-configurator-demo.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/relaxst-configurator-demo.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/relaxst-configurator-demo.js'), 'utf8');

test('Relaxst demo keeps the configurator as a self-contained public page', () => {
  assert.match(html, /<title>Stel jouw ideale relaxstoel samen \| Relaxst<\/title>/);
  assert.match(html, /href="\/assets\/relaxst-configurator-demo\.css\?v=20260825-5"/);
  assert.match(html, /src="\/assets\/relaxst-configurator-demo\.js"/);
  assert.match(html, /data-step-target="1"/);
  assert.match(html, /data-step-target="5"/);
  assert.match(html, /Interactieve conceptdemo/);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /id="benefits"/);
  assert.doesNotMatch(html, /<footer\b/i);
  assert.doesNotMatch(html, /Een stoel die klopt|Geen verrassingen|Altijd persoonlijk advies/);
  assert.doesNotMatch(html, /Kies stap voor stap het model/);
});

test('Relaxst demo exposes the promised product choices and live price logic', () => {
  assert.match(script, /const MODELS =/);
  assert.match(script, /comfora:/);
  assert.match(script, /udenhout:/);
  assert.match(script, /zeus:/);
  assert.match(script, /const UPHOLSTERY =/);
  assert.match(script, /const MECHANISMS =/);
  assert.match(script, /function totalPrice\(\)/);
  assert.match(script, /Plan gratis zitadvies/);
});

test('Relaxst demo includes responsive and accessible interaction states', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /white-space: nowrap/);
  assert.match(css, /white-space: normal/);
  assert.match(css, /\.hero \{[\s\S]*?min-height: 300px;[\s\S]*?align-items: center;/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<dialog id="success-dialog">/);
});

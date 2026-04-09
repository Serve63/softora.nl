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

  assert.match(source, /4-8<span style="font-size: 1\.5rem; color: var\(--text-tertiary\);"> weken<\/span>/);
  assert.match(
    source,
    /\.stat-item\s*\{[\s\S]*border-left:\s*4px solid var\(--accent\);/s
  );
  assert.doesNotMatch(source, /\.stat-item::before\s*\{/);
  assert.doesNotMatch(source, /\.stat-item:hover\s*\{/);
  assert.doesNotMatch(source, /\.stat-item:hover::before\s*\{/);
  assert.doesNotMatch(source, /\.stat-item:hover \.stat-number\s*\{/);
});

test('premium website toont een speelse krulpijl van hero richting wat we bouwen', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /<div class="diensten-arrow-wrap" aria-hidden="true">/);
  assert.match(source, /<svg class="diensten-arrow-svg" viewBox="0 0 560 240"/);
  assert.match(source, /\.diensten-arrow-wrap\s*\{[\s\S]*left:\s*clamp\(-6\.5rem,\s*-2vw,\s*-2\.25rem\);[\s\S]*top:\s*-9\.5rem;[\s\S]*width:\s*min\(44vw,\s*540px\);[\s\S]*pointer-events:\s*none;/s);
  assert.match(source, /\.diensten-arrow-path,\s*\.diensten-arrow-head\s*\{[\s\S]*stroke:\s*var\(--accent\);/s);
  assert.match(source, /@media \(max-width: 1024px\)\s*\{[\s\S]*\.diensten-arrow-wrap \{ display: none; \}/s);
});

test('premium website heeft geen losse CTA-sectie meer en laat contactlinks op de footer landen', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /<section id="contact" class="cta-section">/);
  assert.doesNotMatch(source, /\.cta-section\s*\{/);
  assert.doesNotMatch(source, /Klaar voor de <span class="text-accent">volgende stap<\/span>\?/);
  assert.match(source, /<footer id="contact">/);
  assert.match(source, /\.footer-shell\s*\{[\s\S]*max-width:\s*900px;[\s\S]*margin:\s*0 auto;/s);
  assert.match(source, /<div class="footer-shell">/);
  assert.match(source, /<a href="#contact" class="magnetic-btn magnetic">Start Project<\/a>/);
});

test('premium website gebruikt een compactere herohoogte zodat de foto minder ver doorloopt', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /\.hero\s*\{[\s\S]*min-height:\s*clamp\(680px,\s*86vh,\s*860px\);/s
  );
  assert.match(
    source,
    /\.hero-image\s*\{[\s\S]*height:\s*clamp\(680px,\s*86vh,\s*860px\);/s
  );
  assert.match(
    source,
    /\.hero-image img\s*\{[\s\S]*object-position:\s*center 24%;/s
  );
  assert.match(
    source,
    /src="assets\/hero-workspace-1254\.jpg\?v=20260409a"[\s\S]*srcset="assets\/hero-workspace-640\.jpg\?v=20260409a 640w,\s*assets\/hero-workspace-960\.jpg\?v=20260409a 960w,\s*assets\/hero-workspace-1254\.jpg\?v=20260409a 1254w"/s
  );
  assert.match(source, /\.perf-deferred-section\s*\{[\s\S]*content-visibility:\s*auto;[\s\S]*contain-intrinsic-size:\s*920px;/s);
  assert.match(source, /<section id="diensten" class="perf-deferred-section"/);
});

test('premium website whatsapp-widget gebruikt een verfijnde stijl en opent het juiste nummer', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /\.whatsapp-widget-label\s*\{/);
  assert.match(source, /box-shadow:\s*0 16px 34px rgba\(20, 22, 34, 0\.12\);/);
  assert.match(source, /backdrop-filter:\s*blur\(18px\);/);
  assert.match(
    source,
    /\.whatsapp-widget-btn\s*\{[\s\S]*width:\s*64px;[\s\S]*height:\s*64px;[\s\S]*background:\s*linear-gradient\(145deg,\s*#30df6c 0%,\s*#19bf57 100%\);/s
  );
  assert.match(source, /\.whatsapp-widget-btn::before\s*\{/);
  assert.match(
    source,
    /href="https:\/\/wa\.me\/31629917185\?text=Hoi%20Softora%2C%20ik%20wil%20graag%20meer%20informatie\."/
  );
  assert.match(source, /aria-label="Open WhatsApp chat met Softora op 06 29 91 71 85"/);
});

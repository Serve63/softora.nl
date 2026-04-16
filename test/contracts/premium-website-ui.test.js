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
    /\.content-side\.about-panel\s*\{[\s\S]*width:\s*calc\(100% \+ var\(--content-overlap\)\);[\s\S]*margin-left:\s*calc\(-1 \* var\(--content-overlap\)\);[\s\S]*padding-left:\s*calc\(var\(--content-panel-padding-x\) \+ var\(--content-overlap\)\);[\s\S]*border:\s*1px solid var\(--accent\);[\s\S]*border-top:\s*3px solid var\(--accent\);[\s\S]*box-shadow:\s*0 0 0 1px var\(--accent\);[\s\S]*clip-path:\s*polygon\(0 0,\s*calc\(100% - 20px\) 0,\s*100% 20px,\s*100% 100%,\s*20px 100%,\s*0 calc\(100% - 20px\)\);/s
  );
  assert.match(source, /\.content-side\s*\{[\s\S]*--content-panel-padding-x:\s*4\.25rem;/s);
  assert.doesNotMatch(source, /\.content-side::before\s*\{/);
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

test('premium website heeft geen decoratieve diensten-pijl meer', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /<div class="card-number">01<\/div>\s*<h3>Website's<\/h3>\s*<p>Je hebt één kans om een eerste indruk te maken\./
  );
  assert.match(
    source,
    /<div class="card-number">02<\/div>\s*<h3>Bedrijfssoftware<\/h3>\s*<p>Excel is geen systeem\. Bedrijfssoftware wel\. Op maat gebouwde software die past bij hoe jouw bedrijf écht werkt\.<\/p>/
  );
  assert.match(
    source,
    /<div class="card-number">03<\/div>\s*<h3>Voicesoftware<\/h3>\s*<p>Nooit meer een gemiste oproep\. Nooit meer een gemiste kans\. Onze AI-agents nemen op, kwalificeren en werken — dag en nacht\.<\/p>/
  );
  assert.doesNotMatch(source, /diensten-arrow-wrap/);
});

test('premium website heeft geen losse CTA-sectie meer en laat contactlinks op de footer landen', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /<section id="contact" class="cta-section">/);
  assert.doesNotMatch(source, /\.cta-section\s*\{/);
  assert.doesNotMatch(source, /Klaar voor de <span class="text-accent">volgende stap<\/span>\?/);
  assert.match(source, /<div class="footer-accent"><\/div>/);
  assert.match(source, /<footer id="contact" class="footer">/);
  assert.match(source, /<a href="#over">Over ons<\/a>/);
  assert.match(source, /\.footer-grid\s*\{[\s\S]*grid-template-columns:\s*2fr 1fr 1fr 1fr;/s);
  assert.match(source, /\.footer-logo\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;/s);
  assert.match(source, /<div class="footer-copy">© 2026 <span>Softora\.nl<\/span> - Alle rechten voorbehouden · KvK: 12345678<\/div>/);
  assert.match(source, /<a href="#contact" class="magnetic-btn magnetic">Start Project<\/a>/);
});

test('premium website hero is full-bleed workspace-foto met donkere overlay en leesbare tekst', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /section\.hero\s*\{[\s\S]*min-height:\s*clamp\(610px,\s*76vh,\s*760px\);/s
  );
  assert.match(
    source,
    /\.hero::before\s*\{[\s\S]*photo-1497366216548-37526070297c[\s\S]*cover no-repeat;/s
  );
  assert.match(
    source,
    /\.hero::after\s*\{[\s\S]*background:\s*linear-gradient\(90deg,\s*rgba\(0,\s*0,\s*0,\s*0\.55\)\s*0%,\s*rgba\(0,\s*0,\s*0,\s*0\.32\)\s*50%,/s
  );
  assert.match(source, /section\.hero\s*\{[\s\S]*justify-content:\s*center !important;/s);
  assert.match(source, /\.hero-content\s*\{[\s\S]*text-align:\s*center;/s);
  assert.match(source, /section\.hero\s*\{[\s\S]*padding:\s*clamp\(5\.75rem,/s);
  assert.match(source, /\.hero h1\s*\{[\s\S]*color:\s*#fff;/s);
  assert.match(source, /\.hero p\s*\{[\s\S]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.72\);/s);
  assert.doesNotMatch(source, /class="hero-image"/);
  assert.match(source, /\.perf-deferred-section\s*\{[\s\S]*content-visibility:\s*auto;[\s\S]*contain-intrinsic-size:\s*920px;/s);
  assert.match(source, /<section id="diensten" class="perf-deferred-section"/);
});

test('premium website whatsapp-widget gebruikt een verfijnde stijl en opent het juiste nummer', () => {
  const filePath = path.join(__dirname, '../../premium-website.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /\.whatsapp-widget-label\s*\{/);
  assert.match(source, /box-shadow:\s*0 12px 24px rgba\(20, 22, 34, 0\.1\);/);
  assert.match(source, /backdrop-filter:\s*blur\(12px\);/);
  assert.match(
    source,
    /\.whatsapp-widget-btn\s*\{[\s\S]*width:\s*64px;[\s\S]*height:\s*64px;[\s\S]*background:\s*linear-gradient\(145deg,\s*#30df6c 0%,\s*#19bf57 100%\);/s
  );
  assert.doesNotMatch(source, /\.whatsapp-widget-btn::before\s*\{/);
  assert.match(
    source,
    /href="https:\/\/wa\.me\/31629917185\?text=Hoi%20Softora%2C%20ik%20wil%20graag%20meer%20informatie\."/
  );
  assert.match(source, /aria-label="Open WhatsApp chat met Softora op 06 29 91 71 85"/);
});

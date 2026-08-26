const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyPublicSeoHeadDefaults,
  buildPublicSeoSitemapXml,
  getIndexablePublicHtmlFileFromPath,
  getIndexablePublicPathFromHtmlFile,
} = require('../../server/services/public-seo');

const repoRoot = path.resolve(__dirname, '../..');

test('contact page is a canonical indexable public route', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'contact.html'), 'utf8');
  const sitemap = buildPublicSeoSitemapXml({
    knownHtmlPageFiles: new Set(['contact.html']),
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal(getIndexablePublicHtmlFileFromPath('/contact'), 'contact.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('contact.html'), '/contact');
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/contact">/);
  assert.match(html, /<h1[^>]*>Vertel ons wat je wilt <span>bouwen\.<\/span><\/h1>/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/contact<\/loc>/);
});

test('contact page offers direct contact and an accessible project intake', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'contact.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'contact.html');

  assert.match(html, /<strong>info@softora\.nl<\/strong>/);
  assert.match(html, /<strong>\+31 6 43 26 27 92<\/strong>/);
  assert.match(html, /href="https:\/\/wa\.me\/31643262792"/);
  assert.match(html, /id="contact-name"[^>]*required/);
  assert.match(html, /id="contact-email"[^>]*type="email"[^>]*required/);
  assert.match(html, /id="contact-message"[^>]*maxlength="4000"[^>]*required/);
  assert.match(html, /data-contact-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-contact-success hidden tabindex="-1"/);
  assert.match(html, /<span>SC<\/span>/);
  assert.match(html, /<span>MV<\/span>/);
});

test('contact form submits to the server-side route and opens the standard conversation channel', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/contact-page.js'), 'utf8');

  assert.match(source, /fetch\('\/api\/public-contact'/);
  assert.match(source, /page: '\/contact'/);
  assert.match(source, /phone: phone/);
  assert.match(source, /Onderwerp: ' \+ topic/);
  assert.match(source, /AbortController/);
  assert.match(source, /window\.open\(MARTIJN_WHATSAPP_URL/);
  assert.match(source, /https:\/\/wa\.me\/31643262792/);
});

test('contact page keeps a dedicated responsive stylesheet and no inline product code', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'contact.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'assets/contact-page.css'), 'utf8');

  assert.match(html, /assets\/contact-page\.css\?v=20260826d/);
  assert.match(html, /assets\/contact-page\.js\?v=20260826b/);
  assert.doesNotMatch(html, /<style\b|<script>(?:.|\n)*<\/script>/i);
  assert.doesNotMatch(html, /<footer\b/i);
  assert.doesNotMatch(css, /min-height: calc\(100vh/);
  assert.match(css, /font-size: clamp\(52px, 5\.6vw, 88px\)/);
  assert.match(css, /width: min\(570px, calc\(100% - clamp\(34px, 6vw, 90px\)\)\)/);
  assert.match(html, /<nav id="navbar"[^>]*>[\s\S]*class="logo"[^>]*>SOFTORA\.NL<\/a>[\s\S]*class="magnetic-btn magnetic nav-start-btn"[^>]*>Start Project<\/a>/);
  assert.match(css, /#navbar \{[\s\S]*position: fixed;[\s\S]*background: #f8f7f4;[\s\S]*box-shadow: 0 14px 40px rgba\(20, 16, 12, 0\.08\)/);
  assert.match(css, /\.logo \{[\s\S]*font-size: 2rem;[\s\S]*font-weight: 700;[\s\S]*line-height: 1\.6/);
  assert.match(css, /\.magnetic-btn \{[\s\S]*border-radius: 999px;[\s\S]*background: var\(--contact-accent\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

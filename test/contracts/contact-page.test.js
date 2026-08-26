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
  assert.match(html, /<h1[^>]*>Stel je <span>vraag\.<\/span><\/h1>/);
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
  assert.match(
    html,
    /<img src="\/assets\/softora-team-serve-creusen\.jpg" alt="Servé Creusen, medeoprichter van Softora en direct aanspreekpunt" width="1600" height="1200" loading="lazy" decoding="async" fetchpriority="low"/
  );
  assert.match(
    html,
    /<img src="\/assets\/softora-team-martijn-van-de-ven\.png" alt="Martijn van de Ven, medeoprichter van Softora en direct aanspreekpunt" width="632" height="632" loading="lazy" decoding="async" fetchpriority="low"/
  );
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
  assert.match(source, /wireTopicSelectAccessibility/);
  assert.match(source, /aria-labelledby', 'contact-topic-label ' \+ value\.id/);
});

test('contact page keeps a dedicated responsive stylesheet and no inline product code', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'contact.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'assets/contact-page.css'), 'utf8');

  assert.match(html, /assets\/custom-selects\.css\?v=20260511a/);
  assert.match(html, /assets\/contact-page\.css\?v=20260826j/);
  assert.match(html, /assets\/custom-selects\.js\?v=20260511a/);
  assert.match(html, /assets\/contact-page\.js\?v=20260826c/);
  assert.doesNotMatch(html, /<style\b|<script>(?:.|\n)*<\/script>/i);
  assert.doesNotMatch(html, /<footer\b/i);
  assert.doesNotMatch(css, /min-height: calc\(100vh/);
  assert.match(css, /font-size: clamp\(52px, 5\.6vw, 88px\)/);
  assert.match(css, /width: min\(570px, calc\(100% - clamp\(34px, 6vw, 90px\)\)\)/);
  assert.match(html, /<nav id="navbar"[^>]*>[\s\S]*class="logo"[^>]*>SOFTORA\.NL<\/a>[\s\S]*class="magnetic-btn magnetic nav-start-btn"[^>]*>Start Project<\/a>/);
  assert.match(css, /#navbar \{[\s\S]*position: fixed;[\s\S]*background: #f8f7f4;[\s\S]*box-shadow: 0 14px 40px rgba\(20, 16, 12, 0\.08\)/);
  assert.match(css, /\.logo \{[\s\S]*font-size: 2rem;[\s\S]*font-weight: 700;[\s\S]*line-height: 1\.6/);
  assert.match(css, /\.magnetic-btn \{[\s\S]*border-radius: 999px;[\s\S]*background: var\(--contact-accent\)/);
  assert.match(html, /<meta name="theme-color" content="#f8f7f4">/);
  assert.match(css, /color-scheme: light/);
  assert.match(css, /--contact-accent: #8b2252/);
  assert.match(css, /\.contact-eyebrow \{[\s\S]*color: var\(--contact-accent\)/);
  assert.match(css, /\.contact-intro h1 span \{[\s\S]*color: var\(--contact-accent\)/);
  assert.match(css, /\.contact-founder-photo \{[\s\S]*border-radius: 50%/);
  assert.match(css, /\.contact-founder-photo img \{[\s\S]*object-fit: cover/);
  assert.match(html, /<select id="contact-topic" name="topic" data-custom-select="true">/);
  assert.match(html, /<span id="contact-topic-label">Waar gaat het over\?<\/span>/);
  assert.match(css, /\.contact-field \.site-select-menu \{[\s\S]*background: var\(--contact-paper\)/);
  assert.match(css, /--contact-field-border: #cbc5c8/);
  assert.match(css, /\.contact-field \.site-select-trigger \{[\s\S]*height: 48px !important;[\s\S]*padding: 11px 42px 11px 13px !important;[\s\S]*border: 1px solid var\(--contact-field-border\) !important/);
  assert.match(css, /\.contact-field \.site-select-option\.is-selected::after \{[\s\S]*content: "✓"/);
  assert.match(css, /linear-gradient\(135deg, #faf8f4 0%, #f3f0eb 58%, #eee9e4 100%\)/);
  assert.doesNotMatch(css, /#d45b8e|rgba\(207, 122, 145/);
  assert.doesNotMatch(css, /--contact-night|#10101c|#11111e|#171421|#24151e|#181621|#3e172a|#333345/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.contact-direct \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.contact-field textarea \{[\s\S]*height: 136px;[\s\S]*min-height: 136px/);
  assert.match(css, /\.contact-submit-row button \{[\s\S]*min-height: 52px/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

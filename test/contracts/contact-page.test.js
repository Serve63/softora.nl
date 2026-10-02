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
  assert.match(html, /<h1[^>]*>STEL JE <span>VRAAG\.<\/span><\/h1>/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/contact<\/loc>/);
});

test('contact page keeps only an accessible form beneath the service chooser header', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'contact.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'contact.html');
  const chooser = fs.readFileSync(path.join(repoRoot, 'assets/entry/toekomst.html'), 'utf8');
  const expectedHeader = chooser.match(/    <header>[\s\S]*?    <\/header>/)[0]
    .replace('<header>', '<header data-softora-public-seo="internal-links">')
    .replace('href="https://www.softora.nl/contact"', 'href="#contact-form"')
    .replace(/<img src="\/assets\/entry\/[^"]+"[^>]*>/g, '')
    .replace('class="contact-option-icon contact-avatar"', 'class="contact-option-icon contact-avatar contact-avatar--form"')
    .replace('class="contact-option-icon contact-avatar"', 'class="contact-option-icon contact-avatar contact-avatar--message"')
    .replace('class="contact-option-icon contact-avatar"', 'class="contact-option-icon contact-avatar contact-avatar--phone"')
    .replace('<strong>WhatsApp</strong>', '<strong>Stuur een bericht</strong>')
    .replace('target="_blank" rel="noopener noreferrer" class="contact-option"', 'target="_blank" rel="noopener noreferrer" class="contact-option content-header-contact" data-softora-conversion="public-cta" data-softora-conversion-page="/contact" data-softora-conversion-target="whatsapp"');

  assert.ok(source.includes(expectedHeader));
  assert.match(source, /data-softora-contact-placement="header"/);
  assert.doesNotMatch(html, /data-softora-whatsapp-widget|public-whatsapp-widget\.css/);
  assert.match(html, /href="https:\/\/wa\.me\/31643262792"/);
  assert.equal((html.match(/<form\b/g) || []).length, 1);
  assert.match(html, /<form id="contact-form" novalidate>/);
  assert.match(html, /id="contact-name"[^>]*autocomplete="name"[^>]*maxlength="120"[^>]*required/);
  assert.match(html, /id="contact-email"[^>]*type="email"[^>]*maxlength="200"[^>]*required/);
  assert.match(html, /id="contact-phone"[^>]*type="tel"[^>]*maxlength="80"/);
  assert.match(html, /id="contact-message"[^>]*maxlength="4000"[^>]*required/);
  assert.match(html, /data-contact-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-contact-success hidden tabindex="-1"/);
  assert.match(html, /id="contact-company-website"[^>]*tabindex="-1"[^>]*autocomplete="off"/);
  assert.match(html, /href="\/privacybeleid"/);
  assert.match(html, /<select id="contact-topic" name="topic" data-custom-select="true">/);
  assert.match(html, /<span id="contact-topic-label">Waar gaat het over\?<\/span>/);
  assert.doesNotMatch(html, /contact-founders|softora-team-|contact-direct|contact-next|Projectintake|<footer\b/);
  const main = source.match(/<main[\s\S]*?<\/main>/)[0];
  assert.doesNotMatch(main, /<img\b/);
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

test('contact page shares the chooser theme and keeps responsive form styles outside the document', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'contact.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'assets/contact-page.css'), 'utf8');

  assert.match(html, /assets\/entry\/start\.css\?v=login-menu-20260922/);
  assert.match(html, /assets\/entry\/contact-menu\.js\?v=login-menu-20260922/);
  assert.match(html, /assets\/custom-selects\.css\?v=20260511a/);
  assert.match(html, /assets\/contact-page\.css\?v=20261003a/);
  assert.match(html, /assets\/custom-selects\.js\?v=20260511a/);
  assert.match(html, /assets\/contact-page\.js\?v=20260826c/);
  assert.match(html, /<meta name="theme-color" content="#f8f6f2">/);
  assert.doesNotMatch(html, /<style\b|<script>(?:.|\n)*<\/script>/i);
  assert.match(css, /color-scheme: light/);
  assert.match(css, /width: min\(100%, 640px\)/);
  assert.match(css, /\.contact-page \.contact-main \{[\s\S]*max-height: none/);
  assert.match(css, /\.contact-field textarea \{[^}]*height: 136px;[^}]*min-height: 136px/);
  assert.match(css, /\.contact-field input:focus/);
  assert.match(css, /\.site-select-trigger:focus-visible/);
  assert.match(css, /\.contact-field \.site-select-menu \{[^}]*background: var\(--contact-paper\)/);
  assert.match(css, /\.contact-field \.site-select-option\.is-selected::after \{[^}]*content: "✓"/);
  assert.match(css, /@media \(max-width: 540px\) \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.contact-submit-row button \{[^}]*min-height: 48px/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

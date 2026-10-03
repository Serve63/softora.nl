const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const { createPreviewServer } = require('../../scripts/preview-seo-solution');
const { getIndexablePublicHtmlFileFromPath } = require('../../server/services/public-seo');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assertLegalHeader(html) {
  const header = (source) => DomUtils.findOne((node) => node.name === 'header', parseDocument(source).children);
  const actual = header(html);
  const reference = header(read('assets/entry/toekomst.html'));
  const login = (node) => node.attribs?.class?.split(' ').includes('login-menu');
  const referenceLogin = DomUtils.findOne(login, reference.children);
  assert.ok(referenceLogin, 'The toekomst reference retains its login menu');
  DomUtils.removeElement(referenceLogin);
  assert.equal(DomUtils.findAll(login, actual.children).length, 0);
  const markup = (node) => DomUtils.getOuterHTML(node).replace(/>\s+</g, '><');
  assert.equal(markup(actual), markup(reference));
}


test('toekomst copyright opens the legal chooser while keeping the article and personnel links', () => {
  const doc = parseDocument(read('assets/entry/toekomst.html'));
  const links = DomUtils.findAll((node) => node.name === 'a', doc.children);
  const copyright = links.find((node) => node.attribs.class === 'footer-copyright');
  assert.equal(copyright.attribs.href, '/juridisch');
  assert.equal(DomUtils.textContent(copyright), '© 2026 SOFTORA.NL Juridisch');
  assert.ok(links.some((node) => node.attribs.href === 'https://www.softora.nl/blog'));
  assert.ok(links.some((node) => node.attribs.href === '/premium-personeel-login'));
});

test('legal chooser links all three choices to public pages', () => {
  const doc = parseDocument(read('assets/juridisch/index.html'));
  assert.equal(DomUtils.textContent(DomUtils.findOne((node) => node.name === 'h1', doc.children)), 'ALLES HELDER GEREGELD.');
  const choices = DomUtils.findAll((node) => node.name === 'a' && node.attribs.class?.includes('legal-card '), doc.children);
  assert.deepEqual(choices.map((node) => node.attribs.href), ['/algemene-voorwaarden', '/privacybeleid', '/bedrijfsgegevens']);
  assert.equal(getIndexablePublicHtmlFileFromPath('/algemene-voorwaarden'), 'premium-algemene-voorwaarden.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/privacybeleid'), 'premium-privacy-policy.html');
  for (const text of ['Algemene voorwaarden', 'Privacybeleid', 'Bedrijfsgegevens']) assert.ok(DomUtils.textContent(doc).includes(text));
  const images = choices.map((choice) => DomUtils.findOne((node) => node.name === 'img', choice.children));
  assert.deepEqual(images.map((node) => node.attribs.src), ['/assets/juridisch/terms-3d-v1.webp', '/assets/juridisch/privacy-3d-v1.webp', '/assets/juridisch/company-3d-v1.webp']);
  for (const image of images) {
    assert.equal(image.attribs.alt, '');
    assert.equal(image.attribs.width, '512');
    assert.equal(image.attribs.height, '512');
    assert.ok(fs.existsSync(path.join(root, image.attribs.src)));
  }
  const css = read('assets/juridisch/legal.css');
  assert.match(css, /\.legal-card:is\(:hover,:focus-visible\) \.legal-visual img/);
  assert.match(css, /prefers-reduced-motion:\s*no-preference/);
  const desktopIconWidth = Number(css.match(/\.legal-visual img \{[^}]*width:\s*min\(100%,\s*(\d+)px\)/)?.[1]);
  assert.ok(desktopIconWidth > 0 && desktopIconWidth <= 180, 'Legal icons should remain secondary to their labels');
  assert.match(read('assets/juridisch/index.html'), /legal\.css\?v=legal-details-/);
});

test('legal chooser shares the toekomst header and contact resources without login', () => {
  const html = read('assets/juridisch/index.html');
  const entry = read('assets/entry/toekomst.html');
  const doc = parseDocument(html);
  assertLegalHeader(html);
  for (const resource of ['/assets/entry/start.css', '/assets/entry/ai-medewerker.css', '/assets/entry/contact-menu.js']) {
    const pattern = new RegExp('(?:href|src)="(' + resource.replaceAll('.', '\\.') + '\\?[^" ]+)"');
    assert.equal(html.match(pattern)?.[1], entry.match(pattern)?.[1], resource);
  }
  const body = DomUtils.findOne((node) => node.name === 'body', doc.children);
  assert.ok(body.attribs.class.split(' ').includes('toekomst-ai'));
  const css = read('assets/juridisch/legal.css');
  assert.doesNotMatch(css, /\.legal-page[^}]*header\s*\{/);
  assert.match(css, /\.legal-page \.page \{ max-width: 1440px;/);
});

test('legal chooser puts back above its eyebrow and omits redundant actions and footer', () => {
  const doc = parseDocument(read('assets/juridisch/index.html'));
  const hasClass = (node, value) => node.attribs?.class?.split(' ').includes(value);
  const intro = DomUtils.findOne((node) => hasClass(node, 'legal-intro'), doc.children);
  const children = intro.children.filter((node) => node.type === 'tag');
  assert.equal(children[0].name, 'a');
  assert.ok(hasClass(children[0], 'back-link'));
  assert.equal(children[0].attribs.href, '/toekomst');
  assert.equal(DomUtils.textContent(children[0]).trim(), '← Terug');
  assert.ok(hasClass(children[1], 'legal-eyebrow'));
  assert.equal(DomUtils.findAll((node) => node.name === 'footer', doc.children).length, 0);
  assert.doesNotMatch(DomUtils.textContent(doc), /Een vraag\?|Mail ons gerust|Bekijk de voorwaarden|Lees het privacybeleid|Bekijk onze gegevens|Alle oplossingen|© 2026/);
  const choices = DomUtils.findAll((node) => hasClass(node, 'legal-card'), doc.children);
  for (const choice of choices) {
    assert.ok(DomUtils.findOne((node) => node.name === 'h2', choice.children));
    assert.ok(DomUtils.findOne((node) => node.name === 'p', choice.children));
    assert.equal(DomUtils.findAll((node) => hasClass(node, 'legal-card-action'), choice.children).length, 0);
  }
});

test('public company identifiers match Softora bookkeeping and omit its internal tax account number', () => {
  const bookkeeping = read('premium-boekhouding.html');
  const kvk = bookkeeping.match(/KVK-nummer<\/span>\s*<span class="company-tax-card__value">([^<]+)</)?.[1];
  const vat = bookkeeping.match(/Btw-identificatienummer<\/span>\s*<span class="company-tax-card__value">([^<]+)</)?.[1];
  const internal = bookkeeping.match(/Omzetbelastingnummer<\/span>\s*<span class="company-tax-card__value">([^<]+)</)?.[1];
  assert.ok(kvk && vat && internal);
  const company = read('assets/juridisch/bedrijfsgegevens.html');
  assert.ok(company.includes('<dt>KvK-nummer</dt><dd>' + kvk + '</dd>'));
  assert.ok(company.includes('<dt>Btw-identificatienummer</dt><dd>' + vat + '</dd>'));
  assert.doesNotMatch(company, /Omzetbelastingnummer|12345678/);
  assert.ok(!company.includes('<dd>' + internal + '</dd>'));
  for (const file of ['premium-algemene-voorwaarden.html', 'premium-privacy-policy.html']) {
    const html = read(file);
    assert.ok(html.includes('<strong>KvK-nummer:</strong> ' + kvk));
    assert.doesNotMatch(html, /12345678/);
  }
  for (const link of ['mailto:info@softora.nl', 'tel:+31643262792', '/juridisch', 'https://www.softora.nl/contact']) assert.ok(company.includes('href="' + link + '"'));
  assert.doesNotMatch(company, /Liever een bericht via de website|Neem contact op|class="legal-contact"/);
});

for (const [route, file] of [['/juridisch', 'assets/juridisch/index.html'], ['/bedrijfsgegevens', 'assets/juridisch/bedrijfsgegevens.html']]) {
  test(route + ' is a static public route with complete accessible content', async (t) => {
    const config = JSON.parse(read('vercel.json'));
    assert.ok(config.rewrites.some((entry) => entry.source === route && entry.destination === '/' + file));
    const server = createPreviewServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + route;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.equal(html, read(file));
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    const doc = parseDocument(html);
    const elements = DomUtils.findAll((node) => ['tag', 'script', 'style'].includes(node.type), doc.children);
    assert.equal(elements.filter((node) => node.name === 'h1').length, 1);
    const scripts = elements.filter((node) => node.name === 'script');
    assert.deepEqual(scripts.map((node) => node.attribs.src), ['/assets/entry/contact-menu.js?v=login-menu-20260922']);
    for (const script of scripts) {
      assert.ok(Object.hasOwn(script.attribs, 'defer'));
      assert.equal(DomUtils.textContent(script), '');
    }
    assert.equal(elements.filter((node) => node.name === 'style').length, 0);
    assert.doesNotMatch(html, /localhost|127\.0\.0\.1|12345678/);
    for (const node of elements) {
      for (const name of ['href', 'src']) {
        const ref = node.attribs[name];
        if (ref?.startsWith('/assets/')) assert.ok(fs.existsSync(path.join(root, new URL(ref, 'http://localhost').pathname)), ref);
        if (ref?.startsWith('#')) assert.ok(elements.some((element) => element.attribs.id === ref.slice(1)), ref);
      }
    }
  });
}

for (const file of ['assets/juridisch/bedrijfsgegevens.html', 'premium-algemene-voorwaarden.html', 'premium-privacy-policy.html']) {
  test(file + ' shares the contact header without login and offers back before the legal label', () => {
    const html = read(file);
    const doc = parseDocument(html);
    assertLegalHeader(html);
    for (const resource of ['/assets/entry/start.css', '/assets/entry/ai-medewerker.css', '/assets/entry/contact-menu.js']) {
      assert.ok(html.includes(resource), resource);
    }
    const hasClass = (node, value) => node.attribs?.class?.split(' ').includes(value);
    const container = DomUtils.findOne((node) => hasClass(node, file.includes('bedrijfsgegevens') ? 'legal-intro' : 'toc'), doc.children);
    const children = container.children.filter((node) => node.type === 'tag');
    assert.equal(children[0].name, 'a');
    assert.ok(hasClass(children[0], 'back-link'));
    assert.equal(children[0].attribs.href, '/juridisch');
    assert.equal(DomUtils.textContent(children[0]).trim(), '← Terug');
    assert.ok(hasClass(children[1], file.includes('bedrijfsgegevens') ? 'legal-eyebrow' : 'toc-title'));
    assert.equal(DomUtils.findAll((node) => node.name === 'footer', doc.children).length, 0);
    assert.doesNotMatch(html, /Terug naar juridisch|nav-start-btn|id="navbar"|whatsapp-widget/);
    if (file.includes('bedrijfsgegevens')) {
      assert.equal(DomUtils.textContent(DomUtils.findOne((node) => node.name === 'h1', doc.children)), 'ONZE BEDRIJFSGEGEVENS.');
    }
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const { createPreviewServer } = require('../../scripts/preview-seo-solution');
const { getIndexablePublicHtmlFileFromPath } = require('../../server/services/public-seo');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

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
  for (const link of ['mailto:info@softora.nl', 'tel:+31643262792', '/juridisch', '/contact']) assert.ok(company.includes('href="' + link + '"'));
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
    const elements = DomUtils.findAll((node) => node.type === 'tag', doc.children);
    assert.equal(elements.filter((node) => node.name === 'h1').length, 1);
    assert.equal(elements.filter((node) => node.name === 'script').length, 0);
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

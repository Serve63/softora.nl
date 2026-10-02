const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RETIRED_PUBLIC_LANDINGS, isRetiredPublicLanding,
  replaceRetiredPublicLinks, publicLandingRetirementMiddleware,
} = require('../../server/services/public-landing-retirement');

const retained = ['/', '/website-laten-maken', '/bedrijfssoftware-op-maat', '/maatwerk-platform',
  '/voicesoftware-op-maat', '/chatbot-laten-maken', '/website', '/bedrijfssoftware',
  '/voicesoftware', '/chatbot', '/seo-solution', '/nieuwe-website', '/toekomst'];

test('retirement covers exactly the selected 20 landings and preserves the 13 selected pages', () => {
  assert.deepEqual(Object.keys(RETIRED_PUBLIC_LANDINGS).sort(), [
    '/diensten', '/pakketten', '/website-laten-maken-oisterwijk', '/crm-systeem-op-maat', '/ai-automatisering', '/ai-telefonist',
    '/branches/adviesbureaus', '/branches/installateurs', '/branches/makelaars', '/branches/zakelijke-dienstverleners',
    '/regio/oisterwijk', '/regio/tilburg', '/regio/den-bosch', '/regio/midden-brabant', '/regio/tilburg-ai-automatisering',
    '/vergelijkingen/website-laten-maken-vs-zelf-maken', '/vergelijkingen/ai-telefonist-vs-receptionist',
    '/vergelijkingen/chatbot-vs-livechat', '/vergelijkingen/maatwerk-software-vs-standaard-software', '/vergelijkingen/crm-op-maat-vs-standaard-crm',
  ].sort());
  for (const route of [...retained, '/contact', '/over-softora', '/blog/ai-telefonist-kosten-mkb', '/premium-pakketten']) {
    assert.equal(isRetiredPublicLanding(route), false, route);
  }
  for (const target of Object.values(RETIRED_PUBLIC_LANDINGS)) assert.ok(retained.includes(target), target);
});

test('public links use retained destinations while external links and article URLs remain intact', () => {
  const html = `<a href="/ai-telefonist?bron=blog#intake">Telefonie</a><a href='https://softora.nl/crm-systeem-op-maat.html'>CRM</a><a href="/branches">Branches</a><a href="https://example.com/ai-telefonist">Extern</a><a href="/blog/ai-telefonist-kosten-mkb">Artikel</a><div data-href="/diensten">Tekst</div>`;
  const replaced = replaceRetiredPublicLinks(html);
  assert.ok(replaced.includes('href="/voicesoftware-op-maat?bron=blog#intake"'));
  assert.ok(replaced.includes("href='/bedrijfssoftware-op-maat'"));
  assert.ok(replaced.includes('href="/blog"'));
  assert.ok(replaced.includes('href="https://example.com/ai-telefonist"'));
  assert.ok(replaced.includes('href="/blog/ai-telefonist-kosten-mkb"'));
  assert.ok(replaced.includes('data-href="/diensten"'));
  assert.equal(replaceRetiredPublicLinks(replaced), replaced);
});

test('retirement does not rewrite private HTML or JSON responses', () => {
  for (const headers of [
    { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, private' },
    { 'Content-Type': 'application/json' },
  ]) {
    const body = '<a href="/diensten">Diensten</a>';
    let sent;
    const res = { getHeader: (name) => headers[name], send(value) { sent = value; return this; } };
    publicLandingRetirementMiddleware({ method: 'GET', path: '/premium-personeel-dashboard' }, res, () => {});
    res.send(body);
    assert.equal(sent, body);
  }
});

test('all retained Vercel static landings keep their rewrites and have no retired navigation', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
  for (const route of ['/voicesoftware', '/chatbot', '/seo-solution', '/nieuwe-website', '/toekomst']) {
    const rewrite = config.rewrites.find((entry) => entry.source === route);
    assert.ok(rewrite, route);
    const html = fs.readFileSync(path.join(repoRoot, rewrite.destination), 'utf8');
    assert.equal(replaceRetiredPublicLinks(html), html, `${route} has a retired navigation link`);
  }
});

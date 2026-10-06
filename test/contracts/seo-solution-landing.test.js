const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'assets/seo-solution/index.html'), 'utf8');
const document = parseDocument(html);
const elements = DomUtils.findAll((node) => node.type === 'tag', document.children);

test('local preview serves the landing and images without exposing APIs or repository files', async (t) => {
  const { createPreviewServer } = require('../../scripts/preview-seo-solution');
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const landing = await fetch(base + '/seo-solution');
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('content-type'), /text\/html/);
  assert.equal(await landing.text(), html);
  const image = await fetch(base + '/assets/seo-solution/images/seo-maatje-cutout.webp', { method: 'HEAD' });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(await image.text(), '');
  for (const route of ['/api/outreach/provider-upload', '/server.js', '/.env', '/assets/../server.js', '/assets/seo-solution/missing.webp']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
  }
  const post = await fetch(base + '/seo-solution', { method: 'POST' });
  assert.equal(post.status, 405);
});

test('SEO Solution chooser is disabled while login keeps its own destination', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((route) => route.source === '/seo-solution' && route.destination === '/assets/seo-solution/index.html'));
  const chooser = parseDocument(fs.readFileSync(path.join(root, 'assets/entry/toekomst.html'), 'utf8'));
  const links = DomUtils.findAll((node) => node.name === 'a', chooser.children);
  const seoChoice = links.find((node) => node.attribs.class === 'choice' && DomUtils.textContent(node).includes('SEO SOLUTION'));
  assert.equal(seoChoice.attribs['data-service'], '/seo-solution');
  assert.equal(seoChoice.attribs.href, undefined);
  assert.equal(seoChoice.attribs['aria-disabled'], 'true');
  assert.ok(links.some((node) => node.attribs.href === '/seo-login'));
  assert.ok(elements.some((node) => node.name === 'a' && node.attribs.href === '/seo-login'));
});

test('landing assets and in-page navigation resolve, including mobile links', () => {
  const ids = new Set(elements.map((node) => node.attribs.id).filter(Boolean));
  for (const element of elements) {
    for (const attribute of ['href', 'src']) {
      const reference = element.attribs[attribute];
      if (!reference) continue;
      if (reference.startsWith('/assets/')) assert.ok(fs.existsSync(path.join(root, reference)), reference);
      if (reference.startsWith('#')) assert.ok(ids.has(reference.slice(1)), reference);
    }
  }
  const images = elements.filter((node) => node.name === 'img');
  assert.equal(images.length, 4);
  for (const image of images) {
    assert.ok(image.attribs.alt.trim());
    const bytes = fs.readFileSync(path.join(root, image.attribs.src));
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < 200000, 'Landing illustrations must remain lightweight');
  }
});

test('the illustrative demo exposes one selected accessible tab and matching panel', () => {
  const tabs = elements.filter((node) => node.attribs.role === 'tab');
  const panels = elements.filter((node) => node.attribs.role === 'tabpanel');
  assert.equal(tabs.length, 3);
  assert.equal(panels.length, 3);
  assert.equal(tabs.filter((node) => node.attribs['aria-selected'] === 'true').length, 1);
  for (const tab of tabs) {
    const panel = panels.find((node) => node.attribs.id === tab.attribs['aria-controls']);
    assert.ok(panel);
    assert.equal(panel.attribs['aria-labelledby'], tab.attribs.id);
    assert.equal(Object.hasOwn(panel.attribs, 'hidden'), tab.attribs['aria-selected'] !== 'true');
  }
  assert.ok(DomUtils.textContent(document).includes('ILLUSTRATIEVE DEMO'));
  assert.equal(elements.filter((node) => node.name === 'form').length, 0, 'The concept must not pretend to run an SEO scan or create leads');
});

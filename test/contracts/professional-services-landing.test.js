const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { parseDocument, DomUtils } = require('htmlparser2');
const { createPreviewServer } = require('../../scripts/preview-seo-solution');
const root = path.resolve(__dirname, '../..');
const pages = [
  { route: '/voicesoftware', file: 'assets/voicesoftware/index.html', tabs: ['answer', 'appointment', 'handoff'], photoOnly: false },
  { route: '/bedrijfssoftware', file: 'bedrijfssoftware.html', tabs: ['overview', 'workflow', 'connect'], photoOnly: true },
];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page.file), 'utf8');
  const doc = parseDocument(html);
  const elements = DomUtils.findAll((node) => node.type === 'tag', doc.children);
  test(page.route + ' serves its owning page without exposing other root files', async (t) => {
    const server = createPreviewServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(origin + page.route);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
    const head = await fetch(origin + page.route, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(origin + '/server.js')).status, 404);
    assert.equal((await fetch(origin + '/bedrijfssoftware.html')).status, 404);
    assert.equal((await fetch(origin + page.route, { method: 'POST' })).status, 405);
    const chooser = fs.readFileSync(path.join(root, 'assets/entry/toekomst.html'), 'utf8');
    assert.ok(chooser.includes('<a class="choice" data-service="' + page.route + '"'));
  });
  test(page.route + ' has valid lightweight imagery and topic-specific accessible demos', async () => {
    const ids = new Set(elements.map((node) => node.attribs.id).filter(Boolean));
    assert.equal(ids.size, elements.filter((node) => node.attribs.id).length);
    for (const element of elements) {
      for (const attribute of ['src', 'href']) {
        const ref = element.attribs[attribute];
        if (ref?.startsWith('/assets/')) assert.ok(fs.existsSync(path.join(root, new URL(ref, 'http://localhost').pathname)), ref);
        if (ref?.startsWith('#')) assert.ok(ids.has(ref.slice(1)), ref);
      }
      if (element.name === 'script') assert.ok(element.attribs.src, 'Demo logic must be external');
    }
    const images = elements.filter((node) => node.name === 'img');
    assert.equal(images.length, 4);
    for (const img of images) {
      assert.ok(img.attribs.alt.trim());
      const file = path.join(root, img.attribs.src);
      const meta = await sharp(file).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, Number(img.attribs.width));
      assert.equal(meta.height, Number(img.attribs.height));
      assert.ok(fs.statSync(file).size < 250000);
    }
    const hero = images[0];
    assert.equal(hero.attribs.fetchpriority, 'high');
    const heroMeta = await sharp(path.join(root, hero.attribs.src)).metadata();
    assert.equal(heroMeta.hasAlpha, !page.photoOnly);
    assert.ok(DomUtils.textContent(doc).includes('fictief'));
    if (page.photoOnly) assert.doesNotMatch(html, /mascot|poppetje/i);
    const tabs = elements.filter((node) => node.attribs.role === 'tab');
    const panels = elements.filter((node) => node.attribs.role === 'tabpanel');
    assert.deepEqual(tabs.map((tab) => tab.attribs['data-tab']), page.tabs);
    assert.equal(panels.length, 3);
    assert.equal(tabs.filter((tab) => tab.attribs['aria-selected'] === 'true').length, 1);
    for (const tab of tabs) {
      const panel = panels.find((node) => node.attribs.id === tab.attribs['aria-controls']);
      assert.ok(panel);
      assert.equal(panel.attribs['aria-labelledby'], tab.attribs.id);
      assert.equal(Object.hasOwn(panel.attribs, 'hidden'), tab.attribs['aria-selected'] !== 'true');
    }
    assert.equal(elements.filter((node) => node.name === 'form').length, 0);
    assert.equal(elements.filter((node) => node.name === 'details').length, 7);
  });
}

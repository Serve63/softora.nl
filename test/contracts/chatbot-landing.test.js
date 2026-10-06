const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'assets/chatbot-landing/index.html'), 'utf8');
const document = parseDocument(html);
const elements = DomUtils.findAll((node) => node.type === 'tag', document.children);

test('chatbot landing has its own route and leaves account login separate', async (t) => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((route) => route.source === '/chatbot' && route.destination === '/assets/chatbot-landing/index.html'));
  assert.ok(config.rewrites.some((route) => route.source === '/chatbot-login' && route.destination === '/assets/chatbot-login/index.html'));
  const chooser = parseDocument(fs.readFileSync(path.join(root, 'assets/entry/toekomst.html'), 'utf8'));
  const links = DomUtils.findAll((node) => node.name === 'a', chooser.children);
  const choice = links.find((node) => node.attribs.class === 'choice' && DomUtils.textContent(node).includes('CHATBOT'));
  assert.equal(choice.attribs['data-service'], '/chatbot');
  assert.equal(choice.attribs.href, undefined);
  assert.equal(choice.attribs['aria-disabled'], 'true');
  assert.ok(links.some((node) => node.attribs.href === '/chatbot-login'));
  assert.ok(elements.some((node) => node.name === 'a' && node.attribs.href === '/chatbot-login'));
  const { createPreviewServer } = require('../../scripts/preview-seo-solution');
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/chatbot`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), html);
});

test('chatbot images, shared scripts and navigation targets are available', () => {
  const ids = new Set(elements.map((node) => node.attribs.id).filter(Boolean));
  assert.equal(ids.size, elements.filter((node) => node.attribs.id).length, 'IDs must remain unique');
  for (const element of elements) {
    for (const attribute of ['src', 'href']) {
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
    assert.ok(bytes.length < 250000, 'Chatbot illustrations should stay lightweight');
  }
});

test('example conversations and followups are accessible and explicitly fictional', () => {
  assert.match(DomUtils.textContent(document), /fictieve interieurstudio/);
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
  const buttons = elements.filter((node) => Object.hasOwn(node.attribs, 'data-followup'));
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.equal(button.attribs['aria-expanded'], 'false');
    const followup = elements.find((node) => node.attribs.id === button.attribs['aria-controls']);
    assert.ok(followup && Object.hasOwn(followup.attribs, 'hidden'));
  }
  assert.equal(elements.filter((node) => node.name === 'form').length, 0, 'The demo must not pretend to send enquiries');
});

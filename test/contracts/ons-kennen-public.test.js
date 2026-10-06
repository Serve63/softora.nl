const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'assets/ons-kennen/index.html'), 'utf8');
const document = parseDocument(html);
const elements = DomUtils.findAll((node) => node.type === 'tag', document.children);
const content = DomUtils.textContent(document);

test('the introduction starts with Martijn and Servé and follows the requested section order', () => {
  const sections = elements.filter((node) => node.name === 'section' && node.attribs.id);
  assert.deepEqual(sections.map((node) => node.attribs.id), ['mensen', 'bedrijf', 'oplossingen', 'portfolio']);
  const header = elements.find((node) => node.name === 'header');
  assert.equal(DomUtils.findAll((node) => node.name === 'nav', header.children).length, 0, 'The header must omit the section navigation');
  const headerLinks = DomUtils.findAll((node) => node.name === 'a', header.children);
  assert.deepEqual(headerLinks.map((node) => node.attribs.href), ['/toekomst', 'https://www.softora.nl/contact']);
  const portraits = elements.filter((node) => node.name === 'img');
  assert.equal(portraits.length, 2);
  assert.match(portraits[0].attribs.alt, /Martijn van de Ven, medeoprichter/);
  assert.match(portraits[1].attribs.alt, /Servé Creusen, medeoprichter/);
  for (const portrait of portraits) {
    const image = fs.readFileSync(path.join(root, portrait.attribs.src));
    assert.equal(image.toString('ascii', 8, 12), 'WEBP');
    assert.ok(image.length < 100000, 'Real portraits should be optimized for the page');
  }
});

test('company identity and contact details match the existing official public company page', () => {
  const official = DomUtils.textContent(parseDocument(fs.readFileSync(path.join(root, 'assets/juridisch/bedrijfsgegevens.html'), 'utf8')));
  for (const fact of ['Softora VOF', 'Vennootschap onder firma', 'Oisterwijk, Nederland', '93827504', 'NL866541925B01', 'info@softora.nl', '06 4326 2792']) {
    assert.ok(official.toLowerCase().includes(fact.toLowerCase()), `Official source must contain ${fact}`);
    assert.ok(content.toLowerCase().includes(fact.toLowerCase()), `Introduction must contain ${fact}`);
  }
  assert.ok(elements.some((node) => node.name === 'a' && node.attribs.href === 'mailto:info@softora.nl'));
  assert.ok(elements.some((node) => node.name === 'a' && node.attribs.href === 'tel:+31643262792'));
});

test('each portfolio example is visibly fictional and contains no fake customer results or forms', () => {
  const projects = elements.filter((node) => node.name === 'article' && Object.hasOwn(node.attribs, 'data-category'));
  assert.equal(projects.length, 3);
  for (const project of projects) {
    assert.match(DomUtils.textContent(project), /FICTIEF CONCEPT/);
    const links = DomUtils.findAll((node) => node.name === 'a', project.children);
    assert.equal(links.length, 0, 'Concepts should not link to invented customer sites');
  }
  assert.match(content, /geen uitgevoerde klantprojecten/);
  assert.match(content, /Alle namen, ontwerpen en demogegevens in dit portfolio zijn fictief/);
  assert.equal(elements.filter((node) => node.name === 'form').length, 0);
  const dialog = elements.find((node) => node.name === 'dialog');
  assert.equal(dialog.attribs['aria-labelledby'], 'dialog-title');
  assert.equal(dialog.attribs['aria-describedby'], 'dialog-description');
});

test('content and assets work without JavaScript, while interactive controls are progressively enabled', () => {
  const ids = new Set(elements.map((node) => node.attribs.id).filter(Boolean));
  for (const element of elements) {
    for (const attribute of ['src', 'href']) {
      const reference = element.attribs[attribute];
      if (reference?.startsWith('/assets/')) assert.ok(fs.existsSync(path.join(root, reference)), reference);
      if (reference?.startsWith('#')) assert.ok(ids.has(reference.slice(1)), reference);
    }
  }
  const interactiveControls = elements.filter((node) => node.name === 'button' && Object.hasOwn(node.attribs, 'data-project'));
  assert.equal(interactiveControls.length, 3);
  assert.ok(interactiveControls.every((node) => Object.hasOwn(node.attribs, 'hidden')));
  assert.ok(elements.filter((node) => node.name === 'script').every((node) => node.attribs.src));
  assert.ok(elements.some((node) => node.name === 'link' && node.attribs.rel === 'canonical' && node.attribs.href === 'https://www.softora.nl/ons-kennen'));
  assert.ok(!elements.some((node) => node.name === 'meta' && node.attribs.name === 'robots' && /noindex/.test(node.attribs.content)));
});

test('the public chooser and production route open the original personal introduction', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const route = config.rewrites.find((route) => route.source === '/ons-kennen');
  assert.equal(route.destination, '/assets/ons-kennen/index.html');
  assert.equal(fs.readFileSync(path.join(root, route.destination), 'utf8'), html);
  const chooser = parseDocument(fs.readFileSync(path.join(root, 'assets/entry/toekomst.html'), 'utf8'));
  const banner = DomUtils.findAll((node) => node.attribs?.class === 'meet-softora', chooser.children)[0];
  assert.equal(banner.name, 'a');
  assert.equal(banner.attribs.href, route.source);
  assert.equal(DomUtils.findAll((node) => node.name === 'a' || node.name === 'button', banner.children).length, 0);
});

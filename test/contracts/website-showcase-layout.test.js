const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('htmlparser2');
const { findAll, getText } = require('domutils');
const root = path.resolve(__dirname, '../..');

test('all six website projects have their own visible caption and direct accessible link', () => {
  const html = fs.readFileSync(path.join(root, 'assets/website-showcase/index.html'), 'utf8');
  const document = parseDocument(html);
  const cards = findAll(node => node.name === 'a' && node.attribs?.class?.split(' ').includes('work-card'), document.children);
  assert.equal(cards.length, 6);
  const expectedSites = ['https://salontof.nl/', 'https://linszorgt.nl/', 'https://administratieportaal.nl/', 'https://aangedacht.nl/', 'https://www.imota.nl/', 'https://dagbelevinglevenskracht.nl/'];
  assert.deepEqual(cards.map(card => card.attribs.href), expectedSites);
  for (const card of cards) {
    const heading = findAll(node => node.name === 'h3', card.children)[0];
    assert.ok(heading, 'Every project has its own client heading');
    assert.ok(card.attribs['aria-label'].includes(getText(heading)));
    assert.equal(card.attribs.target, '_blank');
    assert.match(card.attribs.rel, /noopener/);
    assert.ok(!('aria-hidden' in card.attribs) && !('inert' in card.attribs), 'All projects remain available without carousel JavaScript');
  }
  assert.doesNotMatch(html, /aria-roledescription="carrousel"|src="work\.js/);
  const css = fs.readFileSync(path.join(root, 'assets/website-showcase/work.css'), 'utf8');
  assert.match(css, /\.work-preview\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*2/);
});

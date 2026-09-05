const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDocument, DomUtils } = require('htmlparser2');
const { getSeoContentItems, buildSeoContentArticleHtml } = require('../../server/services/seo-content');
const { sectionId } = require('../../server/services/seo-content-reading-layout');

test('every article offers its answer before imagery and preserves functioning section navigation', () => {
  for (const item of getSeoContentItems()) {
    const html = buildSeoContentArticleHtml(item);
    const doc = parseDocument(html);
    const nodes = DomUtils.findAll(() => true, doc.children);
    const intro = nodes.find(n => n.attribs?.class === 'artikel-intro');
    assert.equal(DomUtils.textContent(intro), item.summary, item.slug);
    assert.ok(html.indexOf('class="artikel-intro"') < html.indexOf('class="artikel-img"'), item.slug);
    const ids = nodes.map(n=>n.attribs?.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, item.slug);
    for (const [index, section] of item.sections.entries()) {
      const id = sectionId(section, index);
      assert.ok(ids.includes(id), item.slug + ': ' + id);
      if (item.sections.length > 1) assert.ok(nodes.some(n=>n.name === 'a' && n.attribs?.href === '#' + id));
    }
    assert.ok(html.indexOf('data-softora-public-seo="eeat"') > html.lastIndexOf('<h2 id="onderdeel-'), item.slug);
    assert.doesNotMatch(html, /Het doel is niet om tekst te vullen|Geschreven en inhoudelijk gecontroleerd door/);
    assert.ok(nodes.some(n=>n.name === 'a' && n.attribs?.href === '#hoofdinhoud'));
    assert.ok(nodes.some(n=>n.name === 'details' && n.attribs?.class === 'content-menu'));
    assert.match(html, /data-softora-conversion="content-contact"/);
  }
});

test('section ids remain unique for repeated headings and exclude markup', () => {
  assert.equal(sectionId({heading:'Kosten & ideeën'},0),'onderdeel-1-kosten-ideeen');
  assert.notEqual(sectionId({heading:'Kosten'},0),sectionId({heading:'Kosten'},1));
  assert.match(sectionId({heading:'<img src=x>'},0),/^[a-z0-9-]+$/);
});

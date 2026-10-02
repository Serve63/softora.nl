const test = require('node:test');
const assert = require('node:assert/strict');
const { SEO_CONTENT_ITEMS, getSeoContentItems, buildSeoContentArticleHtml } = require('../../server/services/seo-content');
const { ARTICLE_AUTHORS, ARTICLE_AUTHOR_ASSIGNMENTS, assignSeoArticleAuthors } = require('../../server/services/seo-content-article-authors');

const article = (slug, publishedAt = '2026-10-03') => ({ collection: 'blog', slug, publishedAt });
const counts = (items) => items.reduce((result, item) => {
  result[item.author.name] = (result[item.author.name] || 0) + 1;
  return result;
}, {});

test('all canonical articles have a persisted author and an even editorial split', () => {
  const items = SEO_CONTENT_ITEMS.filter((item) => ['blog', 'kennisbank'].includes(item.collection));
  for (const item of items) {
    assert.ok(ARTICLE_AUTHOR_ASSIGNMENTS[item.slug], item.slug + ': run node scripts/sync-seo-article-authors.js');
    assert.deepEqual(item.author, ARTICLE_AUTHORS[ARTICLE_AUTHOR_ASSIGNMENTS[item.slug]]);
  }
  const totals = counts(items);
  assert.ok(Math.abs((totals['Martijn van de Ven'] || 0) - (totals['Servé Creusen'] || 0)) <= 1);
});

test('both collections render each assigned person consistently in HTML and Article schema', () => {
  const now = new Date('2026-10-02T12:00:00+02:00');
  const items = getSeoContentItems({ now }).filter((item) => ['blog', 'kennisbank'].includes(item.collection));
  const totals = counts(items);
  assert.deepEqual(totals, { 'Martijn van de Ven': 26, 'Servé Creusen': 26 });
  for (const item of items) {
    const html = buildSeoContentArticleHtml(item);
    const graph = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'];
    const schema = graph.find((entry) => entry['@type'] === 'Article');
    assert.equal(schema.author['@type'], 'Person', item.slug);
    assert.equal(schema.author.name, item.author.name, item.slug);
    assert.ok(html.includes('<span data-softora-public-seo="article-author">' + item.author.name + '</span>'), item.slug);
    assert.ok(html.includes('Van <a href="/over-softora" data-softora-public-seo="article-author">' + item.author.name + '</a>'), item.slug);
  }
});

test('new articles go to the least-used author, including scheduled articles', () => {
  const source = [article('one'), article('two'), article('three'), article('new', '2999-01-01'), article('next', '2999-01-02')];
  const saved = { one: 'martijn', two: 'martijn', three: 'serve' };
  const result = assignSeoArticleAuthors(source, { assignments: saved });
  assert.equal(result.assignments.new, 'serve');
  assert.equal(result.assignments.next, 'martijn');
  assert.deepEqual(saved, { one: 'martijn', two: 'martijn', three: 'serve' });
  assert.equal(source[3].author, undefined);
});

test('persisted authors survive reordering, backdated additions and collection moves', () => {
  const source = [article('a'), article('b'), article('c')];
  const initial = assignSeoArticleAuthors(source, { assignments: {} });
  const extended = assignSeoArticleAuthors([
    { ...source[2], collection: 'kennisbank' }, article('backdated', '2020-01-01'), ...source.slice(0, 2).reverse(),
  ], { assignments: initial.assignments });
  for (const item of source) assert.equal(extended.assignments[item.slug], initial.assignments[item.slug]);
  assert.equal(extended.assignments.backdated, 'serve');
  assert.deepEqual(assignSeoArticleAuthors(source.slice().reverse(), { assignments: {} }).assignments, initial.assignments);
  assert.deepEqual(assignSeoArticleAuthors(extended.items, { assignments: extended.assignments }).assignments, extended.assignments);
});

test('future batches stay balanced and leave other SEO pages untouched', () => {
  const service = { collection: 'branches', slug: 'service', author: { type: 'Organization', name: 'Softora' } };
  const source = [...Array.from({ length: 101 }, (_, index) => article('new-' + index)), service];
  const result = assignSeoArticleAuthors(source, { assignments: {} });
  const totals = counts(result.items.slice(0, -1));
  assert.deepEqual(totals, { 'Martijn van de Ven': 51, 'Servé Creusen': 50 });
  assert.equal(result.items.at(-1), service);
  assert.equal(result.assignments.service, undefined);
});

test('explicit supported authors count toward the split and invalid identity changes are rejected', () => {
  const source = [{ ...article('fixed'), author: ARTICLE_AUTHORS.serve }, article('new')];
  const result = assignSeoArticleAuthors(source, { assignments: {} });
  assert.equal(result.assignments.fixed, 'serve');
  assert.equal(result.assignments.new, 'martijn');
  assert.throws(() => assignSeoArticleAuthors(source, { assignments: { fixed: 'martijn' } }), /wijkt af/);
  assert.throws(() => assignSeoArticleAuthors([article('same'), article('same')], { assignments: {} }), /dubbel/);
  assert.throws(() => assignSeoArticleAuthors([article('a')], { assignments: { a: 'unknown' } }), /Onbekende artikelauteur/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { SEO_CONTENT_AUTHOR, hasSupportedReview, buildReviewSchema } = require('../../server/services/seo-content-attribution');
const { enrichSeoContentItem, getSeoContentItem, buildSeoContentArticleHtml } = require('../../server/services/seo-content');

test('default content attribution identifies Softora without inventing a human writer or reviewer', () => {
  const item = getSeoContentItem('blog', 'ai-automatisering-mkb-waar-beginnen');
  const html = buildSeoContentArticleHtml(item);
  assert.deepEqual(item.author, SEO_CONTENT_AUTHOR);
  assert.equal(item.reviewedBy, undefined);
  assert.match(html, /"author":\{"@type":"Organization","name":"Softora"/);
  assert.doesNotMatch(html, /"reviewedBy"|"lastReviewed"|Inhoudelijk gecontroleerd door/);
});

test('a supported human review is explicit, current, visible and on WebPage schema', () => {
  const source = getSeoContentItem('blog', 'ai-automatisering-mkb-waar-beginnen');
  const item = { ...source, reviewedBy: { name: 'Martijn van de Ven', href: '/over-softora' },
    reviewEvidence: { reviewedAt: '2026-09-05T10:00:00Z', reference: 'Synthetic fixture of a confirmed editorial review.' } };
  const html = buildSeoContentArticleHtml(item);
  const graph = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.equal(graph.find((node) => node['@type'] === 'WebPage').reviewedBy.name, 'Martijn van de Ven');
  assert.equal(graph.find((node) => node['@type'] === 'Article').reviewedBy, undefined);
  assert.match(html, /Inhoudelijk gecontroleerd door Martijn van de Ven op 2026-09-05/);
  assert.equal(hasSupportedReview({ ...item, updatedAt: '2026-09-06' }), false);
  assert.equal(hasSupportedReview({ ...item, reviewEvidence: { ...item.reviewEvidence, reviewedAt: '2999-01-01' } }), false);
  assert.deepEqual(buildReviewSchema({ ...item, reviewEvidence: null }, 'https://www.softora.nl'), {});
});

test('native content has no word floor or padded reading-time minimum', () => {
  const item = enrichSeoContentItem({ collection: 'blog', slug: 'native-short-fixture', qualityVersion: 2,
    title: 'Short focused fixture', sections: [{ heading: 'Answer', paragraphs: ['An actual short answer.'] }] });
  assert.equal(item.minWordCount, null);
  assert.equal(item.readTime, '1 min');
  assert.equal(item.sections.length, 1);
  assert.ok(item.wordCount > 0);
  assert.deepEqual(item.faq, []);
});

'use strict';

const ARTICLE_AUTHORS = Object.freeze({
  martijn: Object.freeze({ type: 'Person', name: 'Martijn van de Ven', href: '/over-softora' }),
  serve: Object.freeze({ type: 'Person', name: 'Servé Creusen', href: '/over-softora' }),
});
const ARTICLE_AUTHOR_ASSIGNMENTS = Object.freeze(require('./seo-content-article-authors.json'));
const authorIds = Object.keys(ARTICLE_AUTHORS);

function isArticle(item) {
  return item?.collection === 'blog' || item?.collection === 'kennisbank';
}

// Keep saved authors fixed. Only previously unassigned articles enter the balancing queue.
// The sync script records that queue in the repository before publication.
function assignSeoArticleAuthors(items, { assignments = ARTICLE_AUTHOR_ASSIGNMENTS } = {}) {
  const nextAssignments = { ...assignments };
  const counts = Object.fromEntries(authorIds.map((id) => [id, 0]));
  const articles = items.filter(isArticle);
  const seen = new Set();
  const pending = [];
  for (const item of articles) {
    if (!item.slug || seen.has(item.slug)) throw new Error('Artikel-slug ontbreekt of is dubbel: ' + item.slug);
    seen.add(item.slug);
    const explicitId = authorIds.find((id) => ARTICLE_AUTHORS[id].name === item.author?.name);
    const savedId = nextAssignments[item.slug];
    if (savedId && !ARTICLE_AUTHORS[savedId]) throw new Error('Onbekende artikelauteur: ' + savedId);
    if (explicitId && savedId && explicitId !== savedId) {
      throw new Error('Artikelauteur wijkt af van de vaste toewijzing: ' + item.slug);
    }
    const id = savedId || explicitId;
    if (id) {
      nextAssignments[item.slug] = id;
      counts[id] += 1;
    } else {
      pending.push(item);
    }
  }
  pending.sort((a, b) => String(a.publishedAt || '').localeCompare(String(b.publishedAt || ''))
    || a.slug.localeCompare(b.slug));
  for (const item of pending) {
    const id = authorIds.reduce((least, candidate) => counts[candidate] < counts[least] ? candidate : least);
    nextAssignments[item.slug] = id;
    counts[id] += 1;
  }
  return {
    assignments: Object.freeze(nextAssignments),
    items: items.map((item) => isArticle(item)
      ? Object.freeze({ ...item, author: ARTICLE_AUTHORS[nextAssignments[item.slug]] }) : item),
  };
}

function withSeoArticleAuthors(items) {
  return assignSeoArticleAuthors(items).items;
}

function excludeAssignedArticleAuthorFromClaims(html, pagePath) {
  const slug = String(pagePath || '').match(/^\/(?:blog|kennisbank)\/([^/]+)$/)?.[1];
  const author = ARTICLE_AUTHORS[ARTICLE_AUTHOR_ASSIGNMENTS[slug]];
  if (!author) return html;
  // Exclude only the exact assigned name in a marked byline, never surrounding claims.
  return String(html).replace(/<(span|a)\b[^>]*\bdata-softora-public-seo="article-author"[^>]*>([^<]*)<\/\1>/g,
    (match, tag, text) => text.trim() === author.name ? '' : match)
    .replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g,
      (match, open, json, close) => {
        try {
          const schema = JSON.parse(json);
          for (const node of schema['@graph'] || [schema]) {
            if (node['@type'] === 'Article' && node.author?.['@type'] === 'Person' && node.author.name === author.name) {
              node.author.name = '';
            }
          }
          return open + JSON.stringify(schema) + close;
        } catch {
          return match;
        }
      });
}

module.exports = { ARTICLE_AUTHORS, ARTICLE_AUTHOR_ASSIGNMENTS, assignSeoArticleAuthors, withSeoArticleAuthors, excludeAssignedArticleAuthorFromClaims };

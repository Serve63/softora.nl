'use strict';

const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentItems,
  getSeoContentClusterForItem,
  getSeoContentImageForItem,
  getSeoContentPathForItem,
} = require('./seo-content');
const { sectionId } = require('./seo-content-reading-layout');
const { renderSeoImageResponsiveAttributes } = require('./seo-content-image-search');
const fs = require('node:fs');
const path = require('node:path');
const articleTemplate = fs.readFileSync(path.join(__dirname, '../../assets/articles/article.html'), 'utf8');
const overviewTemplate = fs.readFileSync(path.join(__dirname, '../../assets/articles/overview.html'), 'utf8');
const headerMarkup = fs.readFileSync(path.join(__dirname, '../../assets/entry/toekomst.html'), 'utf8').match(/<header>([\s\S]*?)<\/header>/)[1];
const categories = { websites: 'Websites', 'ai-automatisering': 'AI & automatisering', 'software-crm': 'Software & CRM', 'ai-contact': 'Chatbots & telefonie' };

function publishedArticles(now) {
  return getSeoContentItems({ now }).filter((item) => ['blog', 'kennisbank'].includes(item.collection))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
}

function seoHead(html) {
  return html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<link rel="stylesheet"[^>]*>/g, '');
}

function siteHeader(pagePath) {
  return headerMarkup.replace(/<a\b([^>]*href="([^"]+)"[^>]*)>/g, (match, attrs, href) => {
    const target = href === 'tel:+31643262792' ? 'phone' : href === 'https://wa.me/31643262792' ? 'whatsapp' : href === 'https://www.softora.nl/contact' ? 'contact-form' : '';
    return target ? '<a' + attrs + ' data-softora-conversion="article-header-contact" data-softora-conversion-page="' +
      escapeHtml(pagePath) + '" data-softora-conversion-target="' + target + '" data-softora-contact-menu="' + target + '">' : match;
  });
}

function renderOverviewHtml({ siteOrigin, now } = {}) {
  const items = publishedArticles(now);
  const slots = { SEO_HEAD: seoHead(buildSeoContentIndexHtml('blog', { siteOrigin, now })), SITE_HEADER: siteHeader('/blog'),
    ARTICLE_COUNT: items.length, RESULT_COUNT: Math.min(8, items.length) + ' van ' + items.length + ' artikelen',
    ARTICLE_LIST: items.map((item, index) => {
      const cluster = getSeoContentClusterForItem(item).key;
      const image = getSeoContentImageForItem(item);
      const href = escapeHtml(getArticlePreviewPath(item));
      const title = escapeHtml(item.title);
      const date = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' })
        .format(new Date(item.publishedAt + 'T12:00:00+02:00'));
      return '<article class="article-card" data-category="' + cluster + '" data-search="' +
        escapeHtml([item.title, item.summary, item.category, categories[cluster]].join(' ')) + '"' + (index >= 8 ? ' hidden' : '') + '>' +
        '<a class="article-thumbnail" data-softora-navigation="article-link" href="' + href + '" aria-label="' + title + '" tabindex="-1" aria-hidden="true">' +
        '<img src="' + escapeHtml(image.src) + '" alt="" role="presentation" width="128" height="112" loading="lazy" decoding="async" fetchpriority="low"></a>' +
        '<div class="article-copy"><p class="article-category">' + escapeHtml(categories[cluster] || item.category) + '</p>' +
        '<h2><a data-softora-navigation="article-link" href="' + href + '">' + title + '</a></h2><div class="article-meta"><time datetime="' + item.publishedAt + '">' +
        escapeHtml(date) + '</time><span class="separator" aria-hidden="true"></span><span>' + escapeHtml(item.readTime) + ' lezen</span></div></div></article>';
    }).join('\n') };
  return overviewTemplate.replace(/<!-- ([A-Z_]+) -->/g, (_, name) => slots[name] ?? '');
}

function renderArticleHtml(item, { siteOrigin, now } = {}) {
  const original = buildSeoContentArticleHtml(item, { siteOrigin });
  return renderArticlePreview({ item, items: publishedArticles(now), template: articleTemplate,
    original, header: siteHeader(getArticlePreviewPath(item)), category: categories[getSeoContentClusterForItem(item).key] });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function publicOrLocalLink(href, items) {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const item = items.find((entry) => (getSeoContentPathForItem(entry) === href || `/kennisbank/${entry.slug}` === href));
  return item ? getArticlePreviewPath(item) : href;
}

function getArticlePreviewPath(item) {
  return '/blog/' + item.slug;
}

function articleIndex(item) {
  const entries = item.sections.map((section, index) => ({
    id: sectionId(section, index), heading: section.heading,
  }));
  if (item.faq?.length) entries.push({ id: 'veelgestelde-vragen', heading: 'Veelgestelde vragen' });
  return '<ol class="index-list">' + entries.map((entry, index) =>
    '<li><a href="#' + escapeHtml(entry.id) + '" data-softora-navigation="article-section"><span class="index-number" aria-hidden="true" data-index="' +
    String(index + 1).padStart(2, '0') + '"></span><span>' + escapeHtml(entry.heading) + '</span></a></li>'
  ).join('') + '</ol>';
}

function relatedArticles(item, items) {
  const cluster = getSeoContentClusterForItem(item).key;
  const linkedItems = (item.relatedLinks || []).map((link) => items.find((entry) =>
    (getSeoContentPathForItem(entry) === link.href || `/kennisbank/${entry.slug}` === link.href))).filter(Boolean);
  const candidates = [...linkedItems, ...items.filter((entry) => getSeoContentClusterForItem(entry).key === cluster)];
  const selected = [...new Map(candidates.filter((entry) => entry.slug !== item.slug)
    .map((entry) => [getSeoContentPathForItem(entry), entry])).values()].slice(0, 3);
  if (!selected.length) return '';
  return '<section class="related-articles" aria-labelledby="related-title"><h2 id="related-title">Verder lezen</h2>' +
    selected.map((entry) => {
      const image = getSeoContentImageForItem(entry);
      return '<a class="related-article" data-softora-navigation="article-link" href="' + escapeHtml(getArticlePreviewPath(entry)) + '">' +
        '<img src="' + escapeHtml(image.src) + '" alt="" role="presentation" width="84" height="72" loading="lazy" decoding="async" fetchpriority="low">' +
        '<span><strong>' + escapeHtml(entry.title) + '</strong><span>' + escapeHtml(entry.readTime) + ' lezen</span></span>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 5 7 7-7 7M5 12h14"/></svg></a>';
    }).join('') + '</section>';
}

function renderArticlePreview({ item, items, template, header, category, original = buildSeoContentArticleHtml(item) }) {
  // Keep the canonical renderer's paragraphs, inline links, FAQ and supporting image intact.
  // Only its reading body is reused; production scripts and conversion widgets are excluded.
  let body = original.match(/<article class="artikel-body">([\s\S]*?)<\/article>/)?.[1];
  if (!body) throw new Error('De artikelinhoud ontbreekt: ' + item.slug);
  body = body.replace(/<aside class="artikel-eeat"[\s\S]*?<\/aside>/, '')
    .replace('<h2>Veelgestelde vragen</h2>', '<h2 id="veelgestelde-vragen">Veelgestelde vragen</h2>')
    .replace(/href="(\/[^" ]*)"/g, (_, href) => 'href="' + escapeHtml(publicOrLocalLink(href, items)) + '"');
  const image = getSeoContentImageForItem(item);
  const date = new Intl.DateTimeFormat('nl-NL', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam',
  }).format(new Date(item.publishedAt + 'T12:00:00+02:00'));
  const author = item.author?.name || 'Softora';
  const slots = {
    SEO_HEAD: seoHead(original),
    PAGE_TITLE: escapeHtml(item.title),
    SITE_HEADER: header,
    CATEGORY: escapeHtml(category || item.category),
    ARTICLE_TITLE: escapeHtml(item.title),
    ARTICLE_META: '<span data-softora-public-seo="article-author">' + escapeHtml(author) + '</span><span class="meta-dot" aria-hidden="true">·</span>' +
      '<time datetime="' + escapeHtml(item.publishedAt) + '">' + escapeHtml(date) + '</time>' +
      '<span class="meta-dot" aria-hidden="true">·</span><span>' + escapeHtml(item.readTime) + ' lezen</span>',
    ARTICLE_SUMMARY: escapeHtml(item.summary),
    ARTICLE_INDEX: articleIndex(item),
    ARTICLE_IMAGE: '<img src="' + escapeHtml(image.src) + '" alt="' + escapeHtml(image.alt) + '"' + renderSeoImageResponsiveAttributes(image, escapeHtml) +
      ' width="' + Number(image.width || 1672) + '" height="' + Number(image.height || 941) + '"' +
      ' loading="eager" decoding="async" fetchpriority="high">',
    ARTICLE_BODY: body,
    AUTHOR: escapeHtml(author),
    RELATED_ARTICLES: relatedArticles(item, items),
  };
  return template.replace(/<!-- ([A-Z_]+) -->/g, (_, name) => slots[name] ?? '');
}

module.exports = { renderOverviewHtml, renderArticleHtml, publishedArticles, renderArticlePreview, getArticlePreviewPath };

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const express = require('express');
const { registerPublicPageRoutes } = require('../../server/routes/public-pages');
const { renderOverviewHtml, renderArticleHtml, publishedArticles } = require('../../server/services/seo-articles-presentation');
const { buildSeoContentArticleHtml, getSeoContentItem, getSeoContentSitemapEntries } = require('../../server/services/seo-content');
const { auditConversionCtas, auditClaimSafety, auditSeoImages } = require('../../server/services/seo-machine-quality-gates');
let server, origin;
const now = new Date('2026-10-02T12:00:00+02:00');
const articles = publishedArticles(now);
before(async () => {
  const app = express();
  registerPublicPageRoutes(app, {
    assetsDirectory: path.resolve(__dirname, '../../assets'), knownHtmlPageFiles: new Set(),
    knownPrettyPageSlugToFile: new Map(), getEffectivePublicBaseUrl: () => 'https://www.softora.nl',
    resolveLegacyPrettyPageRedirect: () => '', sendPublishedWebsiteLinkResponse: async () => false,
  });
  server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
const graph = (html) => JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'];
const paragraphs = (html) => DomUtils.getElementsByTagName('p', parseDocument(html)).map(DomUtils.textContent);

test('public overview and all 52 article routes serve the approved layout with their original content and SEO', async () => {
  assert.equal(articles.length, 52);
  const currentArticles = publishedArticles();
  const response = await fetch(origin + '/blog');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), null);
  const overview = await response.text();
  assert.match(overview, /Alle artikelen/);
  assert.match(overview, /<a class="overview-back" href="\/toekomst" aria-label="Terug naar de keuzepagina">/);
  assert.ok(overview.indexOf('class="overview-back"') < overview.indexOf('id="articles-title"'), 'Return link must appear above the article heading');
  assert.doesNotMatch(overview, /noindex|Kennisbank|<footer|content-menu/);
  assert.equal((overview.match(/class="article-card"/g) || []).length, currentArticles.length);
  assert.equal((overview.match(/class="article-card"[^>]* hidden>/g) || []).length, Math.max(0, currentArticles.length - 8));
  const list = graph(overview).find((node) => node['@type'] === 'ItemList');
  assert.deepEqual(list.itemListElement.map((item) => item.url), currentArticles.map((item) => 'https://www.softora.nl/blog/' + item.slug));
  const totals = {};
  for (const item of articles) {
    const result = await fetch(origin + '/blog/' + item.slug);
    assert.equal(result.status, 200, item.slug);
    const html = await result.text();
    assert.match(html, /data-softora-articles-layout="v1"/);
    assert.match(html, /src="\/assets\/public-conversion-tracking\.js\?v=20260601a"/);
    assert.doesNotMatch(html, /noindex|href="\/kennisbank|<!-- [A-Z_]+ -->|whatsapp-widget|seo-content\.css/);
    assert.ok(html.includes('<link rel="canonical" href="https://www.softora.nl/blog/' + item.slug + '">'));
    const schema = graph(html).find((node) => node['@type'] === 'Article');
    assert.equal(schema.author.name, item.author.name);
    assert.equal(schema.datePublished, item.publishedAt);
    assert.equal(schema.dateModified, item.updatedAt || item.publishedAt);
    assert.equal((html.match(/data-softora-public-seo="article-author"/g) || []).length, 2);
    const prose = html.match(/<article class="article-prose"[^>]*>([\s\S]*?)<\/article>/)[1];
    const original = buildSeoContentArticleHtml(item).match(/<article class="artikel-body">([\s\S]*?)<\/article>/)[1].replace(/<aside class="artikel-eeat"[\s\S]*?<\/aside>/, '');
    assert.deepEqual(paragraphs(prose), paragraphs(original), item.slug);
    for (const [, id] of html.matchAll(/href="#(onderdeel-[^"]+|veelgestelde-vragen)"/g)) assert.ok(prose.includes('id="' + id + '"'), item.slug);
    totals[item.author.name] = (totals[item.author.name] || 0) + 1;
  }
  assert.deepEqual(totals, { 'Martijn van de Ven': 26, 'Servé Creusen': 26 });
});

test('legacy knowledge URLs permanently redirect with their queries; invalid and unpublished articles remain unavailable', async () => {
  for (const oldPath of ['/kennisbank', ...articles.filter((item) => item.collection === 'kennisbank').map((item) => '/kennisbank/' + item.slug)]) {
    const response = await fetch(origin + oldPath + '?utm_source=bookmark&x=1', { redirect: 'manual' });
    assert.equal(response.status, 301, oldPath);
    assert.equal(response.headers.get('location'), oldPath.replace('/kennisbank', '/blog') + '?utm_source=bookmark&x=1');
  }
  for (const route of ['/kennisbank/unknown', '/blog/unknown']) assert.equal((await fetch(origin + route, { redirect: 'manual' })).status, 404);
  assert.equal(getSeoContentItem('blog', 'crm-migratie-stappenplan', { now: '2026-09-08' }), null);
  assert.equal(getSeoContentItem('kennisbank', 'crm-migratie-stappenplan', { now: '2026-09-08' }), null);
  const entries = getSeoContentSitemapEntries({ now });
  assert.equal(entries.filter((entry) => entry.path.startsWith('/kennisbank')).length, 0);
  assert.ok(entries.some((entry) => entry.path === '/blog/wat-is-een-crm-systeem'));
});

test('production header shares Toekomst markup and assets are available for both article layouts', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../assets/entry/toekomst.html'), 'utf8').match(/<header>([\s\S]*?)<\/header>/)[1];
  for (const html of [renderOverviewHtml({ now }), renderArticleHtml(articles[0], { now })]) {
    const header = html.match(/<div class="header-inner">([\s\S]*?)<\/header>/)[1].replace(/\s*<\/div>\s*$/, '').replace(/ data-softora-(?:conversion(?:-page|-target)?|contact-menu)="[^"]*"/g, '');
    assert.equal(header.trim(), source.trim());
  }
  for (const asset of ['overview.css', 'article.css', 'header.css', 'overview.js', 'article.js']) assert.equal((await fetch(origin + '/assets/articles/' + asset)).status, 200, asset);
});

test('article headers constrain contact images and keep the SEO login image smaller than the chatbot', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../assets/articles/header.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const declarations = (selector) => rules.find(([, selectors]) => selectors.split(',').some((entry) => entry.trim() === selector))?.[2] || '';
  for (const selector of ['.site-header .login-options .login-avatar', '.site-header .contact-options .contact-avatar']) {
    const style = declarations(selector);
    assert.match(style, /width:\s*36px;/, selector);
    assert.match(style, /height:\s*36px;/, selector);
    assert.match(style, /background:\s*transparent;/, selector);
  }
  for (const selector of ['.site-header .login-avatar img', '.site-header .contact-avatar img']) {
    const style = declarations(selector);
    assert.match(style, /width:\s*100%;/, selector);
    assert.match(style, /height:\s*100%;/, selector);
    assert.match(style, /object-fit:\s*contain;/, selector);
  }
  const seoStyle = declarations('.site-header .login-options .login-avatar--seo img');
  assert.match(seoStyle, /width:\s*85%;/);
  assert.match(seoStyle, /height:\s*85%;/);
  for (const html of [renderOverviewHtml({ now }), renderArticleHtml(articles[0], { now })]) {
    assert.match(html, /header\.css\?v=articles-icons-20261002/);
    for (const name of ['form', 'whatsapp', 'phone']) {
      assert.match(html, new RegExp('class="contact-option-icon contact-avatar"[^>]*><img src="/assets/entry/contact-' + name + '-icon-v1\\.webp"'));
    }
  }
});

test('the new presentation preserves existing claim and image checks and introduces no unsafe contact actions', () => {
  const baselineImages = new Set(auditSeoImages({ pages: articles.map((item) => ({ path: '/blog/' + item.slug, html: buildSeoContentArticleHtml(item) })) }).map((issue) => issue.type));
  for (const item of articles) {
    const pagePath = '/blog/' + item.slug;
    const page = { path: pagePath, html: renderArticleHtml(item, { now }) };
    const legacy = { path: pagePath, html: buildSeoContentArticleHtml(item) };
    const baselineClaims = new Set(auditClaimSafety({ pages: [legacy] }).map((issue) => issue.type));
    for (const issue of auditClaimSafety({ pages: [page] })) assert.ok(baselineClaims.has(issue.type), item.slug + ': ' + issue.type);
    for (const issue of auditSeoImages({ pages: [page] })) assert.ok(baselineImages.has(issue.type), item.slug + ': ' + issue.type);
    const baselineCtas = new Set(auditConversionCtas({ pages: [legacy] }).map((issue) => issue.type));
    for (const issue of auditConversionCtas({ pages: [page] })) assert.ok(baselineCtas.has(issue.type), item.slug + ': ' + issue.type);
  }
  assert.deepEqual(auditConversionCtas({ pages: [{ path: '/blog', html: renderOverviewHtml({ now }) }] }), []);
});


test('Vercel functions carry the article templates and shared header required by runtime rendering', () => {
  const config = require('../../vercel.json');
  for (const entry of ['api/index.js', 'api/[...path].js']) {
    assert.ok(config.functions[entry].includeFiles.includes('assets/articles/*.html'), entry);
    assert.ok(config.functions[entry].includeFiles.includes('assets/entry/toekomst.html'), entry);
  }
});

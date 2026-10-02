const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { parseDocument, DomUtils } = require('htmlparser2');
const { createPreviewServer } = require('../../scripts/blog-local-preview');
const { getSeoContentItems, buildSeoContentArticleHtml, getSeoContentPathForItem } = require('../../server/services/seo-content');

let server;
let origin;
before(async () => {
  server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('one local overview combines both sources, newest first, with eight visible articles', async () => {
  const response = await fetch(origin + '/blog');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const html = await response.text();
  assert.match(html, /<h1 id="articles-title">Alle artikelen<\/h1>/);
  assert.doesNotMatch(html, /role="tab(?:list|panel)?"|collection-tabs|data-collection|Kennisbank/);
  assert.doesNotMatch(html, /menu-toggle|id="site-menu"/);
  assert.match(html, /<details class="login-menu">/);
  assert.match(html, /<details class="contact-menu">/);
  assert.match(html, /href="\/seo-login"/);
  assert.match(html, /src="\/assets\/entry\/contact-menu\.js"/);
  assert.doesNotMatch(html, /<footer\b/);
  assert.doesNotMatch(html, /class="intro"|class="featured"|FEATURED_ARTICLE|class="conversation"|Laten we kennismaken/);
  const items = ['blog', 'kennisbank'].flatMap((collection) => getSeoContentItems({ collection }));
  assert.equal((html.match(/class="article-card"/g) || []).length, items.length);
  assert.equal((html.match(/class="article-card"[^>]* hidden>/g) || []).length, items.length - 8);
  items.forEach((item) => assert.ok(html.includes('href="/blog/' + item.slug + '"')));
  const listing = html.slice(html.indexOf('id="article-list"'));
  const dates = [...listing.matchAll(/<time datetime="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(dates, [...dates].sort((a, b) => b.localeCompare(a)));
});

test('legacy knowledge URLs lead to the unified overview and article routes', async () => {
  const response = await fetch(origin + '/kennisbank', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/blog');
  const items = getSeoContentItems({ collection: 'kennisbank', now: new Date('2026-10-02T12:00:00+02:00') });
  for (const item of items) {
    const legacy = await fetch(origin + '/kennisbank/' + item.slug, { redirect: 'manual' });
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/blog/' + item.slug);
  }
  const article = await fetch(origin + '/kennisbank/wat-is-een-crm-systeem');
  assert.equal(article.status, 200);
  assert.equal(article.url, origin + '/blog/wat-is-een-crm-systeem');
  const articleHtml = await article.text();
  assert.match(articleHtml, /class="article-back" href="\/blog"/);
  assert.match(articleHtml, /Terug naar artikelen/);
  assert.doesNotMatch(articleHtml, /Terug naar kennisbank|Alle kennisbank|href="\/kennisbank\//);
  assert.match(articleHtml, /class="article-sidebar"/);
});

test('the local toekomst chooser retains the latest public landing destinations', async () => {
  const html = await (await fetch(origin + '/toekomst')).text();
  for (const route of ['/chatbot', '/seo-solution']) {
    assert.ok(html.includes('<a class="choice" href="' + route + '"'));
    const response = await fetch(origin + route, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://www.softora.nl' + route);
  }
});

test('local blog serves real article content and local assets without conversion scripts', async () => {
  const article = await fetch(origin + '/blog/ai-automatisering-mkb-waar-beginnen');
  assert.equal(article.status, 200);
  const html = await article.text();
  assert.match(html, /AI automatisering voor het MKB: waar begin je\?/);
  assert.match(html, /class="article-back" href="\/blog"/);
  assert.match(html, /Terug naar artikelen/);
  assert.match(html, /<details class="login-menu">/);
  assert.match(html, /<details class="contact-menu">/);
  assert.doesNotMatch(html, /content-menu|whatsapp-widget|seo-content\.css/);
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]), [
    '/assets/entry/contact-menu.js', '/assets/articles/article.js?v=articles-20261002',
  ]);
  for (const file of ['/assets/articles/overview.css', '/assets/articles/overview.js', '/assets/articles/header.css', '/assets/articles/article.css', '/assets/articles/article.js?v=articles-20261002', '/assets/entry/contact-menu.js', '/assets/fonts/inter-latin.woff2']) {
    const response = await fetch(origin + file);
    assert.equal(response.status, 200, file);
  }
});

test('every local article preserves canonical reading content, FAQ and working section anchors', async () => {
  const now = new Date('2026-10-02T12:00:00+02:00');
  const items = ['blog', 'kennisbank'].flatMap((collection) => getSeoContentItems({ collection, now }));
  const paragraphText = (body) => DomUtils.getElementsByTagName('p', parseDocument(body)).map(DomUtils.textContent);
  for (const item of items) {
    const response = await fetch(origin + '/blog/' + item.slug);
    assert.equal(response.status, 200, item.slug);
    const html = await response.text();
    assert.ok(html.includes('<div class="article-byline"><span data-softora-public-seo="article-author">' + item.author.name + '</span>'), item.slug);
    assert.ok(html.includes('Geschreven door <span data-softora-public-seo="article-author">' + item.author.name + '</span>'), item.slug);
    const body = html.match(/<article class="article-prose"[^>]*>([\s\S]*?)<\/article>/)?.[1];
    const original = buildSeoContentArticleHtml(item).match(/<article class="artikel-body">([\s\S]*?)<\/article>/)[1]
      .replace(/<aside class="artikel-eeat"[\s\S]*?<\/aside>/, '');
    assert.deepEqual(paragraphText(body), paragraphText(original), item.slug);
    assert.equal((body.match(/<h2\b/g) || []).length, item.sections.length + (item.faq?.length ? 1 : 0), item.slug);
    for (const [, id] of html.matchAll(/<a href="#(onderdeel-[^"]+|veelgestelde-vragen)"/g)) {
      assert.ok(body.includes('id="' + id + '"'), item.slug + ': ' + id);
    }
    assert.doesNotMatch(html, /<!-- [A-Z_]+ -->/);
    assert.match(html, /class="article-back" href="\/blog"/);
  }
});

test('local review server rejects mutations, private files and directory traversal', async () => {
  const post = await fetch(origin + '/blog', { method: 'POST' });
  assert.equal(post.status, 405);
  for (const file of ['/.env', '/package.json', '/server.js', '/api/outreach/provider-upload', '/assets/%2e%2e%2fpackage.json', '/blog/nonexistent']) {
    const response = await fetch(origin + file);
    assert.equal(response.status, 404, file);
  }
});

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const express = require('express');
const { parseDocument, DomUtils } = require('htmlparser2');
const { registerPublicPageRoutes } = require('../../server/routes/public-pages');
const {
  getSeoContentItem, getSeoContentSitemapEntries, renderSeoParagraph,
} = require('../../server/services/seo-content');
const { renderArticleHtml, renderOverviewHtml } = require('../../server/services/seo-articles-presentation');

const now = new Date('2026-10-07T12:00:00+02:00');
const slug = 'website-snelheid-verbeteren';
const route = '/blog/' + slug;
const canonical = 'https://www.softora.nl' + route;
const item = getSeoContentItem('blog', slug, { now });
const nodes = (html) => DomUtils.findAll(() => true, parseDocument(html).children);
const text = (paragraph) => typeof paragraph === 'string' ? paragraph : paragraph.text;
const words = (value) => value.trim().split(/\s+/).filter(Boolean).length;
const schemaGraph = (html) => JSON.parse(nodes(html).find((node) =>
  node.name === 'script' && node.attribs.type === 'application/ld+json').children[0].data)['@graph'];
let server, origin;
before(async () => {
  const app = express();
  registerPublicPageRoutes(app, {
    assetsDirectory: path.resolve(__dirname, '../../assets'), knownHtmlPageFiles: new Set(),
    knownPrettyPageSlugToFile: new Map(), getEffectivePublicBaseUrl: () => 'https://www.softora.nl',
    resolveLegacyPrettyPageRedirect: () => '', sendPublishedWebsiteLinkResponse: async () => false,
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('speed article answers first and exceeds 1000 explanation words without metadata, captions or summary', () => {
  assert.equal(item.qualityVersion, 2);
  assert.equal(item.sections[0].heading, 'In het kort');
  assert.match(text(item.sections[0].paragraphs[0]), /Meet eerst/);
  const explanation = item.sections.filter((section) => !['In het kort', 'Over deze uitleg'].includes(section.heading));
  assert.ok(explanation.reduce((total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + words(text(paragraph)), 0), 0) >= 1000);
  assert.equal(item.wordCount, item.sections.reduce((total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + words(text(paragraph)), 0), 0));
  assert.equal(item.author.type, 'Organization');
  assert.equal(item.author.name, 'Softora');
  assert.equal(item.reviewedBy, undefined);
  assert.equal(item.reviewEvidence, undefined);
});

test('new article renders exactly four distinct responsive WebP content images with real dimensions and loading priorities', async () => {
  const html = renderArticleHtml(item, { now });
  const elements = nodes(html);
  const cover = elements.find((node) => node.name === 'figure' && node.attribs.class === 'article-cover');
  const prose = elements.find((node) => node.name === 'article' && node.attribs.class === 'article-prose');
  const images = [...DomUtils.getElementsByTagName('img', cover), ...DomUtils.getElementsByTagName('img', prose)];
  assert.equal(images.length, 4);
  assert.equal(new Set(images.map((image) => image.attribs.src)).size, 4);
  const hashes = [];
  for (const [index, image] of images.entries()) {
    const a = image.attribs;
    assert.match(a.src, /^\/assets\/seo-content\/website-snelheid-[a-z-]+\.webp$/);
    assert.ok(a.alt.length > 20);
    assert.equal(a.loading, index === 0 ? 'eager' : 'lazy');
    assert.equal(a.fetchpriority, index === 0 ? 'high' : 'low');
    assert.equal(a.decoding, 'async');
    assert.match(a.sizes, /100vw/);
    const variants = a.srcset.split(',').map((variant) => variant.trim().split(/\s+/));
    assert.equal(variants.length, 2);
    for (const [src, width] of variants) {
      const file = path.resolve(__dirname, '../..', '.' + src);
      const meta = await sharp(file).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, Number(width.replace(/w$/, '')));
      assert.ok(fs.statSync(file).size < 150000);
      if (src === a.src) {
        assert.equal(meta.width, Number(a.width));
        assert.equal(meta.height, Number(a.height));
        hashes.push(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
      }
      const response = await fetch(origin + src);
      assert.equal(response.status, 200, src);
      assert.match(response.headers.get('content-type'), /image\/webp/);
    }
  }
  assert.equal(new Set(hashes).size, 4);
  const support = elements.filter((node) => node.name === 'figure' && node.attribs.class === 'artikel-support-image');
  assert.equal(support.length, 3);
  for (const figure of support) assert.ok(DomUtils.getElementsByTagName('figcaption', figure).length);
});

test('published public route, canonical, Article schema and image sitemap agree with visible content', async () => {
  assert.equal(getSeoContentItem('blog', slug, { now: '2026-10-06' }), null);
  assert.equal(getSeoContentSitemapEntries({ now: '2026-10-06' }).some((entry) => entry.path === route), false);
  const response = await fetch(origin + route);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), null);
  const html = await response.text();
  const elements = nodes(html);
  assert.equal(elements.find((node) => node.name === 'link' && node.attribs.rel === 'canonical').attribs.href, canonical);
  assert.match(elements.find((node) => node.name === 'meta' && node.attribs.name === 'robots').attribs.content, /^index, follow/);
  assert.equal(elements.find((node) => node.name === 'meta' && node.attribs.name === 'description').attribs.content, item.description);
  const schema = schemaGraph(html).find((node) => node['@type'] === 'Article');
  assert.equal(schema.headline, item.title);
  assert.equal(schema.author['@type'], 'Organization');
  assert.equal(schema.author.name, 'Softora');
  assert.equal(schema.datePublished, '2026-10-07');
  assert.equal(schema.dateModified, '2026-10-07');
  assert.equal(schema.wordCount, item.wordCount);
  assert.equal(schema.image.length, 4);
  assert.equal(schema.reviewedBy, undefined);
  const entry = getSeoContentSitemapEntries({ now }).find((entry) => entry.path === route);
  assert.equal(entry.lastmod, '2026-10-07');
  assert.deepEqual(schema.image.map((image) => image.contentUrl), entry.images.map((image) => 'https://www.softora.nl' + image.loc));
  assert.match(renderOverviewHtml({ now }), /datetime="2026-10-07"/);
  assert.match(renderOverviewHtml({ now }), /href="\/blog\/website-snelheid-verbeteren"/);
});

test('contextual source and cluster links render, and the maintenance guide links back without changing its publication date', () => {
  const html = renderArticleHtml(item, { now });
  const elements = nodes(html);
  for (const source of item.sources) {
    assert.ok(elements.some((node) => node.name === 'a' && node.attribs.href === source.url), source.title);
  }
  for (const href of ['/website-laten-maken', '/blog/website-onderhoud-kosten-mkb', '/blog/website-migratie-zonder-seo-verlies', '/blog/wat-is-een-conversiegerichte-website', '/blog/website-briefing-maken-mkb']) {
    assert.ok(elements.some((node) => node.name === 'a' && node.attribs.href === href), href);
  }
  const maintenance = getSeoContentItem('blog', 'website-onderhoud-kosten-mkb', { now });
  assert.equal(maintenance.publishedAt, '2026-09-01');
  assert.equal(maintenance.growthEventAt, '2026-09-01');
  assert.equal(maintenance.updatedAt, '2026-10-07');
  assert.match(renderArticleHtml(maintenance, { now }), /<a href="\/blog\/website-snelheid-verbeteren">website snelheid verbeteren<\/a>/);
  const old = getSeoContentItem('blog', 'website-onderhoud-kosten-mkb', { now: '2026-10-06' });
  assert.doesNotMatch(renderArticleHtml(old, { now: new Date('2026-10-06T12:00:00Z') }), /href="\/blog\/website-snelheid-verbeteren"/);
});

test('paragraph sources require an explicit safe HTTPS link and escape markup without changing legacy external-link behavior', () => {
  const paragraph = (href, source = true) => ({ text: '<Bron> en interne uitleg', links: [
    { anchor: '<Bron>', href, source }, { anchor: 'interne uitleg', href: '/blog/uitleg' },
  ] });
  assert.match(renderSeoParagraph(paragraph('https://web.dev/articles/vitals?a=1&b=2')), /<a href="https:\/\/web.dev\/articles\/vitals\?a=1&amp;b=2">&lt;Bron&gt;<\/a>/);
  for (const href of ['javascript:alert(1)', 'data:text/html,evil', '//evil.example/path', 'http://evil.example/path', 'https://user:pass@evil.example/path']) {
    const html = renderSeoParagraph(paragraph(href));
    assert.ok(html.startsWith('&lt;Bron&gt; en '), href);
    assert.match(html, /<a href="\/blog\/uitleg">interne uitleg<\/a>/);
  }
  assert.ok(renderSeoParagraph(paragraph('https://web.dev/articles/vitals', false)).startsWith('&lt;Bron&gt; en '));
});

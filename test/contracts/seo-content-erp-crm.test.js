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
const { getSeoContentItem, getSeoContentSitemapEntries } = require('../../server/services/seo-content');
const { renderArticleHtml, renderOverviewHtml } = require('../../server/services/seo-articles-presentation');

const now = new Date('2026-10-09T12:00:00+02:00');
const previousDay = new Date('2026-10-08T12:00:00+02:00');
const route = '/blog/erp-vs-crm';
const canonical = 'https://www.softora.nl' + route;
const item = getSeoContentItem('blog', 'erp-vs-crm', { now });
const nodes = html => DomUtils.findAll(() => true, parseDocument(html).children);
const words = value => value.trim().split(/\s+/).filter(Boolean).length;
const paragraphText = paragraph => typeof paragraph === 'string' ? paragraph : paragraph.text;
const graph = html => JSON.parse(nodes(html).find(node =>
  node.name === 'script' && node.attribs.type === 'application/ld+json').children[0].data)['@graph'];
let server, origin;

before(async () => {
  const app = express();
  registerPublicPageRoutes(app, {
    assetsDirectory: path.resolve(__dirname, '../../assets'), knownHtmlPageFiles: new Set(),
    knownPrettyPageSlugToFile: new Map(), getEffectivePublicBaseUrl: () => 'https://www.softora.nl',
    resolveLegacyPrettyPageRedirect: () => '', sendPublishedWebsiteLinkResponse: async () => false,
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  origin = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('ERP versus CRM answers the comparison first and contains more than 1000 explanation words', () => {
  assert.equal(item.qualityVersion, 2);
  assert.equal(item.sections[0].heading, 'In het kort');
  assert.match(paragraphText(item.sections[0].paragraphs[0]), /CRM ondersteunt.*ERP verbindt/);
  const explanation = item.sections.filter(section => !['In het kort', 'Over deze uitleg'].includes(section.heading));
  assert.ok(explanation.reduce((total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + words(paragraphText(paragraph)), 0), 0) >= 1000);
  assert.equal(item.wordCount, item.sections.reduce((total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + words(paragraphText(paragraph)), 0), 0));
  assert.equal(item.author.type, 'Organization');
  assert.equal(item.author.name, 'Softora');
  assert.equal(item.reviewedBy, undefined);
  assert.equal(item.reviewEvidence, undefined);
  assert.match(paragraphText(item.sections.at(-1).paragraphs[0]), /hulp van AI.*fictieve uitlegscenario/);
});

test('four different article images have real WebP variants, reserved dimensions and correct loading priorities', async () => {
  const elements = nodes(renderArticleHtml(item, { now }));
  const cover = elements.find(node => node.name === 'figure' && node.attribs.class === 'article-cover');
  const prose = elements.find(node => node.name === 'article' && node.attribs.class === 'article-prose');
  const images = [...DomUtils.getElementsByTagName('img', cover), ...DomUtils.getElementsByTagName('img', prose)];
  assert.equal(images.length, 4);
  assert.equal(new Set(images.map(image => image.attribs.src)).size, 4);
  const hashes = [];
  for (const [index, image] of images.entries()) {
    const a = image.attribs;
    assert.match(a.src, /^\/assets\/seo-content\/erp-crm-[a-z-]+\.webp$/);
    assert.ok(a.alt.length > 25);
    assert.equal(a.loading, index === 0 ? 'eager' : 'lazy');
    assert.equal(a.fetchpriority, index === 0 ? 'high' : 'low');
    assert.equal(a.decoding, 'async');
    assert.match(a.sizes, /100vw/);
    const variants = a.srcset.split(',').map(variant => variant.trim().split(/\s+/));
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
  assert.equal(elements.filter(node => node.name === 'figure' && node.attribs.class === 'artikel-support-image').length, 3);
});

test('public route, Article schema, canonical and image sitemap match the article and its real publication date', async () => {
  assert.equal(getSeoContentItem('blog', 'erp-vs-crm', { now: previousDay }), null);
  const response = await fetch(origin + route);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), null);
  const html = await response.text();
  const elements = nodes(html);
  assert.equal(elements.find(node => node.name === 'link' && node.attribs.rel === 'canonical').attribs.href, canonical);
  assert.match(elements.find(node => node.name === 'meta' && node.attribs.name === 'robots').attribs.content, /^index, follow/);
  assert.equal(elements.find(node => node.name === 'meta' && node.attribs.name === 'description').attribs.content, item.description);
  assert.equal(DomUtils.textContent(elements.find(node => node.name === 'h1')), item.title);
  const schema = graph(html).find(node => node['@type'] === 'Article');
  assert.equal(schema.headline, item.title);
  assert.equal(schema.author['@type'], 'Organization');
  assert.equal(schema.author.name, 'Softora');
  assert.equal(schema.datePublished, '2026-10-09');
  assert.equal(schema.dateModified, '2026-10-09');
  assert.equal(schema.wordCount, item.wordCount);
  assert.equal(schema.image.length, 4);
  assert.equal(schema.reviewedBy, undefined);
  const entry = getSeoContentSitemapEntries({ now }).find(candidate => candidate.path === route);
  assert.equal(entry.lastmod, '2026-10-09');
  assert.deepEqual(schema.image.map(image => image.contentUrl), entry.images.map(image => 'https://www.softora.nl' + image.loc));
});

test('publication adds one blog URL for this calendar day and appears in the dated overview', () => {
  const previous = new Set(getSeoContentSitemapEntries({ now: previousDay }).filter(entry => entry.path.startsWith('/blog/')).map(entry => entry.path));
  const current = getSeoContentSitemapEntries({ now }).filter(entry => entry.path.startsWith('/blog/')).map(entry => entry.path);
  assert.deepEqual(current.filter(url => !previous.has(url)), [route]);
  const elements = nodes(renderOverviewHtml({ now }));
  const articleLink = elements.find(node => node.name === 'a' && node.attribs.href === route);
  assert.ok(articleLink);
  const card = elements.find(node => node.name === 'article' &&
    DomUtils.getElementsByTagName('a', node).some(link => link.attribs.href === route));
  assert.ok(card);
  assert.equal(DomUtils.getElementsByTagName('time', card)[0].attribs.datetime, '2026-10-09');
});

test('sources and contextual cluster links render and the cost guide links back without republishing', () => {
  const elements = nodes(renderArticleHtml(item, { now }));
  const prose = elements.find(node => node.name === 'article' && node.attribs.class === 'article-prose');
  const links = DomUtils.getElementsByTagName('a', prose).map(node => node.attribs.href);
  for (const source of item.sources) assert.ok(links.includes(source.url), source.title);
  for (const href of ['/bedrijfssoftware-op-maat', '/blog/crm-eisen-wensenlijst-mkb', '/blog/wat-is-een-crm-integratie', '/blog/crm-systeem-kosten-mkb']) {
    assert.ok(links.includes(href), href);
  }
  const cost = getSeoContentItem('blog', 'crm-systeem-kosten-mkb', { now });
  assert.equal(cost.publishedAt, '2026-07-19');
  assert.equal(cost.growthEventAt, '2026-09-24');
  assert.equal(cost.updatedAt, '2026-10-09');
  assert.match(renderArticleHtml(cost, { now }), /<a href="\/blog\/erp-vs-crm">verschil tussen ERP en CRM<\/a>/);
  const old = getSeoContentItem('blog', 'crm-systeem-kosten-mkb', { now: previousDay });
  assert.doesNotMatch(renderArticleHtml(old, { now: previousDay }), /href="\/blog\/erp-vs-crm"/);
});

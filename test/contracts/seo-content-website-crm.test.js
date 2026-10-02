const test = require('node:test');
const assert = require('node:assert/strict');
const { getSeoContentItem, buildSeoContentArticleHtml } = require('../../server/services/seo-content');

test('website CRM intake separates receipt, persistence and ownership without padding', () => {
  const item = getSeoContentItem('blog', 'website-crm-koppeling-leadopvolging-mkb');
  const html = buildSeoContentArticleHtml(item);
  assert.equal(item.qualityVersion, 2);
  assert.equal(item.visualQualityVersion, 2);
  assert.equal(item.publishedAt, '2026-06-11');
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.growthEventAt, '2026-10-02');
  assert.equal(item.sections.length, 7);
  assert.deepEqual(item.faq, []);
  assert.match(html, /bedankpagina bewijst nog niet/);
  assert.match(html, /Timeout na mogelijke opslag/);
  assert.match(html, /Verwar een contact niet met een aanvraag/);
  assert.match(html, /API-geheimen nooit in browsercode/);
  assert.match(html, /geen extra omzet/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-crm-integratie"/);
  assert.match(html, /href="\/blog\/ai-automatisering-leadopvolging"/);
  assert.doesNotMatch(html, /Voor zoekintentie|Welke content en interne links erbij horen|Hoe weet ik of de pagina goed genoeg is/);
  assert.equal(item.image.width, 1600);
  assert.equal(item.secondaryImage.height, 900);
  assert.notEqual(item.visualBrief.hero.visualFamily, item.visualBrief.support.visualFamily);
  assert.match(html, /website-crm-ontvangst-textiel-softora.jpg/);
  assert.match(html, /website-crm-zes-acceptatietests-softora.jpg/);
  assert.match(html, /max-image-preview:large/);
  assert.match(html, /https:\/\/wa.me\/31643262792/);
  assert.doesNotMatch(html, /wa.me\/31643262792\?/);
});

test('general integration guide points to form-specific acceptance without replacing its scope', () => {
  const item = getSeoContentItem('kennisbank', 'wat-is-een-crm-integratie');
  const html = buildSeoContentArticleHtml(item);
  assert.match(html, /Voor een websiteformulier begint het bewijs bij ontvangst, niet bij een verzendknop/);
  assert.match(html, /href="\/blog\/website-crm-koppeling-leadopvolging-mkb">website en CRM koppelen<\/a>/);
  assert.match(html, /Wijs per gegeven één leidend systeem aan/);
  assert.match(html, /href="\/blog\/crm-eisen-wensenlijst-mkb"/);
});

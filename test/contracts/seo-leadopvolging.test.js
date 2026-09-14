const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getSeoContentItem, getSeoContentItems, buildSeoContentArticleHtml } = require('../../server/services/seo-content');

test('leadopvolging replaces the legacy article with one native scoped workflow', () => {
  const items = getSeoContentItems().filter(x => x.slug === 'ai-automatisering-leadopvolging');
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.qualityVersion, 2);
  assert.equal(item.growthEventKind, 'substantial_refresh');
  assert.equal(item.publishedAt, '2026-05-28');
  assert.equal(item.updatedAt, '2026-09-14');
  assert.equal(item.sections.length, 6);
  assert.deepEqual(item.faq, []);
  const html = buildSeoContentArticleHtml(item);
  for (const text of ['Scheid voorbereid, opgeslagen en uitgevoerd', 'CRM-timeout', 'Dubbele aanvraag', 'Reactie tijdens een wachtstap', 'Illustratief voorbeeld, geen klantresultaat']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Welke eerste stap meestal het meeste oplevert|Welke content en interne links erbij horen|FAQPage/);
  assert.match(html, /href="\/blog\/ai-automatisering-leadkwalificatie-mkb">criteria voor kwalificatie<\/a>/);
  assert.match(html, /href="\/ai-automatisering">AI automatisering<\/a>/);
  assert.match(html, /href="\/crm-systeem-op-maat">CRM systeem op maat<\/a>/);
  assert.match(html, /"dateModified":"2026-09-14"/);
});

test('leadopvolging owns two preview-safe assets and four-call Dutch advisory evidence', () => {
  const item = getSeoContentItem('blog', 'ai-automatisering-leadopvolging');
  assert.equal(item.visualQualityVersion, 2);
  assert.notEqual(item.visualBrief.hero.visualFamily, item.visualBrief.support.visualFamily);
  assert.notEqual(item.visualBrief.hero.visualType, item.visualBrief.support.visualType);
  for (const image of [item.image, item.secondaryImage]) {
    assert.equal(image.width, 1600);
    assert.equal(image.height, 900);
    assert.equal(image.sourceType, 'trainedAlgorithmicMedia');
    assert.ok(fs.statSync(path.join(__dirname, '../..', image.src)).size < 300 * 1024);
  }
  assert.equal(item.keywordEvidence.callsUsed, 4);
  assert.equal(item.keywordEvidence.locale.locId, 2528);
  assert.equal(item.keywordEvidence.locale.language, 'Dutch');
  assert.equal(item.keywordEvidence.decision.ubersuggest, 'advisory_only');
  const html = buildSeoContentArticleHtml(item);
  assert.match(html, /max-image-preview:large/);
  assert.match(html, /ImageObject/);
  assert.equal((html.match(/<figure class="artikel-img">/g) || []).length, 1);
  assert.equal((html.match(/<figure class="artikel-support-image">/g) || []).length, 1);
});

test('qualification hands off a concrete task without claiming execution', () => {
  const html = buildSeoContentArticleHtml(getSeoContentItem('blog', 'ai-automatisering-leadkwalificatie-mkb'));
  assert.match(html, /Geef de gekozen route mee als een uitvoerbare opvolgtaak/);
  assert.match(html, /een goedgekeurde kwalificatie is nog geen uitgevoerde actie/);
  assert.match(html, /href="\/blog\/ai-automatisering-leadopvolging">Leadopvolging<\/a>/);
});

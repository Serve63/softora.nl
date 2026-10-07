const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPlaceholderWebsiteScan } = require('../../server/services/website-preview-placeholder');
const { createSeoCore } = require('../../server/services/seo-core');
const { createAiRemoteService } = require('../../server/services/ai-remote');
const { createAiToolsCoordinator } = require('../../server/services/ai-tools');
const { buildWebdesignPipelineOptions } = require('../../server/services/design-photo-generation-policy');
const { normalizeWebsitePreviewTargetUrl } = require('../../server/security/public-url');

const website = 'https://voorbeeld.test/';
const reservedNotice = 'English This domain is now reserved. As of now, no content has been uploaded. ' +
  'Deutsch Diese Domain wurde soeben freigeschaltet. Es wurden noch keine Inhalte hinterlegt. ' +
  'Español Esta página web acaba de ser activada y aún no tiene contenido. ' +
  'Nederlands Deze website werd zojuist geregistreerd. Een webinhoud werd nog niet toegevoegd. ' +
  'Français Cette page web vient juste d’être activée. Elle n’a pour l’instant aucun contenu. ' +
  'Italiano Questo sito web è appena stato attivato. Ancora non c’è contenuto. Powered by STRATO';
const providerMenu = 'Hosting VPS SSL domeinnamen websites WordPress e-mail webmail contact klantenservice '.repeat(8);
const fixtures = [
  { title: 'STRATO - Domain reserved', body: reservedNotice },
  { title: 'Domein Gereserveerd - Mijndomein.nl', body: providerMenu },
  { title: 'Deze website is op dit moment niet bereikbaar.', body: `Yourhosting ${providerMenu}` },
];

function pipelineFor({ title, body }, mode) {
  const requests = [];
  const forbiddenProviderCall = () => assert.fail('A placeholder must be rejected before any image/provider request');
  const remote = createAiRemoteService({
    env: {},
    normalizeWebsitePreviewTargetUrl,
    assertWebsitePreviewUrlIsPublic: async url => url,
    extractWebsitePreviewScanFromHtml: createSeoCore().extractWebsitePreviewScanFromHtml,
    fetchTextWithTimeout: async url => {
      requests.push(url);
      const reader = url.startsWith('https://r.jina.ai/');
      if ((mode === 'http' && url.startsWith('https:')) || (mode === 'reader' && !reader)) {
        throw new TypeError('fetch failed');
      }
      const text = reader
        ? `Title: ${title}\nURL Source: ${website}\n\nMarkdown Content:\n${body}`
        : `<html><head><title>${title}</title></head><body><p>${body}</p></body></html>`;
      return {
        response: { ok: true, status: 200, url, headers: { get: name =>
          name.toLowerCase() === 'content-type' ? (reader ? 'text/plain' : 'text/html') : '' } },
        text,
      };
    },
    fetchImpl: forbiddenProviderCall,
    fetchJsonWithTimeout: forbiddenProviderCall,
    fetchBinaryWithTimeout: forbiddenProviderCall,
    getOpenAiApiKey: forbiddenProviderCall,
  });
  return {
    requests,
    coordinator: createAiToolsCoordinator({
      fetchWebsitePreviewScanFromUrl: remote.fetchWebsitePreviewScanFromUrl,
      generateWebsitePreviewImageWithAi: forbiddenProviderCall,
    }),
  };
}

for (const fixture of fixtures) {
  for (const mode of ['https', 'http', 'reader']) {
    test(`${mode} preparation rejects provider placeholder ${fixture.title} despite long body`, async () => {
      assert.ok(fixture.body.length > 400, 'Provider translations/menus exceed the short-page threshold');
      const { coordinator, requests } = pipelineFor(fixture, mode);
      await assert.rejects(coordinator.runWebsitePreviewGeneratePipeline(website,
        buildWebdesignPipelineOptions({ source: 'premium-database', company: 'Voorbeeldbedrijf' })),
      mode === 'reader' ? { code: 'WEBDESIGN_WEBSITE_FETCH_FAILED', status: 502 } : { code: 'WEBDESIGN_PLACEHOLDER_WEBSITE', status: 422 });
      if (mode === 'http') assert.ok(requests.some(url => url === 'http://voorbeeld.test/'));
      if (mode === 'reader') assert.ok(requests.every(url => !url.startsWith('https://r.jina.ai/')));
    });
  }
}

test('a reserved-domain h1 is checked separately from an unrelated document title', () => {
  assert.equal(detectPlaceholderWebsiteScan({
    title: 'Voorbeeldbedrijf', h1: 'Domain reserved', bodyTextSample: reservedNotice,
  }).placeholder, true);
});

for (const fixture of [
  { title: 'Websitebeheer met STRATO en Yourhosting', body: providerMenu },
  { title: 'STRATO - Domain reserved oplossen', body: `Onze handleiding helpt bij hostinginstellingen. ${reservedNotice}` },
  { title: 'Domein Gereserveerd: wat betekent dat?', body: providerMenu },
  { title: 'Waarom staat er: Deze website is op dit moment niet bereikbaar?', body: providerMenu },
  { title: 'Helpcentrum', body: `Bij een nieuw domein ziet u soms STRATO - Domain reserved. ${reservedNotice} ${providerMenu}` },
]) {
  test(`real hosting/support content remains eligible: ${fixture.title}`, async () => {
    assert.equal(detectPlaceholderWebsiteScan({
      title: fixture.title, bodyTextSample: fixture.body,
    }).placeholder, false);
    const { coordinator } = pipelineFor(fixture, 'https');
    const { generationScan } = await coordinator.prepareWebsitePreviewImage(website,
      buildWebdesignPipelineOptions({ source: 'premium-database', company: 'Voorbeeldbedrijf' }));
    assert.equal(generationScan.url, website);
    assert.equal(generationScan.title, fixture.title);
    assert.equal(generationScan.requireReferenceImages, true);
  });
}

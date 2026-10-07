const test = require('node:test');
const assert = require('node:assert/strict');
const { scanWebsiteSourceHtml, detectWebsiteSourceProblem } = require('../../server/services/website-source-quality');
const { checkWebsite } = require('../../scripts/website_liveness');
const { createAiRemoteService } = require('../../server/services/ai-remote');
const { createWebsitePreviewDocumentFetcher } = require('../../server/services/website-preview-fetch-recovery');
const { assertWebsitePreviewUrlIsPublic } = require('../../server/security/public-url');
const content = '<title>Houtwerk</title><h1>Meubels op maat</h1><p>' + 'Wij maken houten meubels en keukens in onze eigen werkplaats. '.repeat(8) + '</p>';
const options = html => ({ assertPublic: async url => url, fetchImpl: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });

for (const html of ['<h1>Apache is functioning normally</h1>', '<title>Index of /</title>',
  '<title>Welcome to nginx</title>', '<title>Just a moment...</title>', '<h1>Verify you are human</h1>',
  '<title>Website in aanbouw</title>', '<h1>Pagina niet gevonden</h1>', '<h1>404 Not Found</h1>']) {
  test(`the ingestion gate refuses ${html} before a company can enter design stock`, async () => {
    assert.equal((await checkWebsite('https://bedrijf.test/', options(html))).ok, false);
  });
}
test('the observed Decoprints construction page is refused even with contact details and repeated navigation', async () => {
  const html = '<title>Decoprints geeft elke ruimte sfeer en uitstraling</title><body>' +
    '<nav>' + 'Home '.repeat(8) + '</nav>Wij werken aan een nieuwe website. binnenkort online! ' +
    'DECOPRINTS B.V. John F Kennedylaan 565555 XD Valkenswaard KvK nummer: 74396862 ' +
    'Contact met ons opnemen +31 (0)40-308 00 17 info@decoprints.nl Privacyverklaring Volg ons.</body>';
  assert.equal((await checkWebsite('https://bedrijf.test/', options(html))).ok, false);
  const { createSeoCore } = require('../../server/services/seo-core');
  assert.equal(detectWebsiteSourceProblem(createSeoCore().extractWebsitePreviewScanFromHtml(html, 'https://bedrijf.test/')).code,
    'WEBDESIGN_PLACEHOLDER_WEBSITE');
});
test('empty pages remain empty despite large script bundles and hidden text', async () => {
  const html = '<body><script>' + 'x'.repeat(40000) + '</script><div hidden>' + content + '</div></body>';
  const result = await checkWebsite('https://bedrijf.test/', options(html));
  assert.equal(result.ok, false);
  assert.match(result.reason, /lege pagina/);
});
test('a substantive light website and ordinary references to hosting/error notices remain usable', async () => {
  assert.equal((await checkWebsite('https://bedrijf.test/', options(content + '<p>Plesk, cPanel en Apache onderhoud. Fout 404 niet gevonden oplossen.</p>'))).ok, true);
  assert.equal(detectWebsiteSourceProblem(scanWebsiteSourceHtml(content, 'https://bedrijf.test/')), null);
});
for (const status of [403, 404, 422, 500, 503]) test(`an origin ${status} cannot be replaced by cached reader content`, async () => {
  const calls = [];
  const remote = createAiRemoteService({ assertWebsitePreviewUrlIsPublic: async url => url,
    fetchTextWithTimeout: async url => { calls.push(url); return { response: { ok: false, status, url }, text: 'error' }; },
  });
  await assert.rejects(remote.fetchWebsitePreviewScanFromUrl('https://bedrijf.test/'));
  assert.ok(calls.every(url => url === 'https://bedrijf.test/'));
});
test('an invalid TLS certificate cannot be bypassed by HTTP recovery', async () => {
  const calls = [];
  const fetchDocument = createWebsitePreviewDocumentFetcher({ assertPublic: () => assert.fail('No downgrade'),
    fetchDocument: async url => { calls.push(url); return { ok: false, attempts: [{ status: 0, errorCode: 'CERT_HAS_EXPIRED' }] }; },
  });
  assert.equal((await fetchDocument('https://bedrijf.test/')).ok, false);
  assert.deepEqual(calls, ['https://bedrijf.test/']);
});
test('redirects are checked before fetching social profiles or private network targets', async () => {
  for (const target of ['https://instagram.com/bedrijf', 'http://127.0.0.1/']) {
    const calls = [];
    const result = await checkWebsite('https://bedrijf.test/', {
      assertPublic: url => assertWebsitePreviewUrlIsPublic(url, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
      fetchImpl: async url => { calls.push(url); return new Response('', { status: 302, headers: { location: target } }); },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls, ['https://bedrijf.test/']);
  }
});

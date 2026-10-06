const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebsitePreviewDocumentFetcher, buildWebsitePreviewFetchError } = require('../../server/services/website-preview-fetch-recovery');
const { createAiRemoteService } = require('../../server/services/ai-remote');
const { createAiToolsCoordinator } = require('../../server/services/ai-tools');
const { buildWebdesignPipelineOptions } = require('../../server/services/design-photo-generation-policy');
const { assertWebsitePreviewUrlIsPublic, normalizeWebsitePreviewTargetUrl } = require('../../server/security/public-url');

const website = 'https://voorbeeld.test/';
const httpWebsite = 'http://voorbeeld.test/';
const connectionFailure = () => ({ ok: false, attempts: [
  { mode: 'browser-desktop', status: 0, error: 'fetch failed' },
  { mode: 'softora-compat', status: 0, error: 'certificate expired' },
] });
const publicUrl = (url) => assertWebsitePreviewUrlIsPublic(url, {
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
});
function documentResponse(url, html, status = 200, type = 'text/html') {
  return { response: { ok: status >= 200 && status < 300, status, url,
    headers: { get: name => name.toLowerCase() === 'content-type' ? type : '' } }, text: html };
}
function createPipeline(transport, assertPublic = publicUrl) {
  const requests = [];
  const forbiddenProviderCall = () => { assert.fail('Website recovery must never call an image or paid provider'); };
  const remote = createAiRemoteService({
    env: {}, assertWebsitePreviewUrlIsPublic: assertPublic, normalizeWebsitePreviewTargetUrl,
    fetchTextWithTimeout: async (url, options, timeout) => {
      requests.push({ url, options, timeout });
      return transport(url, options, timeout);
    },
    fetchImpl: forbiddenProviderCall, fetchJsonWithTimeout: forbiddenProviderCall,
    fetchBinaryWithTimeout: forbiddenProviderCall, getOpenAiApiKey: forbiddenProviderCall,
    extractWebsitePreviewScanFromHtml: (html, url) => ({
      title: html.match(/<title>([^<]+)<\/title>/i)?.[1] || 'Voorbeeldbedrijf',
      h1: html.match(/<h1>([^<]+)<\/h1>/i)?.[1] || '',
      sourceUrl: url, bodyTextSample: html.replace(/<[^>]+>/g, ' '),
    }),
  });
  const coordinator = createAiToolsCoordinator({
    fetchWebsitePreviewScanFromUrl: remote.fetchWebsitePreviewScanFromUrl,
    generateWebsitePreviewImageWithAi: forbiddenProviderCall,
  });
  return { requests, remote, coordinator };
}
const pipelineOptions = () => buildWebdesignPipelineOptions({ source: 'premium-database', company: 'Voorbeeldbedrijf' });

test('HTTP recovery keeps the working document URL, CSS colours and screenshot references in the shared API/subscription preparation', async () => {
  const { requests, coordinator } = createPipeline(async url => {
    if (url === website) throw new TypeError('fetch failed');
    if (url === 'http://voorbeeld.test/brand.css') return documentResponse(url, ':root{--primary:#8b2252}.cta{background:#8b2252}', 200, 'text/css');
    assert.equal(url, httpWebsite);
    return documentResponse(url, '<html><head><title>Voorbeeldbedrijf</title><link rel="stylesheet" href="/brand.css"></head><body><h1>Onze dienstverlening</h1></body></html>');
  });
  const { fetched, generationScan } = await coordinator.prepareWebsitePreviewImage(website + 'contact', pipelineOptions());
  assert.equal(fetched.normalizedUrl, website);
  assert.equal(fetched.finalUrl, httpWebsite);
  assert.equal(generationScan.sourceUrl, httpWebsite);
  assert.equal(generationScan.fetchSource, 'http-recovery');
  assert.ok(generationScan.brandPalette.includes('#8b2252'));
  assert.ok(generationScan.referenceImageUrls[0].endsWith(httpWebsite));
  assert.ok(generationScan.referenceImageUrls[1].includes(encodeURIComponent(httpWebsite)));
  assert.equal(generationScan.requireReferenceImages, true);
  assert.deepEqual(requests.map(request => request.url), [website, website, httpWebsite, 'http://voorbeeld.test/brand.css']);
  assert.ok(requests.find(request => request.url === httpWebsite).timeout <= 12000);
});

test('healthy HTTPS stays on HTTPS and never makes a downgrade or reader request', async () => {
  const { requests, coordinator } = createPipeline(async url => documentResponse(url, '<h1>Werkende bedrijfswebsite</h1>'));
  const { fetched, generationScan } = await coordinator.prepareWebsitePreviewImage(website, pipelineOptions());
  assert.equal(fetched.finalUrl, website);
  assert.ok(generationScan.referenceImageUrls[0].endsWith(website));
  assert.deepEqual(requests.map(request => request.url), [website]);
});

test('HTTP recovery keeps maintenance-page rejection before either generation provider', async () => {
  const { requests, coordinator } = createPipeline(async url => {
    if (url === website) throw new TypeError('fetch failed');
    assert.equal(url, httpWebsite);
    return documentResponse(url, '<title>Website in onderhoud</title><h1>Deze website is tijdelijk in onderhoud.</h1>');
  });
  await assert.rejects(coordinator.runWebsitePreviewGeneratePipeline(website, pipelineOptions()), { code: 'WEBDESIGN_PLACEHOLDER_WEBSITE' });
  assert.deepEqual(requests.map(request => request.url), [website, website, httpWebsite]);
});

test('HTTP recovery still rejects a final social-profile URL instead of making a platform-branded design', async () => {
  const { coordinator } = createPipeline(async url => {
    if (url === website) throw new TypeError('fetch failed');
    return documentResponse('https://www.instagram.com/voorbeeld/', '<h1>Voorbeeldbedrijf op Instagram</h1>');
  });
  await assert.rejects(coordinator.runWebsitePreviewGeneratePipeline(website, pipelineOptions()), { code: 'WEBDESIGN_PLATFORM_WEBSITE' });
});

test('HTTP recovery rechecks DNS before requesting the downgraded URL', async () => {
  const { requests, remote } = createPipeline(async () => { throw new TypeError('fetch failed'); }, url =>
    assertWebsitePreviewUrlIsPublic(url, { lookup: async () => [{
      address: url.startsWith('http:') ? '127.0.0.1' : '93.184.216.34', family: 4,
    }] }));
  await assert.rejects(remote.fetchWebsitePreviewScanFromUrl(website), { status: 400 });
  assert.deepEqual(requests.map(request => request.url), [website, website]);
});

test('a private redirect response during HTTP recovery cannot become a screenshot or reader source', async () => {
  const { requests, coordinator } = createPipeline(async url => {
    if (url === website) throw new TypeError('fetch failed');
    return documentResponse('http://169.254.169.254/latest/meta-data/', '<h1>Internal metadata</h1>');
  });
  await assert.rejects(coordinator.prepareWebsitePreviewImage(website, pipelineOptions()), { status: 400 });
  assert.deepEqual(requests.map(request => request.url), [website, website, httpWebsite]);
});

for (const url of ['http://voorbeeld.test/', 'https://user:secret@voorbeeld.test/', 'https://voorbeeld.test/?key=private', 'https://voorbeeld.test:8443/', 'invalid-url']) {
  test(`connection failure does not downgrade unsuitable URL ${url.replace('user:secret', 'credentials').replace('key=private', 'query')}`, async () => {
    const calls = [], initial = connectionFailure();
    const fetchDocument = createWebsitePreviewDocumentFetcher({
      fetchDocument: async requested => { calls.push(requested); return initial; },
      assertPublic: () => assert.fail('There must be no HTTP recovery URL'),
    });
    assert.equal(await fetchDocument(url), initial);
    assert.deepEqual(calls, [url]);
  });
}

for (const status of [200, 403, 404, 429, 500, 503]) {
  test(`an actual HTTPS response ${status} does not trigger transport-only HTTP recovery`, async () => {
    const initial = { ok: status === 200, attempts: [{ mode: 'browser-desktop', status }] };
    let calls = 0;
    const fetchDocument = createWebsitePreviewDocumentFetcher({
      fetchDocument: async () => { calls++; return initial; }, assertPublic: () => assert.fail('Do not downgrade a responding origin'),
    });
    assert.equal(await fetchDocument(website), initial);
    assert.equal(calls, 1);
  });
}

test('failed HTTP recovery preserves both origins for diagnostic/retry classification', async () => {
  const fetchDocument = createWebsitePreviewDocumentFetcher({
    fetchDocument: async url => url === website ? connectionFailure() : { ok: false, attempts: [{ mode: 'softora-compat', status: 404 }] },
    assertPublic: publicUrl,
  });
  const result = await fetchDocument(website);
  assert.equal(result.ok, false);
  assert.equal(result.recoveredHttp, false);
  assert.equal(result.attempts.length, 3);
  const error = buildWebsitePreviewFetchError([...result.attempts, { mode: 'reader-fallback', status: 422 }]);
  assert.equal(error.retryableWebsiteFetch, false, 'a real HTTP 404 must not be treated as only temporary TLS trouble');
});

for (const status of [408, 425, 429, 500, 503, 504]) {
  test(`reader 422 does not erase temporary origin failure ${status}`, () => {
    const error = buildWebsitePreviewFetchError([{ mode: 'browser-desktop', status }, { mode: 'reader-fallback', status: 422 }]);
    assert.equal(error.status, 422);
    assert.equal(error.retryableWebsiteFetch, true);
  });
}
for (const status of [401, 403, 404, 422, 451]) {
  test(`permanent origin response ${status} stays a failed scan`, () => {
    const error = buildWebsitePreviewFetchError([{ mode: 'browser-desktop', status }, { mode: 'reader-fallback', status: 422 }]);
    assert.equal(error.retryableWebsiteFetch, false);
  });
}

for (const [errorCode, errorName, retryable] of [
  ['ECONNRESET', 'TypeError', true], ['ETIMEDOUT', 'TypeError', true],
  ['UND_ERR_CONNECT_TIMEOUT', 'TypeError', true], ['EAI_AGAIN', 'TypeError', true],
  ['', 'AbortError', true], ['', 'TimeoutError', true],
  ['ENOTFOUND', 'TypeError', false], ['EAI_NONAME', 'TypeError', false],
  ['CERT_HAS_EXPIRED', 'TypeError', false], ['ERR_TLS_CERT_ALTNAME_INVALID', 'TypeError', false],
  ['', 'TypeError', false],
]) test(`scan keeps ${errorCode || errorName} distinct from reader 422 for retry eligibility`, async () => {
  const { remote } = createPipeline(async url => {
    if (url.startsWith('https://r.jina.ai/')) return documentResponse(url, '', 422);
    const error = new Error('fetch failed', { cause: { code: errorCode } });
    error.name = errorName;
    throw error;
  });
  await assert.rejects(remote.fetchWebsitePreviewScanFromUrl(website), error => {
    assert.equal(error.status, 422);
    assert.equal(error.retryableWebsiteFetch, retryable);
    return true;
  });
});

test('origin rate limits remain retryable while an actual captcha page stays rejected', () => {
  const limited = buildWebsitePreviewFetchError([{ mode: 'browser-desktop', status: 429, blocked: true }, { mode: 'reader-fallback', status: 422 }]);
  assert.equal(limited.retryableWebsiteFetch, true);
  const challenge = buildWebsitePreviewFetchError([{ mode: 'browser-desktop', status: 200, blocked: true }, { mode: 'reader-fallback', status: 422 }]);
  assert.equal(challenge.retryableWebsiteFetch, false);
});

test('HTTP recovery rejects the observed ROXXX configuration placeholder before generation', async () => {
  const { coordinator } = createPipeline(async url => {
    if (url === website) throw new TypeError('fetch failed');
    return documentResponse(url, 'Please stand by while configuration is in progress.');
  });
  await assert.rejects(coordinator.runWebsitePreviewGeneratePipeline(website, pipelineOptions()), { code: 'WEBDESIGN_PLACEHOLDER_WEBSITE' });
});

for (const content of [
  '<h1>Technical Services</h1><p>We provide configuration, installation and service for card printers.</p>',
  '<h1>Hosting support</h1><p>' + 'We help businesses configure hosting and publish their websites. '.repeat(10) +
    'Our troubleshooting guide explains the notice: Please stand by while configuration is in progress.</p>',
]) test('configuration services and a substantive support page remain valid website sources', async () => {
  const { coordinator } = createPipeline(async url => documentResponse(url, content));
  const { generationScan } = await coordinator.prepareWebsitePreviewImage(website, pipelineOptions());
  assert.equal(generationScan.sourceUrl, website);
  assert.equal(generationScan.requireReferenceImages, true);
});

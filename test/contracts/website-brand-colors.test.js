const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { prepareWebsitePreviewBrandGuard, assertWebsitePreviewBrandColors } = require('../../server/services/website-brand-color-guard');
const { parseCssColorToRgb, extractCssBrandColorEvidence, extractCssBrandPalette, extractCssVariableColorHints } = require('../../server/services/website-brand-colors');
const { createAiRemoteService } = require('../../server/services/ai-remote');
const { createAiToolsCoordinator } = require('../../server/services/ai-tools');
const { createWebsiteGenerationHelpers } = require('../../server/services/website-generation');

async function screenshot(colors, gradient = false) {
  const width = 480, height = 720;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1] || colors[0]}"/></linearGradient></defs>
    <rect width="480" height="720" fill="#fff"/>
    ${colors.map((color, i) => `<rect x="40" y="${40 + i * 170}" width="400" height="120" fill="${gradient ? 'url(#g)' : color}"/>`).join('')}
    <rect x="40" y="640" width="400" height="30" fill="#333"/>
  </svg>`;
  return 'data:image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}
const scan = { host: 'merk.test', referenceImageMode: 'homepage-screenshot', brandPalette: ['#7421ae', '#ce397f', '#16ab38'], brandColorHints: [], brandColorEvidence: ['#7421ae', '#ce397f', '#16ab38'].map(color => ({ color, role: 'primary' })) };

test('CSS parser recognizes hex, modern RGB, percentages, HSL and transparency', () => {
  assert.deepEqual(parseCssColorToRgb('hsl(300 100% 50%)'), { r: 255, g: 0, b: 255 });
  assert.deepEqual(parseCssColorToRgb('hsl(200grad, 100%, 50%)'), { r: 0, g: 255, b: 255 });
  assert.deepEqual(parseCssColorToRgb('rgb(10 20 30 / .8)'), { r: 10, g: 20, b: 30 });
  assert.ok(Math.abs(parseCssColorToRgb('rgb(100%,0%,0%)').r - 255) < 0.001);
  assert.equal(parseCssColorToRgb('rgba(255,0,0,0)'), null);
  assert.equal(parseCssColorToRgb('#ff000000'), null);
});

test('snapshot confirmation removes unused green CSS and accepts purple/pink shades and gradients', async () => {
  const guard = await prepareWebsitePreviewBrandGuard(scan, [{ dataUrl: await screenshot(['#7421ae', '#ce397f']) }]);
  assert.equal(guard.palette.length, 2);
  assert.deepEqual(guard.palette.map(v => v.hex), ['#7421ae', '#ce397f']);
  await assertWebsitePreviewBrandColors(guard, await screenshot(['#9257b6', '#e0619b']));
  await assertWebsitePreviewBrandColors(guard, await screenshot(['#dcc3ed', '#f3d4e3']));
  await assertWebsitePreviewBrandColors(guard, await screenshot(['#7421ae', '#ce397f'], true));
  await assert.rejects(assertWebsitePreviewBrandColors(guard, await screenshot(['#159748', '#e0ba21'])), e => e.status === 422);
});

test('neutral and unknown palettes are not guessed from photographs; missing references fail', async () => {
  const guard = await prepareWebsitePreviewBrandGuard(scan, [{ dataUrl: await screenshot(['#222', '#ddd']) }]);
  assert.deepEqual(guard.palette, []);
  await assertWebsitePreviewBrandColors(guard, await screenshot(['#444', '#eee']));
  const unknown = await prepareWebsitePreviewBrandGuard({ ...scan, brandColorEvidence: [] }, [{ dataUrl: await screenshot(['#159748']) }]);
  assert.deepEqual(unknown.palette, []);
  await assert.rejects(prepareWebsitePreviewBrandGuard(scan, []), e => e.status === 422);
  await assert.rejects(prepareWebsitePreviewBrandGuard(scan, [{ dataUrl: 'data:image/png;base64,YWJj' }]), e => e.status === 422);
});

test('real V2 pipeline sends the verified family lock and rejects a wrong-color provider image before success', async () => {
  const reference = await screenshot(['#7421ae', '#ce397f']);
  let resultImage = await screenshot(['#159748', '#e0ba21']);
  const requests = [], activities = [];
  const helpers = createWebsiteGenerationHelpers();
  const remote = createAiRemoteService({
    env: {}, getOpenAiApiKey: () => 'offline-test-only', openAiImageModel: 'gpt-image-2',
    ...helpers,
    sanitizeReferenceImages: images => images,
    parseImageDataUrl: value => ({ mimeType: 'image/png', base64Payload: value.split(',')[1] }),
    fetchBinaryWithTimeout: async url => ({ response: { ok: true, url, headers: { get: () => 'image/png' } }, bytes: Buffer.from(reference.split(',')[1], 'base64') }),
    fetchJsonWithTimeout: async (url, options) => {
      requests.push({ url, options });
      return { response: { ok: true }, data: { data: [{ b64_json: resultImage.split(',')[1] }] } };
    },
  });
  const coordinator = createAiToolsCoordinator({
    fetchWebsitePreviewScanFromUrl: async () => ({ finalUrl: 'https://merk.test/', scan }),
    generateWebsitePreviewImageWithAi: remote.generateWebsitePreviewImageWithAi,
    appendDashboardActivity: event => activities.push(event),
  });
  const options = { referenceImageMode: 'homepage-screenshot', disableReferenceImages: true };
  await assert.rejects(coordinator.runWebsitePreviewGeneratePipeline('https://merk.test/', options), e => e.status === 422);
  assert.equal(requests.length, 1); // No paid retry after a color rejection.
  assert.equal(activities.length, 0);
  assert.match(requests[0].url, /\/images\/edits$/);
  assert.equal(requests[0].options.body.getAll('image[]').length, 1);
  const prompt = requests[0].options.body.get('prompt');
  assert.match(prompt, /In de screenshot bevestigde merkkleuren: #7421ae \| #ce397f/);
  assert.match(prompt, /MERKKLEUREN VERPLICHT/);
  resultImage = await screenshot(['#9257b6', '#e0619b']);
  const result = await coordinator.runWebsitePreviewGeneratePipeline('https://merk.test/', options);
  assert.equal(result.ok, true);
  assert.equal(result.image.dataUrl, resultImage);
  assert.equal(activities.length, 1);
});

test('V2 never manufactures a brand brief after a failed source scan', async () => {
  let generated = 0;
  const coordinator = createAiToolsCoordinator({
    fetchWebsitePreviewScanFromUrl: async () => { throw Object.assign(new Error('Source unavailable'), { status: 502 }); },
    generateWebsitePreviewImageWithAi: async () => { generated++; },
  });
  await assert.rejects(coordinator.runWebsitePreviewGeneratePipeline('https://merk.test/', {
    referenceImageMode: 'homepage-screenshot', allowScanFallback: true,
  }), /Source unavailable/);
  assert.equal(generated, 0);
});


test('scanner excludes stock WordPress palettes and gathers semantic brand/CTA evidence', () => {
  const css = [':root{--wp--preset--color--vivid-red:#f00;--wp--preset--color--vivid-cyan-blue:#00f;--brand:#7421ae;--akismet-color-mid-green:#159748;} .has-vivid-red-color{color:#f00!important;} .cta-button{background:#ce397f;} .cookie-button{background:#159748;}'];
  const hints = extractCssVariableColorHints(css);
  assert.deepEqual(hints, ['brand: #7421ae']);
  assert.ok(!extractCssBrandPalette(css).includes('#f00'));
  assert.deepEqual(extractCssBrandColorEvidence(css).map(v => v.color), ['#7421ae', '#ce397f']);
});

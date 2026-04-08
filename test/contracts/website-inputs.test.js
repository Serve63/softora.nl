const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebsiteInputHelpers } = require('../../server/services/website-inputs');

function createHelpers() {
  return createWebsiteInputHelpers({
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => {
      const text = String(value || '').trim();
      if (!text) return '';
      return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
    },
  });
}

test('website input helpers parse valid image data urls and reject invalid values', () => {
  const helpers = createHelpers();

  const parsed = helpers.parseImageDataUrl(' data:image/png;base64,YWJjZA== ');
  assert.equal(parsed.mimeType, 'image/png');
  assert.equal(parsed.sizeBytes, 4);
  assert.equal(parsed.dataUrl, 'data:image/png;base64,YWJjZA==');

  assert.equal(helpers.parseImageDataUrl('https://softora.nl/image.png'), null);
  assert.equal(helpers.parseImageDataUrl('data:text/plain;base64,YWJjZA=='), null);
  assert.equal(helpers.parseImageDataUrl('data:image/png;base64,%%%'), null);
});

test('website input helpers sanitize reference images with limits and stable defaults', () => {
  const helpers = createHelpers();
  const images = helpers.sanitizeReferenceImages(
    [
      { id: ' hero ', name: ' Hero 1 ', dataUrl: 'data:image/png;base64,YWJjZA==' },
      { id: 'skip', name: 'Skip', dataUrl: 'https://softora.nl/image.png' },
      { fileName: 'Tweede', imageDataUrl: 'data:image/webp;base64,YWJjZA==' },
    ],
    { maxItems: 2 }
  );

  assert.equal(images.length, 2);
  assert.equal(images[0].id, 'hero');
  assert.equal(images[0].name, 'Hero 1');
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[1].name, 'Tweede');
  assert.equal(images[1].mimeType, 'image/webp');
});

test('website input helpers normalize automation slugs and launch domains', () => {
  const helpers = createHelpers();

  assert.equal(helpers.slugifyAutomationText(' Servé Softora Project! '), 'serve-softora-project');
  assert.equal(helpers.slugifyAutomationText('', 'fallback'), 'fallback');

  assert.equal(helpers.sanitizeLaunchDomainName('https://www.Softora.nl/pad'), 'softora.nl');
  assert.equal(helpers.sanitizeLaunchDomainName('softora'), '');
  assert.equal(helpers.sanitizeLaunchDomainName('softora..nl'), '');
});

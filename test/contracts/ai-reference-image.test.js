const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const {
  normalizeWebsitePreviewReferenceImage,
} = require('../../server/services/ai-reference-image');

test('website preview reference normalizer keeps valid images already under the OpenAI limit', async () => {
  const bytes = Buffer.alloc(4096, 1);
  const result = await normalizeWebsitePreviewReferenceImage({
    bytes,
    contentType: 'image/png',
    maxInputBytes: bytes.length,
  });

  assert.equal(result.bytes, bytes);
  assert.equal(result.contentType, 'image/png');
});

test('website preview reference normalizer compresses oversized screenshots to a bounded jpeg', async () => {
  const bytes = await sharp({
    create: {
      width: 1800,
      height: 2400,
      channels: 4,
      background: { r: 238, g: 231, b: 226, alpha: 1 },
    },
  }).png({ compressionLevel: 0 }).toBuffer();
  assert.equal(bytes.length > 2 * 1024 * 1024, true);

  const result = await normalizeWebsitePreviewReferenceImage({
    bytes,
    contentType: 'image/png',
    maxInputBytes: bytes.length,
  });

  assert.ok(result);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.bytes.length <= 2 * 1024 * 1024, true);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width <= 1200, true);
  assert.equal(metadata.height <= 1600, true);
});

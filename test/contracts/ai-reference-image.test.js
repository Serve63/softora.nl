const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const {
  normalizeWebsitePreviewReferenceImage,
} = require('../../server/services/ai-reference-image');

test('AVIF references remain decodable and convertible with the patched native image library', async () => {
  const source = await sharp({
    create: { width: 40, height: 24, channels: 3, background: { r: 238, g: 231, b: 226 } },
  }).avif({ lossless: true }).toBuffer();
  const metadata = await sharp(source).metadata();
  assert.equal(metadata.format, 'heif');
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 24);

  const { data, info } = await sharp(source).resize(20, 12).jpeg().toBuffer({ resolveWithObject: true });
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, 20);
  assert.equal(info.height, 12);
  assert.ok(data.length > 0);
});

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

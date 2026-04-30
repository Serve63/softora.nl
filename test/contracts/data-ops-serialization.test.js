const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildChunkedStatePatch,
  buildCustomerIdentityKey,
  parseImageDataUrl,
  readChunkedStateValue,
  resolveRecordId,
  safeParseJsonArray,
  safeParseJsonObject,
  sanitizeStorageSegment,
} = require('../../server/services/data-ops-serialization');

test('data ops serialization reads and writes existing chunked ui-state values', () => {
  const value = 'a'.repeat(10001);
  const patch = buildChunkedStatePatch('softora_customers_premium_v1', value, 10000);

  assert.equal(patch.softora_customers_premium_v1, '');
  assert.deepEqual(JSON.parse(patch.softora_customers_premium_v1_chunks_v1), {
    count: 2,
    updatedAt: JSON.parse(patch.softora_customers_premium_v1_chunks_v1).updatedAt,
  });
  assert.equal(readChunkedStateValue(patch, 'softora_customers_premium_v1'), value);
});

test('data ops serialization keeps malformed json and ids safe', () => {
  assert.deepEqual(safeParseJsonObject('{'), {});
  assert.deepEqual(safeParseJsonArray('{'), []);
  assert.equal(
    buildCustomerIdentityKey({ bedrijf: ' Softora VOF ', naam: 'Servé', telefoon: '06 123' }),
    'softora vof|serve|06 123'
  );
  assert.match(resolveRecordId({ bedrijf: 'Softora', naam: 'Servé' }, 'customer'), /^customer_/);
  assert.equal(sanitizeStorageSegment('Softora / Demo BV'), 'softora-demo-bv');
});

test('data ops serialization validates image data urls for storage', () => {
  const image = parseImageDataUrl('data:image/png;base64,aGVsbG8=');

  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.buffer.toString('utf8'), 'hello');
  assert.equal(parseImageDataUrl('https://example.com/photo.png'), null);
});

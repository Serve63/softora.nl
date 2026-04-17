const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchBinaryWithTimeout,
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
} = require('../../server/services/runtime-fetch');

test('runtime fetch helpers parse json, text and binary payloads consistently', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (_url, options = {}) => {
    assert.ok(options.signal);
    return {
      text: async () => '{"ok":true}',
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    };
  };

  const jsonResult = await fetchJsonWithTimeout('https://softora.test/json', { method: 'GET' }, 50);
  assert.deepEqual(jsonResult.data, { ok: true });

  const textResult = await fetchTextWithTimeout('https://softora.test/text', { method: 'GET' }, 50);
  assert.equal(textResult.text, '{"ok":true}');

  const binaryResult = await fetchBinaryWithTimeout('https://softora.test/file', { method: 'GET' }, 50);
  assert.deepEqual(Array.from(binaryResult.bytes), [1, 2, 3]);
});

test('runtime fetch helpers preserve non-json response bodies as raw text', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => ({
    text: async () => 'plain-text-response',
  });

  const result = await fetchJsonWithTimeout('https://softora.test/raw', { method: 'GET' }, 50);
  assert.deepEqual(result.data, { raw: 'plain-text-response' });
});

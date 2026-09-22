const test = require('node:test');
const assert = require('node:assert/strict');
const { randomPort } = require('../testlib/server-process');

test('test servers retry port 6679 because Node fetch rejects it before making a request', () => {
  const values = [(6679 - 5100 + 0.5) / 3900, 0.5];
  const selected = randomPort(() => {
    assert.ok(values.length > 0, 'a permitted candidate must finish selection');
    return values.shift();
  });
  assert.equal(selected, 7050);
  assert.equal(values.length, 0);
});

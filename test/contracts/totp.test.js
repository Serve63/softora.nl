const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTotpManager,
  decodeBase32Secret,
  generateTotpCodeForTime,
} = require('../../server/security/totp');

test('decodeBase32Secret decodes a standard shared secret', () => {
  const buffer = decodeBase32Secret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(buffer.toString('utf8'), '12345678901234567890');
});

test('generateTotpCodeForTime matches the RFC6238 test vector in 6 digits', () => {
  const secretBuffer = Buffer.from('12345678901234567890', 'utf8');
  assert.equal(generateTotpCodeForTime(secretBuffer, 59_000, 6, 30), '287082');
});

test('totp manager accepts valid codes and allows disabled configuration', () => {
  const disabledManager = createTotpManager({ secret: '' });
  assert.equal(disabledManager.isConfigured(), false);
  assert.equal(disabledManager.isCodeValid('123456'), true);

  let nowMs = 59_000;
  const manager = createTotpManager({
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    getNowMs: () => nowMs,
  });

  assert.equal(manager.isConfigured(), true);
  assert.equal(manager.isCodeValid('287082'), true);

  nowMs = 89_000;
  assert.equal(manager.isCodeValid('287082'), true);
  nowMs = 120_000;
  assert.equal(manager.isCodeValid('287082'), false);
});

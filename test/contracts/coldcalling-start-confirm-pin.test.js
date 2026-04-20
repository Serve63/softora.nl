const test = require('node:test');
const assert = require('node:assert/strict');
const { validateColdcallingStartConfirmPin } = require('../../server/security/coldcalling-start-confirm-pin');

test('coldcalling start confirm pin skips when expected pin is empty', () => {
  assert.equal(validateColdcallingStartConfirmPin({}, { expectedPin: '' }).ok, true);
  assert.equal(validateColdcallingStartConfirmPin({ startConfirmPin: 'x' }, { expectedPin: '  ' }).ok, true);
});

test('coldcalling start confirm pin rejects mismatch', () => {
  const bad = validateColdcallingStartConfirmPin({ startConfirmPin: 'wrong' }, { expectedPin: 'secret' });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error || ''), /Bevestigingspin/);
});

test('coldcalling start confirm pin accepts exact match', () => {
  assert.equal(
    validateColdcallingStartConfirmPin({ startConfirmPin: 'secret' }, { expectedPin: 'secret' }).ok,
    true
  );
});

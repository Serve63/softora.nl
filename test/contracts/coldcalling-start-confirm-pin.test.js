const test = require('node:test');
const assert = require('node:assert/strict');
const { validateColdcallingStartConfirmPin } = require('../../server/security/coldcalling-start-confirm-pin');
const {
  DEFAULT_RISKY_ACTION_CONFIRM_PIN,
  validateRiskyActionConfirmPin,
} = require('../../server/security/risky-action-confirm-pin');

test('risky action confirm pin requires the production pin by default', () => {
  assert.equal(DEFAULT_RISKY_ACTION_CONFIRM_PIN, '698069');
  assert.equal(validateRiskyActionConfirmPin({ startConfirmPin: '698069' }).ok, true);
  assert.equal(validateRiskyActionConfirmPin({ startConfirmPin: '123456' }).ok, false);
});

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

test('coldcalling start confirm pin accepts confirmPin aliases', () => {
  assert.equal(
    validateColdcallingStartConfirmPin({ confirmPin: 'secret' }, { expectedPin: 'secret' }).ok,
    true
  );
  assert.equal(
    validateColdcallingStartConfirmPin({ actionConfirmPin: 'secret' }, { expectedPin: 'secret' }).ok,
    true
  );
});

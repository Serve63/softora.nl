const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePremiumAdminActionPin } = require('../../server/security/premium-admin-action-pin');

test('premium admin action pin skips when expected pin is empty', () => {
  assert.equal(validatePremiumAdminActionPin({}, { expectedPin: '' }).ok, true);
  assert.equal(validatePremiumAdminActionPin({ actionConfirmPin: 'x' }, { expectedPin: '  ' }).ok, true);
});

test('premium admin action pin rejects mismatch', () => {
  const bad = validatePremiumAdminActionPin({ actionConfirmPin: 'wrong' }, { expectedPin: 'geheim' });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error || ''), /Bevestigingspin/);
});

test('premium admin action pin accepts exact match on actionConfirmPin', () => {
  assert.equal(
    validatePremiumAdminActionPin({ actionConfirmPin: 'geheim' }, { expectedPin: 'geheim' }).ok,
    true
  );
});

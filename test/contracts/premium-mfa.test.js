const test = require('node:test');
const assert = require('node:assert/strict');

const { createPremiumMfaService } = require('../../server/security/premium-mfa');
const { decodeBase32Secret, generateTotpCodeForTime } = require('../../server/security/totp');

test('premium mfa enrollment encrypts secrets and enables verified TOTP', () => {
  const nowMs = 1_700_000_000_000;
  const service = createPremiumMfaService({
    sessionSecret: 'a-long-session-secret',
    now: () => nowMs,
  });
  const enrollment = service.createEnrollment({ email: 'admin@softora.nl' });
  const pendingUser = {
    email: 'admin@softora.nl',
    mfa: enrollment.mfa,
  };
  const code = generateTotpCodeForTime(decodeBase32Secret(enrollment.setupKey), nowMs);
  const completed = service.completeEnrollment(pendingUser, code);

  assert.equal(enrollment.mfa.encryptedSecret.includes(enrollment.setupKey), false);
  assert.equal(enrollment.recoveryCodes.length, 8);
  assert.equal(completed.enabled, true);
  assert.equal(completed.lastTotpCounter > 0, true);
});

test('premium mfa rejects TOTP replay and consumes recovery codes once', () => {
  const nowMs = 1_700_000_000_000;
  const service = createPremiumMfaService({ sessionSecret: 'secret', now: () => nowMs });
  const enrollment = service.createEnrollment({ email: 'admin@softora.nl' });
  const enrollmentCode = generateTotpCodeForTime(decodeBase32Secret(enrollment.setupKey), nowMs);
  const user = { email: 'admin@softora.nl', mfa: service.completeEnrollment({ mfa: enrollment.mfa }, enrollmentCode) };

  assert.equal(service.verifyLoginCode(user, enrollmentCode).ok, false);
  const recovery = service.verifyLoginCode(user, enrollment.recoveryCodes[0]);
  assert.equal(recovery.ok, true);
  assert.equal(recovery.usedRecoveryCode, true);
  assert.notEqual(recovery.recoveryCodeHash, '');
  assert.equal(recovery.mfa.recoveryCodeHashes.length, 7);
  assert.equal(service.verifyLoginCode({ ...user, mfa: recovery.mfa }, enrollment.recoveryCodes[0]).ok, false);
});

test('premium mfa ciphertext is bound to the session secret', () => {
  const first = createPremiumMfaService({ sessionSecret: 'first-secret' });
  const second = createPremiumMfaService({ sessionSecret: 'second-secret' });
  const enrollment = first.createEnrollment({ email: 'admin@softora.nl' });

  assert.notEqual(first.decryptSecret(enrollment.mfa.encryptedSecret), '');
  assert.equal(second.decryptSecret(enrollment.mfa.encryptedSecret), '');
});

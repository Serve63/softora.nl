const { timingSafeEqualStrings } = require('./crypto-utils');

/**
 * Wanneer PREMIUM_SETTINGS_CONFIRM_PIN of (fallback) COLDCALLING_START_CONFIRM_PIN gezet is,
 * moeten gevoelige premium-admin-acties (zoals POST/PATCH /api/premium-users) body.actionConfirmPin sturen.
 * Als geen van beide env-vars gezet is, wordt niet gecontroleerd (lokaal/dev).
 *
 * @param {object} body
 * @param {{ expectedPin?: string }} [options] — alleen voor tests
 */
function validatePremiumAdminActionPin(body, options = {}) {
  let expected = '';
  if (options && Object.prototype.hasOwnProperty.call(options, 'expectedPin')) {
    expected = String(options.expectedPin ?? '').trim();
  } else {
    expected = String(
      process.env.PREMIUM_SETTINGS_CONFIRM_PIN || process.env.COLDCALLING_START_CONFIRM_PIN || ''
    ).trim();
  }
  if (!expected) {
    return { ok: true };
  }
  const provided = String(body?.actionConfirmPin ?? '').trim();
  if (!timingSafeEqualStrings(provided, expected)) {
    return { ok: false, error: 'Bevestigingspin is onjuist of ontbreekt.' };
  }
  return { ok: true };
}

module.exports = {
  validatePremiumAdminActionPin,
};

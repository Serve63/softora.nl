const { timingSafeEqualStrings } = require('./crypto-utils');

/**
 * Wanneer PREMIUM_SETTINGS_CONFIRM_PIN of (fallback) COLDCALLING_START_CONFIRM_PIN gezet is,
 * moeten gevoelige premium-admin-acties body.actionConfirmCode sturen.
 * body.actionConfirmPin blijft tijdelijk werken voor oudere clients. Een expliciet
 * aangewezen gevoelige scope kan met requireConfigured gesloten falen.
 *
 * @param {object} body
 * @param {{ expectedPin?: string }} [options] — alleen voor tests
 */
function validatePremiumAdminActionPin(body, options = {}) {
  const hasExplicitPin = options && Object.prototype.hasOwnProperty.call(options, 'expectedPin');
  let expected = '';
  if (hasExplicitPin) {
    expected = String(options.expectedPin ?? '').trim();
  } else {
    const env = options.env && typeof options.env === 'object' ? options.env : process.env;
    const envName = String(options.envName || '').trim();
    expected = String(
      envName
        ? env[envName] || ''
        : env.PREMIUM_SETTINGS_CONFIRM_PIN || env.COLDCALLING_START_CONFIRM_PIN || ''
    ).trim();
  }
  if (!expected) {
    if (!hasExplicitPin && !options.requireConfigured) return { ok: true };
    return {
      ok: false,
      statusCode: 503,
      code: 'ACTION_CONFIRM_PIN_NOT_CONFIGURED',
      error: 'Bevestigingspin is niet veilig geconfigureerd op de server.',
    };
  }
  const payload = body && typeof body === 'object' ? body : {};
  const provided = String(
    Object.prototype.hasOwnProperty.call(payload, 'actionConfirmCode')
      ? payload.actionConfirmCode
      : payload.actionConfirmPin
  ).trim();
  if (!timingSafeEqualStrings(provided, expected)) {
    return {
      ok: false,
      statusCode: 403,
      code: 'ACTION_CONFIRM_PIN_INVALID',
      error: 'Bevestigingspin is onjuist of ontbreekt.',
    };
  }
  return { ok: true };
}

module.exports = {
  validatePremiumAdminActionPin,
};

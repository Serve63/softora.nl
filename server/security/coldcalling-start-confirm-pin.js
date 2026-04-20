const { timingSafeEqualStrings } = require('./crypto-utils');

/**
 * When COLDCALLING_START_CONFIRM_PIN is set (non-empty), POST /api/coldcalling/start
 * must include body.startConfirmPin with the same value (timing-safe compare).
 * When unset, validation is skipped so local/dev keeps working without extra config.
 *
 * @param {object} body
 * @param {{ expectedPin?: string }} [options] — for tests only; defaults to process.env.COLDCALLING_START_CONFIRM_PIN
 */
function validateColdcallingStartConfirmPin(body, options = {}) {
  const expectedRaw =
    options && Object.prototype.hasOwnProperty.call(options, 'expectedPin')
      ? String(options.expectedPin ?? '')
      : String(process.env.COLDCALLING_START_CONFIRM_PIN || '');
  const expected = String(expectedRaw || '').trim();
  if (!expected) {
    return { ok: true };
  }
  const provided = String(body?.startConfirmPin ?? '').trim();
  if (!timingSafeEqualStrings(provided, expected)) {
    return { ok: false, error: 'Bevestigingspin is onjuist of ontbreekt.' };
  }
  return { ok: true };
}

module.exports = {
  validateColdcallingStartConfirmPin,
};

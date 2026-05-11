const { timingSafeEqualStrings } = require('./crypto-utils');

const DEFAULT_RISKY_ACTION_CONFIRM_PIN = '698069';

function resolveExpectedPin(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'expectedPin')) {
    return String(options.expectedPin ?? '').trim();
  }
  return DEFAULT_RISKY_ACTION_CONFIRM_PIN;
}

function resolveProvidedPin(body) {
  const candidates = [
    body?.startConfirmPin,
    body?.actionConfirmPin,
    body?.confirmPin,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }
  return '';
}

function validateRiskyActionConfirmPin(body, options = {}) {
  const expected = resolveExpectedPin(options);
  if (!expected) {
    return { ok: true };
  }
  const provided = resolveProvidedPin(body);
  if (!timingSafeEqualStrings(provided, expected)) {
    return { ok: false, error: 'Bevestigingspin is onjuist of ontbreekt.' };
  }
  return { ok: true };
}

module.exports = {
  DEFAULT_RISKY_ACTION_CONFIRM_PIN,
  validateRiskyActionConfirmPin,
};

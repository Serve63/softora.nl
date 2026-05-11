const { validateRiskyActionConfirmPin } = require('./risky-action-confirm-pin');

/**
 * POST /api/coldcalling/start must include the risky-action confirmation pin.
 *
 * @param {object} body
 * @param {{ expectedPin?: string }} [options] — for tests only
 */
function validateColdcallingStartConfirmPin(body, options = {}) {
  return validateRiskyActionConfirmPin(body, options);
}

module.exports = {
  validateColdcallingStartConfirmPin,
};

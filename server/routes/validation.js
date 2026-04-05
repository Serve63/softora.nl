function applyValidation(req, validation) {
  if (!validation || validation.ok !== true) {
    return {
      ok: false,
      error: validation?.error || 'Ongeldige aanvraag.',
    };
  }

  if (validation.params) {
    req.params = {
      ...req.params,
      ...validation.params,
    };
  }
  if (validation.query) {
    req.query = {
      ...req.query,
      ...validation.query,
    };
  }
  if (validation.body) {
    req.body = validation.body;
  }

  return { ok: true };
}

function withValidation(validator, handler) {
  return async (req, res) => {
    const validation = applyValidation(req, validator(req));
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        error: validation.error,
      });
    }
    return handler(req, res);
  };
}

module.exports = {
  applyValidation,
  withValidation,
};

const { validateRetellAgendaAvailabilityRequest } = require('../schemas/agenda-retell');
const { applyValidation } = require('./validation');

function withRetellAuthAndValidation(deps, validator, handler) {
  return async (req, res) => {
    if (!deps.ensureRetellAgendaRequestAuthorized(req, res)) return res;

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

function registerAgendaRetellRoutes(app, deps) {
  app.post(
    '/api/retell/functions/agenda/availability',
    withRetellAuthAndValidation(deps, validateRetellAgendaAvailabilityRequest, (req, res) =>
      deps.sendRetellAgendaAvailabilityResponse(req, res)
    )
  );

}

module.exports = {
  registerAgendaRetellRoutes,
};

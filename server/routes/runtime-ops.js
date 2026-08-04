const { PASSWORD_REGISTER_SCOPE } = require('../security/password-register-access');

function rejectUnwiredPasswordRegisterGuard(req, res, next) {
  const scope = String(
    req?.params?.scope || req?.query?.scope || req?.body?.actionConfirmScope || ''
  ).trim().toLowerCase();
  if (scope !== 'premium_password_register' && scope !== 'password-register') return next();
  return res.status(503).json({
    ok: false,
    code: 'PASSWORD_REGISTER_SECURITY_NOT_WIRED',
    error: 'Wachtwoordenregister-beveiliging is tijdelijk niet beschikbaar.',
  });
}

function rejectLegacyPasswordRegisterRead(req, res, next) {
  const scope = String(req?.params?.scope || req?.query?.scope || '').trim().toLowerCase();
  if (scope !== PASSWORD_REGISTER_SCOPE) return next();
  return res.status(405).json({
    ok: false,
    code: 'PASSWORD_REGISTER_LEGACY_READ_DISABLED',
    error: 'Gebruik de beveiligde wachtwoordenregister-read met een verse bevestiging.',
  });
}

function registerRuntimeOpsRoutes(app, deps) {
  const requireFreshPasswordRegisterApiAccess =
    typeof deps.requireFreshPasswordRegisterApiAccess === 'function'
      ? deps.requireFreshPasswordRegisterApiAccess
      : rejectUnwiredPasswordRegisterGuard;
  const requirePasswordRegisterWriteProof =
    typeof deps.requirePasswordRegisterWriteProof === 'function'
      ? deps.requirePasswordRegisterWriteProof
      : rejectUnwiredPasswordRegisterGuard;
  const requirePasswordRegisterAccessProof =
    typeof deps.requirePasswordRegisterAccessProof === 'function'
      ? deps.requirePasswordRegisterAccessProof
      : rejectUnwiredPasswordRegisterGuard;
  app.get('/api/dashboard/activity', (req, res) =>
    deps.coordinator.sendDashboardActivityResponse(req, res)
  );
  app.get('/api/dashboard/customers', (req, res) =>
    deps.coordinator.sendDashboardCustomersResponse(req, res)
  );
  app.get('/api/security/audit-log', deps.requireRuntimeDebugAccess, (req, res) =>
    deps.coordinator.sendSecurityAuditLogResponse(req, res)
  );
  app.get(
    '/api/ui-state/:scope',
    requireFreshPasswordRegisterApiAccess,
    rejectLegacyPasswordRegisterRead,
    async (req, res) => deps.coordinator.sendUiStateGetResponse(req, res, req.params.scope)
  );
  app.get(
    '/api/ui-state-get',
    requireFreshPasswordRegisterApiAccess,
    rejectLegacyPasswordRegisterRead,
    async (req, res) => deps.coordinator.sendUiStateGetResponse(req, res, req.query.scope)
  );
  app.post(
    '/api/ui-state-read',
    requireFreshPasswordRegisterApiAccess,
    requirePasswordRegisterAccessProof,
    async (req, res) => deps.coordinator.sendUiStateGetResponse(req, res, req.query.scope)
  );
  app.post(
    '/api/ui-state/:scope',
    requireFreshPasswordRegisterApiAccess,
    requirePasswordRegisterWriteProof,
    async (req, res) => deps.coordinator.sendUiStateSetResponse(req, res, req.params.scope)
  );
  app.post(
    '/api/ui-state-set',
    requireFreshPasswordRegisterApiAccess,
    requirePasswordRegisterWriteProof,
    async (req, res) => deps.coordinator.sendUiStateSetResponse(req, res, req.query.scope)
  );
  app.get('/api/sportschool-logboek', async (req, res) =>
    deps.coordinator.sendSportschoolLogbookGetResponse(req, res)
  );
  app.post('/api/sportschool-logboek', async (req, res) =>
    deps.coordinator.sendSportschoolLogbookSetResponse(req, res)
  );
  app.post('/api/dashboard/activity', (req, res) =>
    deps.coordinator.sendDashboardActivityCreateResponse(req, res)
  );
}

module.exports = {
  registerRuntimeOpsRoutes,
};

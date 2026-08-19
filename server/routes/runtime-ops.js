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

function rejectUnwiredPremiumAdminGuard(_req, res) {
  return res.status(503).json({
    ok: false,
    code: 'PREMIUM_ADMIN_SECURITY_NOT_WIRED',
    error: 'Premium admin-beveiliging is tijdelijk niet beschikbaar.',
  });
}

function getUiStateScope(req) {
  return String(req?.params?.scope || req?.query?.scope || '').trim().toLowerCase();
}

function registerRuntimeOpsRoutes(app, deps) {
  const requirePremiumAdminApiAccess =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : rejectUnwiredPremiumAdminGuard;
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
  const requireSensitiveUiStateAccess = (req, res, next) => {
    if (getUiStateScope(req) !== 'sportschool_logboek') return next();
    return requirePremiumAdminApiAccess(req, res, next);
  };
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
    requireSensitiveUiStateAccess,
    async (req, res) => deps.coordinator.sendUiStateGetResponse(req, res, req.params.scope)
  );
  app.get(
    '/api/ui-state-get',
    requireFreshPasswordRegisterApiAccess,
    rejectLegacyPasswordRegisterRead,
    requireSensitiveUiStateAccess,
    async (req, res) => deps.coordinator.sendUiStateGetResponse(req, res, req.query.scope)
  );
  app.post(
    '/api/ui-state-read',
    requireFreshPasswordRegisterApiAccess,
    requirePasswordRegisterAccessProof,
    requireSensitiveUiStateAccess,
    async (req, res) => deps.coordinator.sendUiStateGetResponse(req, res, req.query.scope)
  );
  app.post(
    '/api/ui-state/:scope',
    requireFreshPasswordRegisterApiAccess,
    requirePasswordRegisterWriteProof,
    requireSensitiveUiStateAccess,
    async (req, res) => deps.coordinator.sendUiStateSetResponse(req, res, req.params.scope)
  );
  app.post(
    '/api/ui-state-set',
    requireFreshPasswordRegisterApiAccess,
    requirePasswordRegisterWriteProof,
    requireSensitiveUiStateAccess,
    async (req, res) => deps.coordinator.sendUiStateSetResponse(req, res, req.query.scope)
  );
  app.get('/api/sportschool-logboek', requirePremiumAdminApiAccess, async (req, res) =>
    deps.coordinator.sendSportschoolLogbookGetResponse(req, res)
  );
  app.get('/api/sportschool-logboek-public', async (req, res) =>
    deps.coordinator.sendSportschoolLogbookPublicGetResponse(req, res)
  );
  app.post('/api/sportschool-logboek', requirePremiumAdminApiAccess, async (req, res) =>
    deps.coordinator.sendSportschoolLogbookSetResponse(req, res)
  );
  app.post('/api/dashboard/activity', (req, res) =>
    deps.coordinator.sendDashboardActivityCreateResponse(req, res)
  );
}

module.exports = {
  registerRuntimeOpsRoutes,
};

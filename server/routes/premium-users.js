const { validatePremiumAdminActionPin } = require('../security/premium-admin-action-pin');
const {
  COLDMAIL_SEND_CONFIRM_PIN,
  validateRiskyActionConfirmPin,
} = require('../security/risky-action-confirm-pin');

function registerPremiumUserManagementRoutes(app, deps) {
  app.get('/api/auth/profile', (req, res) => deps.coordinator.getProfileResponse(req, res));
  app.patch('/api/auth/profile', (req, res) => deps.coordinator.updateProfileResponse(req, res));

  app.get('/api/premium-users', deps.requirePremiumAdminApiAccess, (req, res) =>
    deps.coordinator.listPremiumUsersResponse(req, res)
  );

  app.post('/api/premium-users', deps.requirePremiumAdminApiAccess, (req, res) => {
    const pinCheck = validatePremiumAdminActionPin(req.body);
    if (!pinCheck.ok) {
      return res.status(403).json({ ok: false, error: pinCheck.error });
    }
    return deps.coordinator.createPremiumUserResponse(req, res);
  });

  app.post('/api/premium-users/verify-pin', deps.requirePremiumAdminApiAccess, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const scope = String(body.actionConfirmScope || '').trim().toLowerCase();
    const pinCheck = scope === 'coldmail-send'
      ? validateRiskyActionConfirmPin(body, { expectedPin: COLDMAIL_SEND_CONFIRM_PIN })
      : validatePremiumAdminActionPin(body);
    if (!pinCheck.ok) {
      return res.status(403).json({ ok: false, error: pinCheck.error });
    }
    return res.json({ ok: true });
  });

  app.patch('/api/premium-users/:id', deps.requirePremiumAdminApiAccess, (req, res) => {
    const pinCheck = validatePremiumAdminActionPin(req.body);
    if (!pinCheck.ok) {
      return res.status(403).json({ ok: false, error: pinCheck.error });
    }
    return deps.coordinator.updatePremiumUserResponse(req, res, req.params.id);
  });

  app.delete('/api/premium-users/:id', deps.requirePremiumAdminApiAccess, (req, res) =>
    deps.coordinator.deletePremiumUserResponse(req, res, req.params.id)
  );
}

module.exports = {
  registerPremiumUserManagementRoutes,
};

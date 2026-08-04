const { validatePremiumAdminActionPin } = require('../security/premium-admin-action-pin');
const {
  COLDMAIL_SEND_CONFIRM_PIN,
  validateRiskyActionConfirmPin,
} = require('../security/risky-action-confirm-pin');
const {
  createPasswordRegisterOwnerPolicy,
} = require('../security/password-register-access');
const { createPremiumPinAttemptLimiter } = require('../security/premium-pin-attempt-limiter');

function sendPinRateLimit(res, limit) {
  res.setHeader('Retry-After', String(limit.retryAfterSeconds));
  return res.status(429).json({
    ok: false,
    code: 'ACTION_CONFIRM_PIN_RATE_LIMITED',
    error: 'Te veel mislukte bevestigingspinpogingen. Probeer later opnieuw.',
    retryAfterSeconds: limit.retryAfterSeconds,
  });
}

function registerPremiumUserManagementRoutes(app, deps) {
  const appendSecurityAuditEvent =
    typeof deps.appendSecurityAuditEvent === 'function' ? deps.appendSecurityAuditEvent : () => {};
  const passwordRegisterOwnerPolicy =
    deps.passwordRegisterOwnerPolicy || createPasswordRegisterOwnerPolicy();
  const passwordRegisterWriteProofManager = deps.passwordRegisterWriteProofManager || null;
  const pinAttemptLimiter = deps.pinAttemptLimiter || createPremiumPinAttemptLimiter();
  const requireFreshPasswordRegisterApiAccess =
    typeof deps.requireFreshPasswordRegisterApiAccess === 'function'
      ? deps.requireFreshPasswordRegisterApiAccess
      : (_req, _res, next) => next();

  function appendPasswordPinAudit(req, type, detail) {
    appendSecurityAuditEvent(
      {
        type,
        severity: type === 'password_register_pin_verified' ? 'info' : 'warning',
        success: type === 'password_register_pin_verified',
        email: String(req?.premiumAuth?.email || '').trim(),
        ip: String(req?.ip || req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim(),
        path: String(req?.originalUrl || req?.url || '').trim(),
        origin: String(req?.headers?.origin || '').trim(),
        userAgent: typeof req?.get === 'function' ? req.get('user-agent') : '',
        detail,
      },
      `security_${type}`
    );
  }

  app.get('/api/auth/profile', (req, res) => deps.coordinator.getProfileResponse(req, res));
  app.patch('/api/auth/profile', (req, res) => deps.coordinator.updateProfileResponse(req, res));

  app.get('/api/premium-users', deps.requirePremiumAdminApiAccess, (req, res) =>
    deps.coordinator.listPremiumUsersResponse(req, res)
  );

  app.post('/api/premium-users', deps.requirePremiumAdminApiAccess, (req, res) => {
    const pinCheck = validatePremiumAdminActionPin(req.body);
    if (!pinCheck.ok) return res.status(403).json({ ok: false, error: pinCheck.error });
    return deps.coordinator.createPremiumUserResponse(req, res);
  });

  app.post(
    '/api/premium-users/verify-pin',
    deps.requirePremiumAdminApiAccess,
    requireFreshPasswordRegisterApiAccess,
    (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const scope = String(body.actionConfirmScope || '').trim().toLowerCase();
      if (scope !== 'password-register') {
        const pinCheck = scope === 'coldmail-send'
          ? validateRiskyActionConfirmPin(body, { expectedPin: COLDMAIL_SEND_CONFIRM_PIN })
          : validatePremiumAdminActionPin(body);
        if (!pinCheck.ok) return res.status(403).json({ ok: false, error: pinCheck.error });
        return res.json({ ok: true });
      }

      const ownerDecision = passwordRegisterOwnerPolicy.getAccessDecision(req.premiumAuth);
      if (!ownerDecision.ok) {
        appendPasswordPinAudit(
          req,
          'password_register_owner_denied',
          ownerDecision.statusCode === 503
            ? 'Wachtwoordenregister PIN geweigerd omdat eigenaarstoegang niet geconfigureerd is.'
            : 'Wachtwoordenregister PIN geweigerd voor niet-eigenaar.'
        );
        return res.status(ownerDecision.statusCode).json({
          ok: false,
          code: ownerDecision.code,
          error: ownerDecision.error,
        });
      }

      const activeLimit = pinAttemptLimiter.check(req);
      if (!activeLimit.ok) {
        appendPasswordPinAudit(req, 'password_register_pin_rate_limit_hit', 'Te veel mislukte PIN-pogingen.');
        return sendPinRateLimit(res, activeLimit);
      }

      const pinCheck = validatePremiumAdminActionPin(body, {
        envName: 'PREMIUM_PASSWORD_REGISTER_CONFIRM_PIN',
        requireConfigured: true,
      });
      if (!pinCheck.ok) {
        if (pinCheck.statusCode !== 503) {
          const nextLimit = pinAttemptLimiter.recordFailure(req);
          if (!nextLimit.ok) {
            appendPasswordPinAudit(req, 'password_register_pin_rate_limit_hit', 'Maximaal aantal mislukte PIN-pogingen bereikt.');
            return sendPinRateLimit(res, nextLimit);
          }
        }
        appendPasswordPinAudit(
          req,
          'password_register_pin_rejected',
          pinCheck.statusCode === 503 ? 'Kluis-PIN is niet geconfigureerd.' : 'Kluis-PIN is geweigerd.'
        );
        return res.status(pinCheck.statusCode === 503 ? 503 : 403).json({
          ok: false,
          code: pinCheck.code,
          error: pinCheck.error,
        });
      }
      pinAttemptLimiter.reset(req);
      const writeProofResult = passwordRegisterWriteProofManager?.mint(req.premiumAuth);
      if (!writeProofResult?.ok) {
        appendPasswordPinAudit(req, 'password_register_write_proof_unavailable', 'Write-proof kon niet veilig worden uitgegeven.');
        return res.status(503).json({
          ok: false,
          code: 'PASSWORD_REGISTER_WRITE_PROOF_UNAVAILABLE',
          error: 'Wachtwoordenregister-bevestiging kon niet veilig worden uitgegeven.',
        });
      }
      appendPasswordPinAudit(req, 'password_register_pin_verified', 'Wachtwoordenregister PIN-gate bevestigd.');
      return res.json({
        ok: true,
        writeProof: writeProofResult.writeProof,
        writeProofExpiresAt: writeProofResult.writeProofExpiresAt,
      });
    }
  );

  app.patch('/api/premium-users/:id', deps.requirePremiumAdminApiAccess, (req, res) => {
    const pinCheck = validatePremiumAdminActionPin(req.body);
    if (!pinCheck.ok) return res.status(403).json({ ok: false, error: pinCheck.error });
    return deps.coordinator.updatePremiumUserResponse(req, res, req.params.id);
  });

  app.delete('/api/premium-users/:id', deps.requirePremiumAdminApiAccess, (req, res) =>
    deps.coordinator.deletePremiumUserResponse(req, res, req.params.id)
  );
}

module.exports = {
  registerPremiumUserManagementRoutes,
};

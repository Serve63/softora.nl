function registerPremiumDatabaseEmailVerificationRoutes(app, deps = {}) {
  const {
    coordinator,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    requirePremiumAdminApiAccess = (_req, _res, next) => next(),
  } = deps;

  if (!coordinator) return;

  app.get('/api/premium-database/email-verification/status', requirePremiumAdminApiAccess, async (_req, res) => {
    try {
      if (typeof coordinator.getStatus !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'EMAIL_VERIFICATION_STATUS_UNAVAILABLE',
          message: 'E-mailverificatie status is niet beschikbaar.',
        });
        return;
      }
      res.json(coordinator.getStatus());
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'EMAIL_VERIFICATION_STATUS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'E-mailverificatie status kon niet worden geladen.',
          500
        ),
      });
    }
  });

  app.post('/api/premium-database/email-verification/verify', requirePremiumAdminApiAccess, async (req, res) => {
    try {
      if (typeof coordinator.verifyDatabaseEmails !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'EMAIL_VERIFICATION_UNAVAILABLE',
          message: 'E-mailverificatie is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coordinator.verifyDatabaseEmails({
        limit: body.limit,
        force: body.force === true,
        recheck: body.recheck === true,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Premium Database e-mailverificatie',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'EMAIL_VERIFICATION_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'E-mailverificatie kon niet worden uitgevoerd.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        failedItems: Array.isArray(error && error.failedItems) ? error.failedItems : undefined,
      });
    }
  });
}

module.exports = {
  registerPremiumDatabaseEmailVerificationRoutes,
};

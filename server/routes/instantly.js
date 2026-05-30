function registerInstantlyRoutes(app, deps = {}) {
  const {
    instantlyOutreachService,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    requirePremiumAdminApiAccess = (_req, _res, next) => next(),
  } = deps;

  if (!instantlyOutreachService) return;

  async function handleSync(req, res) {
    try {
      if (typeof instantlyOutreachService.syncInstantlyLeads !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_SYNC_UNAVAILABLE',
          message: 'Instantly sync is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await instantlyOutreachService.syncInstantlyLeads({
        limit: body.limit,
        refreshExistingVariables: body.refreshExistingVariables,
        refreshExistingLimit: body.refreshExistingLimit,
        refreshExistingOnly: body.refreshExistingOnly,
        reconcileOnly: body.reconcileOnly,
        cleanupOnly: body.cleanupOnly,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Instantly sync',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_SYNC_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly sync kon niet worden gestart.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
      });
    }
  }

  async function handleStatus(_req, res) {
    try {
      if (typeof instantlyOutreachService.getStatus !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_STATUS_UNAVAILABLE',
          message: 'Instantly status is niet beschikbaar.',
        });
        return;
      }
      const result = await instantlyOutreachService.getStatus();
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_STATUS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly status kon niet worden geladen.',
          500
        ),
      });
    }
  }

  app.post('/api/instantly/webhook', async (req, res) => {
    try {
      if (typeof instantlyOutreachService.handleInstantlyWebhook !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_WEBHOOK_UNAVAILABLE',
          message: 'Instantly webhook is niet beschikbaar.',
        });
        return;
      }
      const result = await instantlyOutreachService.handleInstantlyWebhook(req);
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_WEBHOOK_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly webhook kon niet worden verwerkt.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
      });
    }
  });

  app.post('/api/instantly/sync', requirePremiumAdminApiAccess, handleSync);
  app.post('/api/outreach/provider-sync', requirePremiumAdminApiAccess, handleSync);

  app.get('/api/instantly/status', requirePremiumAdminApiAccess, handleStatus);
  app.get('/api/outreach/provider-status', requirePremiumAdminApiAccess, handleStatus);
}

module.exports = {
  registerInstantlyRoutes,
};

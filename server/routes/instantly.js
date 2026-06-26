function registerInstantlyRoutes(app, deps = {}) {
  const {
    instantlyOutreachService,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    requirePremiumAdminApiAccess = (_req, _res, next) => next(),
  } = deps;

  if (!instantlyOutreachService) return;

  async function handlePrepareUpload(req, res) {
    try {
      if (typeof instantlyOutreachService.prepareInstantlyUpload !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_SAFE_UPLOAD_UNAVAILABLE',
          message: 'Veilige Instantly upload is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await instantlyOutreachService.prepareInstantlyUpload({
        limit: body.limit,
        campaignId: body.campaignId || body.campaign || body.defaultCampaignId,
        uploadId: body.uploadId,
        senderProfile: body.senderProfile || body.senderProfileKey || body.profileKey,
        senderEmail: body.senderEmail || body.sentFromEmail || body.mailboxAccount,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Instantly veilige upload',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_SAFE_UPLOAD_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Veilige Instantly upload kon niet worden voorbereid.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
      });
    }
  }

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
        campaignId: body.campaignId || body.campaign || body.defaultCampaignId,
        senderProfile: body.senderProfile || body.senderProfileKey || body.profileKey,
        senderEmail: body.senderEmail || body.sentFromEmail || body.mailboxAccount,
        refreshExistingVariables: body.refreshExistingVariables === true,
        refreshExistingLimit: body.refreshExistingLimit,
        refreshExistingOnly: body.refreshExistingOnly === true,
        reconcileOnly: true,
        cleanupOnly: body.cleanupOnly === true,
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

  app.post('/api/instantly/prepare-upload', requirePremiumAdminApiAccess, handlePrepareUpload);
  app.post('/api/outreach/provider-upload', requirePremiumAdminApiAccess, handlePrepareUpload);

  app.get('/api/instantly/status', requirePremiumAdminApiAccess, handleStatus);
  app.get('/api/outreach/provider-status', requirePremiumAdminApiAccess, handleStatus);
}

module.exports = {
  registerInstantlyRoutes,
};

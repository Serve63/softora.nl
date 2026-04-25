function registerColdmailingRoutes(app, deps = {}) {
  const {
    coldmailCampaignService,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  if (!coldmailCampaignService) return;

  app.get('/api/coldmailing/mailbox-options', (_req, res) => {
    res.json({
      ok: true,
      configured: coldmailCampaignService.isSmtpMailConfigured(),
      missing: coldmailCampaignService.getMissingSmtpMailEnv(),
      senderEmails: coldmailCampaignService.getAllowedSenderEmails(),
    });
  });

  app.post('/api/coldmailing/campaigns/send', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.sendColdmailCampaign({
        count: body.count,
        subject: body.subject,
        body: body.body,
        branch: body.branch,
        service: body.service,
        database: body.database,
        senderEmail: body.senderEmail,
        specialAction: body.specialAction,
        durationDays: body.durationDays,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          'Coldmailing',
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_SEND_FAILED';
      const status = code === 'SMTP_NOT_CONFIGURED'
        ? 503
        : code === 'NO_RECIPIENTS' || code === 'NO_VALID_RECIPIENT_DOMAINS'
          ? 422
          : 400;
      res.status(status).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmailcampagne kon niet worden verstuurd.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        failedItems: Array.isArray(error && error.failedItems) ? error.failedItems : undefined,
        allowedSenderEmails: Array.isArray(error && error.allowedSenderEmails)
          ? error.allowedSenderEmails
          : undefined,
      });
    }
  });
}

module.exports = {
  registerColdmailingRoutes,
};

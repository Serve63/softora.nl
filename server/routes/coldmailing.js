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
      imapConfigured:
        typeof coldmailCampaignService.isImapMailConfigured === 'function'
          ? coldmailCampaignService.isImapMailConfigured()
          : false,
      senderEmails: coldmailCampaignService.getAllowedSenderEmails(),
    });
  });

  app.get('/api/coldmailing/campaigns/recipients', async (req, res) => {
    try {
      const result = await coldmailCampaignService.getColdmailCampaignRecipients({
        count: req.query.count,
        branch: req.query.branch,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'COLDMAIL_RECIPIENTS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Ontvangers konden niet worden geladen.',
          500
        ),
      });
    }
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

  app.post('/api/coldmailing/replies/sync', async (req, res) => {
    try {
      if (typeof coldmailCampaignService.syncInboundColdmailRepliesFromImap !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_REPLY_SYNC_UNAVAILABLE',
          message: 'Coldmail reply-sync is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.syncInboundColdmailRepliesFromImap({
        force: Boolean(body.force),
        maxMessages: body.maxMessages,
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_REPLY_SYNC_FAILED';
      res.status(code === 'ANTHROPIC_NOT_CONFIGURED' ? 503 : 400).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmail replies konden niet worden verwerkt.',
          500
        ),
      });
    }
  });
}

module.exports = {
  registerColdmailingRoutes,
};

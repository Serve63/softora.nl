function registerColdmailingRoutes(app, deps = {}) {
  const {
    coldmailCampaignService,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    requirePremiumAdminApiAccess = (_req, _res, next) => next(),
  } = deps;

  if (!coldmailCampaignService) return;

  app.get('/api/coldmailing/mailbox-options', (_req, res) => {
    const configuredSenderEmails =
      typeof coldmailCampaignService.getConfiguredSenderEmails === 'function'
        ? coldmailCampaignService.getConfiguredSenderEmails()
        : undefined;
    res.json({
      ok: true,
      configured: coldmailCampaignService.isSmtpMailConfigured(),
      missing: coldmailCampaignService.getMissingSmtpMailEnv(),
      imapConfigured:
        typeof coldmailCampaignService.isImapMailConfigured === 'function'
          ? coldmailCampaignService.isImapMailConfigured()
          : false,
      senderEmails:
        Array.isArray(configuredSenderEmails) && configuredSenderEmails.length
          ? configuredSenderEmails
          : coldmailCampaignService.getAllowedSenderEmails(),
      configuredSenderEmails,
      safetyLimits:
        typeof coldmailCampaignService.getColdmailSafetyLimits === 'function'
          ? coldmailCampaignService.getColdmailSafetyLimits()
          : undefined,
    });
  });

  app.get('/api/coldmailing/campaigns/recipients', async (req, res) => {
    try {
      const result = await coldmailCampaignService.getColdmailCampaignRecipients({
        count: req.query.count,
        branch: req.query.branch,
        mode: req.query.mode,
        radiusKm: req.query.radiusKm,
        blockedPhones: req.query.blockedPhones,
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

  app.get('/api/coldmailing/open.gif', async (req, res) => {
    try {
      if (typeof coldmailCampaignService.recordColdmailOpen === 'function') {
        await coldmailCampaignService.recordColdmailOpen({
          id: req.query.id || req.query.customerId,
          email: req.query.email,
          trackingId: req.query.trackingId || req.query.tid,
          token: req.query.token,
          actor: 'Coldmail open tracking',
        });
      }
    } catch (_) {
      // Tracking pixels should never break the recipient's mail client.
    }
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Content-Type': 'image/gif',
    });
    res.send(Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'));
  });

  app.post('/api/coldmailing/unsubscribe', async (req, res) => {
    try {
      if (typeof coldmailCampaignService.unsubscribeColdmailRecipient !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_UNSUBSCRIBE_UNAVAILABLE',
          message: 'Afmelden is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.unsubscribeColdmailRecipient({
        email: req.query.email || body.email,
        token: req.query.token || body.token,
        actor: 'Coldmail unsubscribe',
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_UNSUBSCRIBE_FAILED';
      res.status(code === 'INVALID_UNSUBSCRIBE_TOKEN' ? 403 : 400).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Afmelden kon niet worden verwerkt.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/campaigns/send', requirePremiumAdminApiAccess, async (req, res) => {
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
        radiusKm: body.radiusKm,
        mode: body.mode,
        blockedPhones: body.blockedPhones || body.callBlocklist,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          'Coldmailing',
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_SEND_FAILED';
      const status = code === 'SMTP_NOT_CONFIGURED' || code === 'SENDER_SMTP_NOT_CONFIGURED'
        ? 503
        : code === 'COLDMAIL_SEND_IN_PROGRESS'
          ? 409
        : code === 'COLDMAIL_DAILY_LIMIT_REACHED' ||
            code === 'COLDMAIL_SAFETY_PAUSED' ||
            code === 'COLDMAIL_SEND_WINDOW_CLOSED'
          ? 429
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
        quota: error && error.quota && typeof error.quota === 'object' ? error.quota : undefined,
      });
    }
  });

  app.post('/api/coldmailing/campaigns/dispatch-due', requirePremiumAdminApiAccess, async (_req, res) => {
    try {
      if (typeof coldmailCampaignService.dispatchColdmailScheduledQueue !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_SCHEDULE_UNAVAILABLE',
          message: 'Coldmail planning is niet beschikbaar.',
        });
        return;
      }
      const result = await coldmailCampaignService.dispatchColdmailScheduledQueue('Coldmail planning');
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'COLDMAIL_SCHEDULE_DISPATCH_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmail planning kon niet worden verwerkt.',
          500
        ),
      });
    }
  });

  app.get('/api/coldmailing/replies/follow-ups', async (req, res) => {
    try {
      if (typeof coldmailCampaignService.listColdmailReplyFollowUps !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_REPLY_FOLLOW_UPS_UNAVAILABLE',
          message: 'Coldmail follow-ups zijn niet beschikbaar.',
        });
        return;
      }
      const result = await coldmailCampaignService.listColdmailReplyFollowUps({
        limit: req.query.limit,
        campaignType: req.query.campaignType || req.query.campaign || req.query.source,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'COLDMAIL_REPLY_FOLLOW_UPS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmail follow-ups konden niet worden geladen.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/replies/sync', requirePremiumAdminApiAccess, async (req, res) => {
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
      res.status(code === 'OPENAI_NOT_CONFIGURED' ? 503 : 400).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmail replies konden niet worden verwerkt.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/outreach/status', requirePremiumAdminApiAccess, async (req, res) => {
    try {
      if (typeof coldmailCampaignService.updateWebdesignOutreachStatus !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'WEBDESIGN_OUTREACH_STATUS_UNAVAILABLE',
          message: 'Webdesign-outreach statusupdates zijn niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.updateWebdesignOutreachStatus({
        customerId: body.customerId || body.id,
        email: body.email,
        messageId: body.messageId,
        mailboxId: body.mailboxId,
        replyThreadId: body.replyThreadId,
        replyMessageId: body.replyMessageId,
        status: body.status,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Mailbox',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'WEBDESIGN_OUTREACH_STATUS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Outreach-status kon niet worden bijgewerkt.',
          500
        ),
      });
    }
  });
}

module.exports = {
  registerColdmailingRoutes,
};

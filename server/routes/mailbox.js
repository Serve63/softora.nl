const { createMailboxSpellingService } = require('../services/mailbox-spelling');

const MAILBOX_ATTACHMENT_CRON_SWEEP_TIMEOUT_MS = 5_000;

function registerMailboxRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const spellingService = deps.spellingService || createMailboxSpellingService({ logger: deps.logger });
  const logger = deps.logger || console;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  const supabaseOutageCronPause = String(
    deps.supabaseOutageCronPause || process.env.SUPABASE_OUTAGE_CRON_PAUSE || ''
  ).trim();
  const attachmentSweepTimeoutMs = Math.max(1, Math.min(
    MAILBOX_ATTACHMENT_CRON_SWEEP_TIMEOUT_MS,
    Number(deps.attachmentSweepTimeoutMs) || MAILBOX_ATTACHMENT_CRON_SWEEP_TIMEOUT_MS
  ));

  function isEnabledFlag(value) {
    if (typeof value === 'boolean') return value;
    return /^(1|true|yes|on)$/i.test(String(value || '').trim());
  }

  function shouldSkipCronForSupabaseOutage() {
    if (typeof deps.isSupabaseOutageCronPaused === 'function') {
      return Boolean(deps.isSupabaseOutageCronPaused());
    }
    return isEnabledFlag(supabaseOutageCronPause || process.env.SUPABASE_OUTAGE_CRON_PAUSE);
  }

  function sendSupabaseOutageCronPauseResponse(res) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      code: 'SUPABASE_OUTAGE_CRON_PAUSED',
      reason: 'supabase_outage_cron_paused',
      message: 'Mailbox cron tijdelijk overgeslagen vanwege Supabase outage-pauze.',
    });
  }

  function requireCronAccess(req, res, next) {
    if (!cronSecret) {
      return res.status(503).json({
        ok: false,
        error: 'Mailbox cron is niet geconfigureerd.',
      });
    }
    const authorization = String(req.headers?.authorization || '').trim();
    if (authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({
        ok: false,
        error: 'Mailbox cron geweigerd.',
      });
    }
    return next();
  }

  async function sweepExpiredAttachmentsBeforeCronSync() {
    if (typeof coordinator.sweepExpiredAttachments !== 'function') return;
    let timeout = null;
    try {
      await Promise.race([
        Promise.resolve().then(() => coordinator.sweepExpiredAttachments({
          totalTimeoutMs: attachmentSweepTimeoutMs,
        })),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            const error = new Error(
              `Mailbox attachment cron sweep timeout na ${attachmentSweepTimeoutMs}ms`
            );
            error.code = 'MAILBOX_ATTACHMENT_CRON_SWEEP_TIMEOUT';
            reject(error);
          }, attachmentSweepTimeoutMs);
        }),
      ]);
    } catch (error) {
      if (typeof logger.warn === 'function') {
        logger.warn('[MailboxAttachment][CronSweep]', error?.message || error);
      }
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  app.get('/api/mailbox/accounts', requireAdmin, (req, res) => coordinator.accountsResponse(req, res));
  app.get('/api/mailbox/campaign-replies', requireAdmin, (req, res) =>
    coordinator.campaignRepliesResponse(req, res)
  );
  app.get('/api/mailbox/search', requireAdmin, (req, res) => coordinator.searchMailboxResponse(req, res));
  app.get('/api/mailbox/contact-timeline', requireAdmin, (req, res) =>
    coordinator.contactTimelineResponse(req, res)
  );
  app.get('/api/mailbox/messages', requireAdmin, (req, res) => coordinator.listMessagesResponse(req, res));
  app.get('/api/mailbox/message', requireAdmin, (req, res) => coordinator.getMessageResponse(req, res));
  app.post('/api/mailbox/provider-thread-audit', requireAdmin, (req, res) => coordinator.providerThreadAuditResponse(req, res));
  app.post('/api/mailbox/messages/bodies', requireAdmin, (req, res) =>
    coordinator.getMessageBodiesResponse(req, res)
  );
  app.get('/api/mailbox/message-image', requireAdmin, (req, res) =>
    coordinator.getMessageImageResponse(req, res)
  );
  app.post('/api/mailbox/messages/read', requireAdmin, (req, res) =>
    coordinator.markMessageReadResponse(req, res)
  );
  app.post('/api/mailbox/messages/read/status', requireAdmin, (req, res) =>
    coordinator.getMessageReadStatusResponse(req, res)
  );
  app.post('/api/mailbox/messages/hide', requireAdmin, (req, res) =>
    coordinator.hideConversationResponse(req, res)
  );
  app.post('/api/mailbox/messages/restore', requireAdmin, (req, res) =>
    coordinator.restoreConversationResponse(req, res)
  );
  app.post('/api/mailbox/sync', requireAdmin, (req, res) => coordinator.syncMailboxResponse(req, res));
  app.post('/api/mailbox/instantly/sync', requireAdmin, (req, res) =>
    coordinator.syncInstantlyMailboxResponse(req, res)
  );
  app.get('/api/mailbox/instantly/sync', requireCronAccess, (req, res) => {
    if (shouldSkipCronForSupabaseOutage()) {
      sendSupabaseOutageCronPauseResponse(res);
      return;
    }
    coordinator.syncInstantlyMailboxResponse(req, res);
  });
  app.get('/api/mailbox/sync', requireCronAccess, async (req, res) => {
    if (shouldSkipCronForSupabaseOutage()) {
      sendSupabaseOutageCronPauseResponse(res);
      return;
    }
    await sweepExpiredAttachmentsBeforeCronSync();
    return coordinator.syncMailboxResponse(req, res);
  });
  app.post('/api/mailbox/send/preflight', requireAdmin, (req, res) =>
    coordinator.preflightMessageResponse(req, res)
  );
  app.post('/api/mailbox/attachments/upload-url', requireAdmin, (req, res) =>
    coordinator.attachmentUploadResponse(req, res)
  );
  app.post('/api/mailbox/attachments/cleanup', requireAdmin, (req, res) =>
    coordinator.attachmentCleanupResponse(req, res)
  );
  app.post('/api/mailbox/send', requireAdmin, (req, res) => {
    res.locals.mailboxSendRuntimeEntered = true;
    return coordinator.sendMessageResponse(req, res);
  });
  app.post('/api/mailbox/rewrite', requireAdmin, (req, res) =>
    coordinator.rewriteDraftResponse(req, res)
  );
  app.post('/api/mailbox/spelling', requireAdmin, (req, res) =>
    spellingService.correctDraftResponse(req, res)
  );
}

module.exports = {
  registerMailboxRoutes,
};

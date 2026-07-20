function registerMailboxRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  const supabaseOutageCronPause = String(
    deps.supabaseOutageCronPause || process.env.SUPABASE_OUTAGE_CRON_PAUSE || ''
  ).trim();

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

  app.get('/api/mailbox/accounts', requireAdmin, (req, res) => coordinator.accountsResponse(req, res));
  app.get('/api/mailbox/campaign-replies', requireAdmin, (req, res) =>
    coordinator.campaignRepliesResponse(req, res)
  );
  app.get('/api/mailbox/messages', requireAdmin, (req, res) => coordinator.listMessagesResponse(req, res));
  app.get('/api/mailbox/message', requireAdmin, (req, res) => coordinator.getMessageResponse(req, res));
  app.post('/api/mailbox/messages/read', requireAdmin, (req, res) =>
    coordinator.markMessageReadResponse(req, res)
  );
  app.post('/api/mailbox/messages/delete', requireAdmin, (req, res) =>
    coordinator.deleteMessageResponse(req, res)
  );
  app.post('/api/mailbox/sync', requireAdmin, (req, res) => coordinator.syncMailboxResponse(req, res));
  app.get('/api/mailbox/sync', requireCronAccess, (req, res) => {
    if (shouldSkipCronForSupabaseOutage()) {
      sendSupabaseOutageCronPauseResponse(res);
      return;
    }
    coordinator.syncMailboxResponse(req, res);
  });
  app.post('/api/mailbox/send', requireAdmin, (req, res) => coordinator.sendMessageResponse(req, res));
  app.post('/api/mailbox/rewrite', requireAdmin, (req, res) =>
    coordinator.rewriteDraftResponse(req, res)
  );
}

module.exports = {
  registerMailboxRoutes,
};

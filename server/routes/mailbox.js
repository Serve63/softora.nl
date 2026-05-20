function registerMailboxRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();

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
  app.get('/api/mailbox/messages', requireAdmin, (req, res) => coordinator.listMessagesResponse(req, res));
  app.get('/api/mailbox/message', requireAdmin, (req, res) => coordinator.getMessageResponse(req, res));
  app.post('/api/mailbox/sync', requireAdmin, (req, res) => coordinator.syncMailboxResponse(req, res));
  app.get('/api/mailbox/sync', requireCronAccess, (req, res) => coordinator.syncMailboxResponse(req, res));
  app.post('/api/mailbox/send', requireAdmin, (req, res) => coordinator.sendMessageResponse(req, res));
}

module.exports = {
  registerMailboxRoutes,
};

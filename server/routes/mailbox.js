function registerMailboxRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();

  app.get('/api/mailbox/accounts', requireAdmin, (req, res) => coordinator.accountsResponse(req, res));
  app.get('/api/mailbox/messages', requireAdmin, (req, res) => coordinator.listMessagesResponse(req, res));
  app.post('/api/mailbox/messages/read', requireAdmin, (req, res) =>
    coordinator.markMessageReadResponse(req, res)
  );
  app.post('/api/mailbox/messages/delete', requireAdmin, (req, res) =>
    coordinator.deleteMessageResponse(req, res)
  );
  app.post('/api/mailbox/send', requireAdmin, (req, res) => coordinator.sendMessageResponse(req, res));
  app.post('/api/mailbox/rewrite', requireAdmin, (req, res) =>
    coordinator.rewriteDraftResponse(req, res)
  );
}

module.exports = {
  registerMailboxRoutes,
};

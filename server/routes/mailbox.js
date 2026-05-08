function registerMailboxRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;
  const requireAdmin =
    typeof deps.requirePremiumAdminApiAccess === 'function'
      ? deps.requirePremiumAdminApiAccess
      : (_req, _res, next) => next();

  app.get('/api/mailbox/accounts', requireAdmin, (req, res) => coordinator.accountsResponse(req, res));
  app.get('/api/mailbox/messages', requireAdmin, (req, res) => coordinator.listMessagesResponse(req, res));
  app.post('/api/mailbox/send', requireAdmin, (req, res) => coordinator.sendMessageResponse(req, res));
}

module.exports = {
  registerMailboxRoutes,
};

function registerMailboxRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;

  app.get('/api/mailbox/accounts', (req, res) => coordinator.accountsResponse(req, res));
  app.get('/api/mailbox/messages', (req, res) => coordinator.listMessagesResponse(req, res));
  app.post('/api/mailbox/send', (req, res) => coordinator.sendMessageResponse(req, res));
}

module.exports = {
  registerMailboxRoutes,
};

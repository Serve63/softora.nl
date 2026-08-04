const {
  isAutomatedDeliveryFailureMessage,
} = require('./coldmail-bounce-stats');
const {
  isAutomatedCampaignReply,
} = require('./mailbox-automated-reply');

function isAutomatedMailboxMessage(message) {
  return isAutomatedDeliveryFailureMessage(message) || isAutomatedCampaignReply(message);
}

function filterVisibleMailboxMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => !isAutomatedMailboxMessage(message));
}

function assertMailboxMessageVisible(message) {
  if (!isAutomatedMailboxMessage(message)) return message;
  const error = new Error('Dit automatische bericht wordt niet in de Softora-mailbox getoond.');
  error.status = 404;
  throw error;
}

module.exports = {
  assertMailboxMessageVisible,
  filterVisibleMailboxMessages,
  isAutomatedMailboxMessage,
};

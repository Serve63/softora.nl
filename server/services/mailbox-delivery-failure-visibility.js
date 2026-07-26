const {
  isAutomatedDeliveryFailureMessage,
} = require('./coldmail-bounce-stats');

function filterVisibleMailboxMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => !isAutomatedDeliveryFailureMessage(message));
}

function assertMailboxMessageVisible(message) {
  if (!isAutomatedDeliveryFailureMessage(message)) return message;
  const error = new Error('Dit automatische bezorgbericht wordt niet in de Softora-mailbox getoond.');
  error.status = 404;
  throw error;
}

module.exports = {
  assertMailboxMessageVisible,
  filterVisibleMailboxMessages,
};

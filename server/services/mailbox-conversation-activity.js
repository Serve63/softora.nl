'use strict';

const { getMailboxMessageDirection } = require('./mailbox-message-provenance');

function getTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMessageDate(message) {
  return String(message && (
    message.receivedAt ||
    message.internalDate ||
    message.date
  ) || '');
}

function isCopiedOutbound(message) {
  const context = message && message.copyContext;
  return Boolean(
    context &&
    context.evidenceKnown === true &&
    ['bcc', 'cc'].includes(String(context.kind || '').trim().toLowerCase())
  );
}

function isConversationOutbound(message) {
  return getMailboxMessageDirection(message) === 'sent' || isCopiedOutbound(message);
}

function resolveConversationActivity(message) {
  const source = message && typeof message === 'object' ? message : {};
  const messages = [source, ...(Array.isArray(source.threadMessages) ? source.threadMessages : [])];
  function latestByDirection(outbound) {
    return messages
      .filter((entry) => Boolean(entry) && isConversationOutbound(entry) === outbound)
      .map((entry) => getMessageDate(entry))
      .filter((value) => getTimestamp(value))
      .sort((left, right) => getTimestamp(right) - getTimestamp(left))[0] || '';
  }
  return {
    latestInboundAt: latestByDirection(false),
    latestOutboundAt: latestByDirection(true),
  };
}

module.exports = {
  getMessageDate,
  isConversationOutbound,
  resolveConversationActivity,
};

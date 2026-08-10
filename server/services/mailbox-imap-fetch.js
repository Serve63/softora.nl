const { attachMailboxSyncReadHealth } = require('./mailbox-imap-message-parser');

async function fetchSelectedMailboxMessages({
  account,
  client,
  deadlineAt,
  folder,
  parseMessage,
  selectedUids = [],
  signal,
  throwIfAborted = () => {},
} = {}) {
  const messages = [];
  const parseFailures = [];
  for await (const message of client.fetch(
    selectedUids,
    { uid: true, flags: true, internalDate: true, source: true },
    { uid: true }
  )) {
    throwIfAborted();
    const parsed = await parseMessage({
      message,
      account,
      folder,
      signal,
      deadlineAt,
    });
    if (parsed.ok) messages.push(parsed.message);
    else parseFailures.push(parsed);
  }
  const sorted = messages.sort((left, right) => (
    (Date.parse(right?.date) || 0) - (Date.parse(left?.date) || 0)
  ));
  return attachMailboxSyncReadHealth(sorted, {
    parseFailures,
    selectedCount: selectedUids.length,
    folderMissing: false,
  });
}

module.exports = { fetchSelectedMailboxMessages };

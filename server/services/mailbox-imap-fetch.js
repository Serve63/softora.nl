const { attachMailboxSyncReadResult } = require('./mailbox-imap-message-parser');
const { buildMailboxImapQuarantineMessage } = require('./mailbox-imap-quarantine-message');

async function fetchSelectedMailboxMessages({
  account,
  client,
  deadlineAt,
  folder,
  parseMessage,
  selectedUids = [],
  signal,
  throwIfAborted = () => {},
  uidValidity = 0,
} = {}) {
  const messages = [];
  const parseFailures = [];
  const yieldedUids = new Set();
  for await (const message of client.fetch(
    selectedUids,
    { uid: true, flags: true, internalDate: true, envelope: true, source: true },
    { uid: true }
  )) {
    throwIfAborted();
    const yieldedUid = Number(message?.uid) || 0;
    if (yieldedUid > 0) yieldedUids.add(yieldedUid);
    const parsed = await parseMessage({
      message, account, folder, signal, deadlineAt, uidValidity,
    });
    if (parsed.ok) messages.push({ ...parsed.message, uidValidity });
    else {
      parseFailures.push(parsed);
      messages.push({ ...buildMailboxImapQuarantineMessage({
        message,
        account,
        folder,
        failure: parsed,
      }), uidValidity });
    }
  }
  const missingUids = selectedUids.filter((uid) => !yieldedUids.has(Number(uid)));
  const sorted = messages.sort((left, right) => (
    (Date.parse(right?.date) || 0) - (Date.parse(left?.date) || 0)
  ));
  return attachMailboxSyncReadResult(sorted, {
    parseFailures,
    selectedUids,
    yieldedUids: Array.from(yieldedUids),
    missingUids,
    uidValidity,
    folderMissing: false,
  });
}

module.exports = { fetchSelectedMailboxMessages };

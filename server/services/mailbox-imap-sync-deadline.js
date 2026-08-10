const {
  MAILBOX_IMAP_CONNECTION_TIMEOUT_MS,
  MAILBOX_IMAP_GREETING_TIMEOUT_MS,
  MAILBOX_IMAP_SOCKET_TIMEOUT_MS,
  getMailboxSyncResponseStatus,
} = require('./mailbox-sync-runtime');

function getMailboxImapSyncTimeouts({ signal, deadlineAt = 0 } = {}) {
  if (!signal) return {};
  const remainingMs = Number(deadlineAt) > 0
    ? Math.max(1_000, Number(deadlineAt) - Date.now())
    : Number.POSITIVE_INFINITY;
  return {
    connectionTimeout: Math.min(MAILBOX_IMAP_CONNECTION_TIMEOUT_MS, remainingMs),
    greetingTimeout: Math.min(MAILBOX_IMAP_GREETING_TIMEOUT_MS, remainingMs),
    socketTimeout: Math.min(MAILBOX_IMAP_SOCKET_TIMEOUT_MS, remainingMs),
  };
}

function createMailboxImapSyncSession({ client, signal } = {}) {
  const close = () => {
    try {
      client?.close?.();
    } catch (_) {}
  };
  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error('Mailbox-sync geannuleerd.'), {
          code: 'MAILBOX_SYNC_FOLDER_TIMEOUT',
          timedOut: true,
        });
  };
  if (signal) {
    if (signal.aborted) close();
    else signal.addEventListener('abort', close, { once: true });
  }
  return {
    async run(operation) {
      let result;
      try {
        throwIfAborted();
        result = await operation(client);
        throwIfAborted();
      } catch (error) {
        throwIfAborted();
        throw error;
      } finally {
        try {
          if (!signal?.aborted && client?.usable) await client.logout();
        } catch (_) {}
        if (signal) signal.removeEventListener('abort', close);
      }
      throwIfAborted();
      return result;
    },
  };
}

module.exports = {
  createMailboxImapSyncSession,
  getMailboxImapSyncTimeouts,
  getMailboxSyncResponseStatus,
};

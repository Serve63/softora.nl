function createMailboxImapAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Mailbox IMAP-opdracht is hard geannuleerd.');
  error.code = 'MAILBOX_IMAP_ABORTED';
  return error;
}

function createMailboxImapAbortScope(client, signal) {
  let hardClosed = false;
  function hardClose() {
    if (hardClosed) return;
    hardClosed = true;
    try {
      const closeResult = client?.close?.();
      closeResult?.catch?.(() => null);
    } catch (_) {}
  }
  if (signal?.aborted) {
    hardClose();
    throw createMailboxImapAbortError(signal);
  }
  const onAbort = () => hardClose();
  signal?.addEventListener?.('abort', onAbort, { once: true });

  function throwIfAborted() {
    if (!signal?.aborted) return;
    hardClose();
    throw createMailboxImapAbortError(signal);
  }

  async function dispose() {
    try {
      throwIfAborted();
      if (!hardClosed && client?.usable) await client.logout();
      throwIfAborted();
    } catch (error) {
      if (signal?.aborted) throw createMailboxImapAbortError(signal);
      // Logout-fouten waren ook vóór de abortscope niet fataal voor een geldige IMAP-read.
    } finally {
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  return { dispose, throwIfAborted };
}

module.exports = { createMailboxImapAbortScope };

'use strict';

// A transport lives only within one account's sequential refresh. Durable state
// and leases remain in the index; no connection is shared across requests/accounts.
function createMailboxImapSession() {
  let client = null;
  let accountEmail = '';
  function close() {
    const previous = client;
    client = null;
    try { return Promise.resolve(previous?.close?.()).catch(() => {}); } catch (_) { return Promise.resolve(); }
  }
  return {
    acquire(account, createClient) {
      const email = String(account.email || '').trim().toLowerCase();
      if (accountEmail && accountEmail !== email) throw new Error('IMAP-session account mismatch');
      accountEmail = email;
      if (client?.usable) return { client, reused: true };
      void close();
      client = createClient();
      return { client, reused: false };
    },
    close,
  };
}

module.exports = { createMailboxImapSession };

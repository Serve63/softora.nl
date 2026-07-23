function createMailboxDeleteMessage(deps = {}) {
  const {
    getAccount,
    parseMessageReference,
    createClient,
    resolveMailboxName,
    canUseMailboxIndex,
    mailboxIndexStore,
    refreshCampaignSnapshot,
    logger = console,
  } = deps;

  async function persistDeletion({ account, id, messageRef }) {
    if (canUseMailboxIndex() && typeof mailboxIndexStore.markMessageDeleted === 'function') {
      const result = await mailboxIndexStore.markMessageDeleted({
        accountEmail: account.email,
        id,
        folder: messageRef.folder,
        uid: messageRef.uid,
      });
      if (!result || result.ok !== true) {
        logger.warn(
          '[Mailbox][DeleteIndex]',
          result?.error?.message || 'Verwijdering niet in mailboxindex opgeslagen'
        );
      }
    }
    try {
      await refreshCampaignSnapshot({ limit: 100 });
    } catch (error) {
      logger.warn('[Mailbox][DeleteSnapshot]', error?.message || error);
    }
  }

  return async function deleteMessage({ accountEmail, id, folder, uid }) {
    const account = getAccount(accountEmail);
    if (!account) {
      const error = new Error('Mailbox-account niet gevonden.');
      error.status = 404;
      throw error;
    }
    if (!account.imapConfigured) {
      const error = new Error('IMAP is niet geconfigureerd voor deze mailbox.');
      error.status = 503;
      throw error;
    }

    const messageRef = parseMessageReference({ id, folder, uid });
    const client = createClient(account);
    let deletionResult = null;
    try {
      await client.connect();
      const sourceMailboxName = await resolveMailboxName(client, messageRef.folder);
      if (!sourceMailboxName) {
        const error = new Error('Mailboxmap niet gevonden.');
        error.status = 404;
        throw error;
      }
      const lock = await client.getMailboxLock(sourceMailboxName);
      try {
        if (messageRef.folder === 'trash') {
          await client.messageFlagsAdd([messageRef.uid], ['\\Deleted'], { uid: true });
          if (typeof client.mailboxClose === 'function') await client.mailboxClose();
          deletionResult = {
            account: account.email,
            folder: messageRef.folder,
            uid: messageRef.uid,
            deleted: true,
            permanent: true,
          };
        } else {
          const trashMailboxName = await resolveMailboxName(client, 'trash');
          if (!trashMailboxName) {
            const error = new Error('Prullenbakmap niet gevonden voor deze mailbox.');
            error.status = 404;
            throw error;
          }
          if (typeof client.messageMove !== 'function') {
            const error = new Error('Deze mailbox ondersteunt verplaatsen naar prullenbak niet.');
            error.status = 503;
            throw error;
          }
          await client.messageMove([messageRef.uid], trashMailboxName, { uid: true });
          deletionResult = {
            account: account.email,
            folder: messageRef.folder,
            destinationFolder: 'trash',
            uid: messageRef.uid,
            deleted: true,
            moved: true,
          };
        }
      } finally {
        lock.release();
      }
    } finally {
      try {
        if (client.usable) await client.logout();
      } catch (_) {}
    }

    await persistDeletion({ account, id, messageRef });
    return deletionResult;
  };
}

module.exports = {
  createMailboxDeleteMessage,
};

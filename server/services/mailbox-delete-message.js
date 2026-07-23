const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  removeMailboxCampaignSnapshotMessage,
} = require('./mailbox-campaign-snapshot');

function createMailboxDeleteMessage(deps = {}) {
  const {
    getAccount,
    parseMessageReference,
    createClient,
    resolveMailboxName,
    canUseMailboxIndex,
    mailboxIndexStore,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;

  async function removeFromCampaignSnapshot({ account, id, messageRef }) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') return false;
    try {
      const current = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
      const rawValue = current?.values?.[MAILBOX_CAMPAIGN_SNAPSHOT_KEY] || '';
      const next = removeMailboxCampaignSnapshotMessage(rawValue, {
        accountEmail: account.email,
        folder: messageRef.folder,
        id,
        uid: messageRef.uid,
      });
      if (!next.changed) return false;
      await setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: next.serialized },
        { source: 'mailbox-delete', actor: account.email }
      );
      return true;
    } catch (error) {
      logger.warn('[Mailbox][DeleteSnapshot]', error?.message || error);
      return false;
    }
  }

  async function persistDeletion({ account, id, messageRef }) {
    let indexUpdated = false;
    if (canUseMailboxIndex() && typeof mailboxIndexStore.markMessageDeleted === 'function') {
      const result = await mailboxIndexStore.markMessageDeleted({
        accountEmail: account.email,
        id,
        folder: messageRef.folder,
        uid: messageRef.uid,
      });
      if (result?.ok === true) {
        indexUpdated = true;
      } else {
        logger.warn(
          '[Mailbox][DeleteIndex]',
          result?.error?.message || 'Verwijdering niet in mailboxindex opgeslagen'
        );
      }
    }
    const snapshotUpdated = await removeFromCampaignSnapshot({ account, id, messageRef });
    return { indexUpdated, snapshotUpdated };
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

    const persistence = await persistDeletion({ account, id, messageRef });
    return { ...deletionResult, ...persistence };
  };
}

module.exports = {
  createMailboxDeleteMessage,
};

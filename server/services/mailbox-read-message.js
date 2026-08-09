const { resolveMailboxName } = require('./mailbox-sent-copy');
const { markInstantlyMessageRead } = require('./mailbox-instantly-integration');
const { createMailboxReplyDismissService } = require('./mailbox-reply-dismiss');

function createMailboxReadMessageService(deps = {}) {
  const {
    canUseMailboxIndex = () => false,
    mailboxIndexStore,
    getAccount,
    parseMessageReference,
    createClient,
    instantlyMailboxService,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;
  const mailboxReplyDismiss = createMailboxReplyDismissService({
    canUseMailboxIndex,
    mailboxIndexStore,
    getUiStateValues,
    setUiStateValues,
    logger,
  });

  async function markMessageRead({ accountEmail, id, folder, uid, owner, dismissReply = false }) {
    const instantlyResult = await markInstantlyMessageRead({
      input: { accountEmail, id, folder, uid, owner },
      instantlyMailboxService,
      mailboxIndexStore,
    });
    if (instantlyResult) {
      const { readAt, ...publicInstantlyResult } = instantlyResult;
      if (!dismissReply) return publicInstantlyResult;
      const dismissed = await mailboxReplyDismiss.dismiss({
        accountEmail: instantlyResult.account,
        id: instantlyResult.id,
        folder: instantlyResult.folder,
        uid: instantlyResult.uid,
      });
      return { ...publicInstantlyResult, ...dismissed };
    }
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
    const result = {
      account: account.email,
      folder: messageRef.folder,
      uid: messageRef.uid,
      unread: false,
    };
    let readAt = '';
    if (canUseMailboxIndex() && typeof mailboxIndexStore.markMessageRead === 'function') {
      const indexResult = await mailboxIndexStore.markMessageRead({
        accountEmail: account.email,
        id,
        folder: messageRef.folder,
        uid: messageRef.uid,
      }).catch((error) => {
        logger.error('[Mailbox][MarkReadIndex]', error?.message || error);
        return null;
      });
      readAt = indexResult?.readAt || '';
    }
    const client = createClient(account);
    try {
      await client.connect();
      const mailboxName = await resolveMailboxName(client, messageRef.folder);
      const lock = await client.getMailboxLock(mailboxName);
      try {
        await client.messageFlagsAdd([messageRef.uid], ['\\Seen'], { uid: true });
        if (!dismissReply) return result;
        const dismissed = await mailboxReplyDismiss.dismiss({
          accountEmail: account.email,
          id,
          folder: messageRef.folder,
          uid: messageRef.uid,
        });
        return { ...result, ...dismissed };
      } finally {
        lock.release();
      }
    } finally {
      try {
        if (client.usable) await client.logout();
      } catch (_) {}
    }
  }

  return { markMessageRead };
}

module.exports = { createMailboxReadMessageService };

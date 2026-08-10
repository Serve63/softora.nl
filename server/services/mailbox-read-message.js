const { resolveMailboxName } = require('./mailbox-sent-copy');
const { markInstantlyMessageRead } = require('./mailbox-instantly-integration');
const { createMailboxReplyDismissService } = require('./mailbox-reply-dismiss');
const {
  createMailboxUidValidityActionGuard,
} = require('./mailbox-uid-validity-action-guard');

function createMailboxReadMessageService(deps = {}) {
  const {
    canUseMailboxIndex = () => false,
    mailboxIndexStore,
    getAccount,
    parseMessageReference,
    createClient,
    resolveMailboxName: resolveMailboxNameForAction = resolveMailboxName,
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
  const uidValidityGuard = createMailboxUidValidityActionGuard({
    createClient,
    mailboxIndexStore,
    resolveMailboxName: resolveMailboxNameForAction,
  });

  async function markMessageRead({
    accountEmail, id, folder, uid, uidValidity, owner, dismissReply = false,
  }) {
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
    const messageRef = parseMessageReference({ id, folder, uid, uidValidity });
    const result = {
      account: account.email,
      folder: messageRef.folder,
      uid: messageRef.uid,
      uidValidity: messageRef.uidValidity,
      unread: false,
    };
    return uidValidityGuard.withCurrentUidValidity({
      account,
      folder: messageRef.folder,
      uidValidity: messageRef.uidValidity,
    }, async (client) => {
      if (dismissReply) {
        const dismissed = await mailboxReplyDismiss.dismiss({
          accountEmail: account.email,
          id,
          folder: messageRef.folder,
          uid: messageRef.uid,
          uidValidity: messageRef.uidValidity,
        });
        await client.messageFlagsAdd([messageRef.uid], ['\\Seen'], { uid: true });
        return { ...result, ...dismissed };
      }
      if (canUseMailboxIndex() && typeof mailboxIndexStore.markMessageRead === 'function') {
        const indexResult = await mailboxIndexStore.markMessageRead({
          accountEmail: account.email,
          id,
          folder: messageRef.folder,
          uid: messageRef.uid,
          uidValidity: messageRef.uidValidity,
        }).catch((error) => {
          logger.error('[Mailbox][MarkReadIndex]', error?.message || error);
          return null;
        });
        if (
          indexResult?.ok === false &&
          ['MAILBOX_UIDVALIDITY_REQUIRED', 'MAILBOX_UIDVALIDITY_STALE'].includes(indexResult.error?.code)
        ) {
          throw indexResult.error;
        }
      }
      await client.messageFlagsAdd([messageRef.uid], ['\\Seen'], { uid: true });
      return result;
    });
  }

  return { markMessageRead };
}

module.exports = { createMailboxReadMessageService };

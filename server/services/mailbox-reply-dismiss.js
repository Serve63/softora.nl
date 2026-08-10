function createMailboxReplyDismissService(deps = {}) {
  const {
    canUseMailboxIndex = () => false,
    mailboxIndexStore,
  } = deps;

  async function dismiss({ accountEmail, id, folder, uid, uidValidity }) {
    if (!canUseMailboxIndex() || typeof mailboxIndexStore?.markMessageReplyDismissed !== 'function') {
      const error = new Error('Softora-mailboxindex is niet beschikbaar; de antwoordherinnering blijft staan.');
      error.status = 503;
      throw error;
    }
    const result = await mailboxIndexStore.markMessageReplyDismissed({
      accountEmail,
      id,
      folder,
      uid,
      uidValidity,
    });
    if (result?.ok !== true) {
      const error = new Error(result?.error?.message || 'Antwoordherinnering kon niet duurzaam worden afgehandeld.');
      error.status = result?.error?.status || (result?.unavailable ? 503 : 404);
      error.code = result?.error?.code || 'MAILBOX_REPLY_DISMISS_FAILED';
      throw error;
    }
    const replyDismissedAt = result.dismissedAt || new Date().toISOString();
    // The DB trigger advances content_version. Rewriting an older snapshot in
    // place would risk erasing concurrent mail, so the next fenced refresh is
    // the only code path allowed to publish a new v3 snapshot.
    return { replyDismissedAt, snapshotUpdated: false };
  }

  return { dismiss };
}

module.exports = { createMailboxReplyDismissService };

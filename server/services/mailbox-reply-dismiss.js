const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  markMailboxCampaignSnapshotReplyDismissed,
} = require('./mailbox-campaign-snapshot');

function createMailboxReplyDismissService(deps = {}) {
  const {
    canUseMailboxIndex = () => false,
    mailboxIndexStore,
    getUiStateValues,
    setUiStateValues,
    logger = console,
  } = deps;

  async function dismiss({ accountEmail, id, folder, uid, messageKey, messageId }) {
    if (!canUseMailboxIndex() || typeof mailboxIndexStore?.markMessageReplyDismissed !== 'function') {
      const error = new Error('Softora-mailboxindex is niet beschikbaar; de antwoordherinnering blijft staan.');
      error.status = 503;
      throw error;
    }
    const result = await mailboxIndexStore.markMessageReplyDismissed({
      accountEmail, id, folder, uid, messageKey, messageId,
    });
    if (result?.ok !== true) {
      const error = new Error(result?.error?.message || 'Antwoordherinnering kon niet duurzaam worden afgehandeld.');
      error.status = result?.unavailable ? 503 : 404;
      error.code = result?.error?.code || 'MAILBOX_REPLY_DISMISS_FAILED';
      throw error;
    }
    const replyDismissedAt = result.dismissedAt || new Date().toISOString();
    const resultRow = Array.isArray(result.data) ? result.data[0] : result.data;
    let snapshotUpdated = false;
    if (typeof getUiStateValues === 'function' && typeof setUiStateValues === 'function') {
      try {
        const current = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
        const rawValue = current?.values?.[MAILBOX_CAMPAIGN_SNAPSHOT_KEY] || '';
        const snapshotResult = markMailboxCampaignSnapshotReplyDismissed(
          rawValue,
          {
            accountEmail,
            id,
            folder,
            uid,
            messageKey: String(resultRow?.message_key || resultRow?.messageKey || messageKey || '').trim(),
          },
          { dismissedAt: replyDismissedAt }
        );
        if (snapshotResult.changed) {
          await setUiStateValues(
            MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
            { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: snapshotResult.serialized },
            { source: 'mailbox-reply-dismiss', actor: accountEmail }
          );
          snapshotUpdated = true;
        }
      } catch (error) {
        logger.warn('[Mailbox][ReplyDismissSnapshot]', error?.message || error);
      }
    }
    return { replyDismissedAt, snapshotUpdated };
  }

  return { dismiss };
}

module.exports = { createMailboxReplyDismissService };

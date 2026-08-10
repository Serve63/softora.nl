const {
  listMailboxCampaignReplySets,
  mergeCampaignReplies,
} = require('./mailbox-instantly-integration');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  serializeMailboxCampaignSnapshot,
} = require('./mailbox-campaign-snapshot');

function createMailboxCampaignRepliesList({
  mailboxCampaignRepliesService,
  instantlyMailboxService,
  filterVisibleMailboxMessages,
  setUiStateValues,
  logger,
  normalizeString,
  truncateText,
}) {
  return async function listCampaignReplies({
    limit = 100,
    owner = '',
    refreshInstantly = false,
    includeSnapshotMessages = false,
    hydrateBodies = true,
  } = {}) {
    const { replies, snapshotBaseReplies } = await listMailboxCampaignReplySets({ mailboxCampaignRepliesService, limit, owner, hydrateBodies });
    const { messages, snapshotMessages, instantlyReplies, snapshotInstantlyReplies, instantlySync } = await mergeCampaignReplies({ baseReplies: replies, snapshotBaseReplies, instantlyMailboxService, limit, owner, refreshInstantly, filterVisibleMailboxMessages, normalizeString, truncateText });
    const result = {
      ok: true,
      messages,
      sync: {
        indexed: true,
        stale: instantlySync?.ok === false,
        source: instantlyReplies.length ? 'campaign-replies-index+instantly' : 'campaign-replies-index',
        refreshRecommended: instantlySync?.ok === false,
        warming: false,
        instantly: instantlySync,
      },
    };
    const serializedSnapshot = serializeMailboxCampaignSnapshot({ ...result, messages: snapshotMessages, sync: { ...result.sync, source: snapshotInstantlyReplies.length ? 'campaign-replies-index+instantly' : 'campaign-replies-index' } });
    if (serializedSnapshot) {
      try {
        await setUiStateValues(
          MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
          { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: serializedSnapshot },
          { source: 'mailbox-campaign-replies', actor: 'Mailbox index' }
        );
      } catch (error) {
        logger.warn('[Mailbox][CampaignSnapshot]', error?.message || error);
      }
    }
    return includeSnapshotMessages ? { ...result, snapshotMessages } : result;
  };
}

module.exports = {
  createMailboxCampaignRepliesList,
};

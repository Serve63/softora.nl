const {
  listMailboxCampaignReplySets,
  mergeCampaignReplies,
} = require('./mailbox-instantly-integration');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('./mailbox-campaign-snapshot');
const { createMailboxCampaignSnapshotRead } = require('./mailbox-campaign-snapshot-read');

function createMailboxCampaignRepliesList({
  mailboxCampaignRepliesService,
  instantlyMailboxService,
  filterVisibleMailboxMessages,
  setUiStateValues,
  getUiStateValues,
  mailboxIndexStore,
  logger,
  normalizeString,
  truncateText,
}) {
  const readCampaignSnapshot = createMailboxCampaignSnapshotRead({ getUiStateValues, mailboxIndexStore, filterVisibleMailboxMessages });
  return async function listCampaignReplies({
    limit = 100,
    owner = '',
    refreshInstantly = false,
    includeSnapshotMessages = false,
    hydrateBodies = true,
    preferSnapshot = false,
    requireSnapshotPersistence = false,
  } = {}) {
    const startedAt = Date.now();
    if (preferSnapshot && !hydrateBodies && !includeSnapshotMessages && !refreshInstantly) {
      const snapshot = await readCampaignSnapshot({ owner, limit });
      if (snapshot) {
        logger.info?.('[Mailbox][CampaignSnapshotTiming]', { totalMs: Date.now() - startedAt, messages: snapshot.messages.length, owner });
        return snapshot;
      }
    }
    const { replies, snapshotBaseReplies } = await listMailboxCampaignReplySets({ mailboxCampaignRepliesService, limit, owner, hydrateBodies, includeSnapshotMessages });
    const indexedAt = Date.now();
    const { messages, snapshotMessages, instantlyReplies, snapshotInstantlyReplies, instantlySync } = await mergeCampaignReplies({ baseReplies: replies, snapshotBaseReplies, instantlyMailboxService, limit, owner, refreshInstantly, filterVisibleMailboxMessages, normalizeString, truncateText, includeSnapshotMessages });
    const mergedAt = Date.now();
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
    // Only the explicit shared rebuild may replace the shared presentation cache.
    // Interactive owner reads return their canonical result without another write.
    const serializedSnapshot = includeSnapshotMessages && serializeMailboxCampaignSnapshot({ ...result, messages: snapshotMessages, sync: { ...result.sync, source: snapshotInstantlyReplies.length ? 'campaign-replies-index+instantly' : 'campaign-replies-index' } });
    if (serializedSnapshot && parseMailboxCampaignSnapshot(serializedSnapshot)?.complete === true) {
      try {
        const saved = await setUiStateValues(
          MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
          { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: serializedSnapshot },
          { source: 'mailbox-campaign-replies', actor: 'Mailbox index' }
        );
        if (requireSnapshotPersistence && saved?.source !== 'supabase') {
          throw new Error('Volledige mailboxweergave kon niet duurzaam worden opgeslagen.');
        }
      } catch (error) {
        logger.warn('[Mailbox][CampaignSnapshot]', error?.message || error);
        if (requireSnapshotPersistence) throw error;
      }
    } else if (requireSnapshotPersistence) {
      throw new Error('Volledige mailboxweergave past niet in het duurzame snapshot.');
    }
    logger.info?.('[Mailbox][CampaignListTiming]', { indexMs: indexedAt - startedAt, providerMs: mergedAt - indexedAt, snapshotMs: Date.now() - mergedAt, totalMs: Date.now() - startedAt, messages: messages.length, hydrateBodies });
    return includeSnapshotMessages ? { ...result, snapshotMessages } : result;
  };
}

module.exports = {
  createMailboxCampaignRepliesList,
};

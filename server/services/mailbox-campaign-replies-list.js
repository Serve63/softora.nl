const { listMailboxCampaignReplySets, mergeCampaignReplies } = require('./mailbox-instantly-integration');
const { createMailboxCampaignSnapshotStore } = require('./mailbox-campaign-snapshot-store');
function createMailboxCampaignRepliesList({
  mailboxCampaignRepliesService,
  instantlyMailboxService,
  filterVisibleMailboxMessages,
  getUiStateValues,
  setUiStateValues,
  logger,
  mailboxCampaignSnapshotStore,
  normalizeString = (value) => String(value || '').trim(),
  truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
} = {}) {
  const snapshotStore = mailboxCampaignSnapshotStore || createMailboxCampaignSnapshotStore({ getUiStateValues, setUiStateValues, logger });
  async function listCampaignReplies({
    limit = 100,
    owner = '',
    refreshInstantly = false,
    includeSnapshotMessages = false,
    hydrateBodies = true,
    persistSnapshot = true,
  } = {}) {
    const requestedOwner = normalizeString(owner).toLowerCase().replace('servé', 'serve');
    if (requestedOwner && !['serve', 'martijn', 'both', 'all'].includes(requestedOwner)) {
      const error = new Error('Onbekende mailbox-eigenaar.');
      error.status = 400;
      throw error;
    }
    const selectedOwner = ['both', 'all'].includes(requestedOwner) ? '' : requestedOwner;
    try {
      const snapshotAt = new Date().toISOString();
      const { replies, snapshotBaseReplies, warnings: indexWarnings } =
        await listMailboxCampaignReplySets({ mailboxCampaignRepliesService, limit, owner: selectedOwner, hydrateBodies });
      const {
        messages,
        snapshotMessages,
        instantlyReplies,
        snapshotInstantlyReplies,
        instantlySync,
        warnings: providerWarnings,
      } = await mergeCampaignReplies({
        baseReplies: replies,
        snapshotBaseReplies,
        instantlyMailboxService,
        limit,
        owner: selectedOwner,
        refreshInstantly,
        filterVisibleMailboxMessages,
        normalizeString,
        truncateText,
      });
      const warnings = [...(indexWarnings || []), ...(providerWarnings || [])];
      const degraded = warnings.length > 0 || instantlySync?.ok === false;
      const result = {
        ok: true,
        savedAt: snapshotAt,
        contentAt: snapshotAt,
        degraded,
        messages,
        sync: {
          indexed: true,
          stale: degraded,
          source: instantlyReplies.length ? 'campaign-replies-index+instantly' : 'campaign-replies-index',
          refreshRecommended: degraded,
          warming: false,
          degraded,
          contentAt: snapshotAt,
          warnings,
          instantly: instantlySync,
        },
      };
      if (persistSnapshot && !degraded) {
        await snapshotStore.persist(
          {
            ...result,
            messages: snapshotMessages,
            sync: {
              ...result.sync,
              source: snapshotInstantlyReplies.length
                ? 'campaign-replies-index+instantly'
                : 'campaign-replies-index',
            },
          },
          { savedAt: snapshotAt, contentAt: snapshotAt }
        );
      }
      return includeSnapshotMessages ? { ...result, snapshotMessages } : result;
    } catch (error) {
      const degraded = Number(error?.status || 500) >= 500
        ? await snapshotStore.readDegraded({ owner: selectedOwner, reason: 'campaign_index_unavailable' })
        : null;
      if (degraded) return degraded;
      throw error;
    }
  }
  return {
    listCampaignReplies,
    invalidateCampaignSnapshot: (options) => snapshotStore.invalidate(options),
  };
}
module.exports = {
  createMailboxCampaignRepliesList,
};

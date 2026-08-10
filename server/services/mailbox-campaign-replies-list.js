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
  mailboxCampaignConsistencyStore,
  compareAndSwapUiStateValues,
  isSupabaseConfigured,
  getSupabaseClient,
  normalizeString = (value) => String(value || '').trim(),
  truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
} = {}) {
  const snapshotStore = mailboxCampaignSnapshotStore || createMailboxCampaignSnapshotStore({
    getUiStateValues,
    setUiStateValues,
    compareAndSwapUiStateValues,
    mailboxCampaignConsistencyStore,
    isSupabaseConfigured,
    getSupabaseClient,
    logger,
  });

  async function readFenceSafely() {
    try {
      return { fence: await snapshotStore.getFence(), error: null };
    } catch (error) {
      logger?.warn?.('[Mailbox][CampaignRepliesFence]', error?.message || error);
      return { fence: null, error };
    }
  }

  function evaluateReadConsistency(before, after) {
    if (before.error || after.error || !before.fence || !after.fence) {
      return { authoritative: false, reason: 'campaign_consistency_unavailable' };
    }
    if (
      before.fence.ready !== true ||
      after.fence.ready !== true ||
      Number(before.fence.pendingCount) > 0 ||
      Number(after.fence.pendingCount) > 0
    ) {
      return { authoritative: false, reason: 'campaign_mutation_pending' };
    }
    if (String(before.fence.contentVersion) !== String(after.fence.contentVersion)) {
      return { authoritative: false, reason: 'content_version_changed_during_read' };
    }
    return { authoritative: true, reason: '' };
  }

  function markResultDegraded(result, reason) {
    const warnings = Array.from(new Set([
      ...(Array.isArray(result?.sync?.warnings) ? result.sync.warnings : []),
      reason,
    ].filter(Boolean)));
    return {
      ...result,
      degraded: true,
      sync: {
        ...(result.sync || {}),
        stale: true,
        refreshRecommended: true,
        degraded: true,
        degradedReason: reason,
        warnings,
      },
    };
  }

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
      const consistencyBefore = await readFenceSafely();
      const snapshotAt = new Date().toISOString();
      const { replies, snapshotBaseReplies, warnings: indexWarnings } =
        await listMailboxCampaignReplySets({ mailboxCampaignRepliesService, limit, owner: selectedOwner, hydrateBodies });
      const {
        messages,
        snapshotMessages,
        instantlyReplies,
        snapshotInstantlyReplies,
        instantlySync,
        snapshotComplete,
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
      const consistencyAfter = await readFenceSafely();
      const consistency = evaluateReadConsistency(consistencyBefore, consistencyAfter);
      const contentVersion = consistencyAfter.fence?.contentVersion ||
        consistencyBefore.fence?.contentVersion || null;
      const warnings = [
        ...(indexWarnings || []),
        ...(providerWarnings || []),
        ...(!consistency.authoritative ? [consistency.reason] : []),
      ];
      const degraded = warnings.length > 0 || instantlySync?.ok === false;
      const degradedReason = degraded
        ? consistency.reason || warnings[0] || 'campaign_reply_read_degraded'
        : null;
      let result = {
        ok: true,
        savedAt: snapshotAt,
        contentAt: snapshotAt,
        contentVersion,
        degraded,
        messages,
        sync: {
          indexed: true,
          stale: degraded,
          source: instantlyReplies.length ? 'campaign-replies-index+instantly' : 'campaign-replies-index',
          refreshRecommended: degraded,
          warming: false,
          degraded,
          degradedReason,
          contentAt: snapshotAt,
          contentVersion,
          warnings,
          snapshotComplete,
          instantly: instantlySync,
          consistency: {
            authoritative: consistency.authoritative,
            reason: consistency.reason || null,
            beforeContentVersion: consistencyBefore.fence?.contentVersion || null,
            currentContentVersion: consistencyAfter.fence?.contentVersion || null,
            pendingCount: Math.max(
              Number(consistencyBefore.fence?.pendingCount) || 0,
              Number(consistencyAfter.fence?.pendingCount) || 0
            ),
          },
        },
      };
      if (persistSnapshot && !degraded && snapshotComplete !== false) {
        const persisted = await snapshotStore.persist(
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
          { savedAt: snapshotAt, contentAt: snapshotAt, contentVersion }
        );
        if (!persisted?.ok) {
          result = markResultDegraded(
            result,
            persisted?.reason || 'campaign_snapshot_persist_failed'
          );
        }
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
    readCampaignSnapshotDegraded: (options) => snapshotStore.readDegraded(options),
  };
}
module.exports = {
  createMailboxCampaignRepliesList,
};

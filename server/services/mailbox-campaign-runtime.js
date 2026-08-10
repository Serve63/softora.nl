const {
  createMailboxCampaignConsistencyStore,
} = require('../repositories/mailbox-campaign-consistency-store');
const { createMailboxCampaignRepliesList } = require('./mailbox-campaign-replies-list');
const {
  createMailboxCampaignMutationRunner,
} = require('./mailbox-campaign-mutation-runner');

function createMailboxCampaignRuntime(deps = {}) {
  const consistencyStore = deps.mailboxCampaignConsistencyStore ||
    createMailboxCampaignConsistencyStore({
      isSupabaseConfigured: deps.isSupabaseConfigured,
      getSupabaseClient: deps.getSupabaseClient,
      logger: deps.logger,
    });
  const mutationRunner = deps.mailboxCampaignMutationRunner ||
    createMailboxCampaignMutationRunner({
      mailboxCampaignConsistencyStore: consistencyStore,
      logger: deps.logger,
    });
  const replies = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: deps.mailboxCampaignRepliesService,
    instantlyMailboxService: deps.instantlyMailboxService,
    filterVisibleMailboxMessages: deps.filterVisibleMailboxMessages,
    getUiStateValues: deps.getUiStateValues,
    setUiStateValues: deps.setUiStateValues,
    compareAndSwapUiStateValues: deps.compareAndSwapUiStateValues,
    isSupabaseConfigured: deps.isSupabaseConfigured,
    getSupabaseClient: deps.getSupabaseClient,
    mailboxCampaignConsistencyStore: consistencyStore,
    mailboxCampaignSnapshotStore: deps.mailboxCampaignSnapshotStore,
    logger: deps.logger,
    normalizeString: deps.normalizeString,
    truncateText: deps.truncateText,
  });
  return {
    ...replies,
    syncOptions: {
      campaignMutationRunner: mutationRunner,
      requireCampaignMutationJournal:
        deps.requireCampaignMutationJournal ?? deps.isSupabaseConfigured?.() === true,
      campaignMutationLeaseSeconds: deps.mailboxCampaignMutationLeaseSeconds,
      campaignMutationDeadlineMs: deps.mailboxCampaignMutationDeadlineMs,
    },
  };
}

module.exports = { createMailboxCampaignRuntime };

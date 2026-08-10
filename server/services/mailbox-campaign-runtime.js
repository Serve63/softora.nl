const {
  createMailboxCampaignConsistencyStore,
} = require('../repositories/mailbox-campaign-consistency-store');
const { createMailboxCampaignRepliesList } = require('./mailbox-campaign-replies-list');

function createMailboxCampaignRuntime(deps = {}) {
  const consistencyStore = deps.mailboxCampaignConsistencyStore ||
    createMailboxCampaignConsistencyStore({
      isSupabaseConfigured: deps.isSupabaseConfigured,
      getSupabaseClient: deps.getSupabaseClient,
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
  return replies;
}

module.exports = { createMailboxCampaignRuntime };

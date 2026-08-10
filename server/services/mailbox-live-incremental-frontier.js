const {
  resolveMailboxSyncUids,
} = require('./mailbox-campaign-history-sync');
const { normalizeMailboxUidValidity } = require('./mailbox-uid-validity');

async function resolveMailboxImapUidSelection({
  client,
  limit,
  campaignHistory = false,
  oldestIndexedCampaignUid = 0,
  incrementalAfterUid = 0,
  incrementalUidValidity = 0,
  liveUidValidity = 0,
  historySyncOptions = {},
  logger = console,
  accountEmail = '',
  folder = 'inbox',
} = {}) {
  const requestedAfterUid = Math.max(0, Number(incrementalAfterUid) || 0);
  const expectedUidValidity = normalizeMailboxUidValidity(incrementalUidValidity);
  const currentUidValidity = normalizeMailboxUidValidity(liveUidValidity);
  const safeIncrementalAfterUid =
    requestedAfterUid > 0 &&
    expectedUidValidity > 0 &&
    expectedUidValidity === currentUidValidity
      ? requestedAfterUid
      : 0;
  const selectedUids = await resolveMailboxSyncUids({
    client,
    limit,
    campaignHistory,
    oldestIndexedCampaignUid,
    incrementalAfterUid: safeIncrementalAfterUid,
    ...(historySyncOptions && typeof historySyncOptions === 'object' ? historySyncOptions : {}),
    logger,
    accountEmail,
    folder,
  });
  if (requestedAfterUid > 0) {
    Object.defineProperty(selectedUids, 'syncSelectionHealth', {
      configurable: true,
      value: Object.freeze({
        ...(selectedUids.syncSelectionHealth || {}),
        incrementalFrontierRequested: true,
        incrementalFrontierUidValidityMatched: safeIncrementalAfterUid > 0,
      }),
    });
  }
  return selectedUids;
}

module.exports = { resolveMailboxImapUidSelection };

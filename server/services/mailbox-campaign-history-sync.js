const CAMPAIGN_HISTORY_SINCE = new Date('2026-05-01T00:00:00.000Z');
const CAMPAIGN_HISTORY_SUBJECT_TERMS = Object.freeze([
  'Kleine vraag over jullie website',
  'Nieuw webdesign',
]);
const THREAD_REFERENCE_SEARCH_BATCH_SIZE = 15;
const TARGETED_THREAD_HISTORY_LIMIT = 100;

function normalizeUidList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(Number)
        .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
    )
  ).sort((left, right) => left - right);
}

function normalizeMessageIdList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

async function searchThreadReplyUids({
  client,
  threadReferenceIds = [],
  threadRecipientTerms = [],
  logger = console,
  accountEmail = '',
  folder = '',
} = {}) {
  const referenceIds = normalizeMessageIdList(threadReferenceIds);
  const recipientTerms = normalizeMessageIdList(threadRecipientTerms);
  const replyUids = [];
  for (let offset = 0; offset < referenceIds.length; offset += THREAD_REFERENCE_SEARCH_BATCH_SIZE) {
    const batch = referenceIds.slice(offset, offset + THREAD_REFERENCE_SEARCH_BATCH_SIZE);
    const alternatives = batch.flatMap((messageId) => [
      { header: { references: messageId } },
      { header: { 'in-reply-to': messageId } },
    ]);
    try {
      const found = await client.search(
        {
          since: CAMPAIGN_HISTORY_SINCE,
          or: alternatives,
        },
        { uid: true }
      );
      replyUids.push(...(Array.isArray(found) ? found : []));
    } catch (error) {
      logger.warn?.(
        '[Mailbox][ThreadReplySearch]',
        accountEmail,
        folder,
        `batch-${offset / THREAD_REFERENCE_SEARCH_BATCH_SIZE + 1}`,
        error?.message || error
      );
    }
  }
  for (let offset = 0; offset < recipientTerms.length; offset += THREAD_REFERENCE_SEARCH_BATCH_SIZE) {
    const batch = recipientTerms.slice(offset, offset + THREAD_REFERENCE_SEARCH_BATCH_SIZE);
    const alternatives = batch.map((term) => ({ to: term }));
    const query =
      alternatives.length === 1
        ? {
            since: CAMPAIGN_HISTORY_SINCE,
            ...alternatives[0],
          }
        : {
            since: CAMPAIGN_HISTORY_SINCE,
            or: alternatives,
          };
    try {
      const found = await client.search(query, { uid: true });
      replyUids.push(...(Array.isArray(found) ? found : []));
    } catch (error) {
      logger.warn?.(
        '[Mailbox][ThreadRecipientSearch]',
        accountEmail,
        folder,
        `batch-${offset / THREAD_REFERENCE_SEARCH_BATCH_SIZE + 1}`,
        error?.message || error
      );
    }
  }
  return normalizeUidList(replyUids);
}

function selectMailboxSyncUids({
  allUids,
  campaignUids = [],
  priorityUids = [],
  indexedUids = [],
  oldestIndexedCampaignUid = 0,
  incrementalAfterUid = 0,
  limit = 50,
} = {}) {
  const safeLimit = Math.max(1, Number(limit) || 50);
  const normalizedAll = normalizeUidList(allUids);
  const normalizedCampaign = normalizeUidList(campaignUids);
  const indexedUidSet = new Set(normalizeUidList(indexedUids));
  const missingPriorityUids = normalizeUidList(priorityUids)
    .filter((uid) => !indexedUidSet.has(uid))
    .slice(-TARGETED_THREAD_HISTORY_LIMIT)
    .reverse();
  const unindexedAll = normalizedAll.filter((uid) => !indexedUidSet.has(uid));
  const unindexedCampaign = normalizedCampaign.filter((uid) => !indexedUidSet.has(uid));
  const attachSelectionHealth = (selectedUids, overrides = {}) => {
    const selected = Array.isArray(selectedUids) ? selectedUids : [];
    const selectedSet = new Set(selected);
    const remainingUidCount = Object.prototype.hasOwnProperty.call(overrides, 'remainingUidCount')
      ? Math.max(0, Number(overrides.remainingUidCount) || 0)
      : unindexedAll.filter((uid) => !selectedSet.has(uid)).length;
    Object.defineProperty(selected, 'syncSelectionHealth', {
      configurable: true,
      value: Object.freeze({
        providerUidCount: normalizedAll.length,
        indexedUidCount: indexedUidSet.size,
        unindexedUidCount: unindexedAll.length,
        remainingUidCount,
        truncated: remainingUidCount > 0,
        ...overrides,
      }),
    });
    return selected;
  };
  const frontierAfterUid = Math.max(0, Number(incrementalAfterUid) || 0);
  if (frontierAfterUid > 0) {
    // A live refresh only has to drain the monotonic provider frontier. Old
    // gaps below the last proven UID belong to the separate history backfill;
    // treating them as new mail kept large Gmail inboxes permanently stale.
    const frontierUids = normalizedAll.filter(
      (uid) => uid > frontierAfterUid && !indexedUidSet.has(uid)
    );
    const selected = [];
    const seen = new Set();
    const addUid = (uid) => {
      if (!uid || seen.has(uid) || selected.length >= safeLimit) return;
      seen.add(uid);
      selected.push(uid);
    };
    // Oldest first makes every bounded batch contiguous. If a provider fetch
    // is partial, the next run can continue without jumping over an unseen UID.
    frontierUids.forEach(addUid);
    missingPriorityUids.forEach(addUid);
    const remainingFrontierCount = frontierUids.filter((uid) => !seen.has(uid)).length;
    const remainingPriorityCount = missingPriorityUids.filter((uid) => !seen.has(uid)).length;
    const providerNewestUid = normalizedAll.reduce(
      (maximum, uid) => Math.max(maximum, uid), frontierAfterUid
    );
    return attachSelectionHealth(selected, {
      frontierMode: true,
      frontierAfterUid,
      frontierProviderNewestUid: providerNewestUid,
      remainingFrontierCount,
      remainingPriorityCount,
      remainingUidCount: remainingFrontierCount + remainingPriorityCount,
    });
  }
  if (!unindexedCampaign.length && !missingPriorityUids.length) {
    return attachSelectionHealth(unindexedAll.slice(-safeLimit).reverse());
  }

  const beforeUid = Number(oldestIndexedCampaignUid) || Number.POSITIVE_INFINITY;
  const olderCampaignUids = unindexedCampaign.filter((uid) => uid < beforeUid);

  const recentCount = Math.max(1, Math.ceil(safeLimit / 3));
  const selected = [];
  const seen = new Set();
  const addUid = (uid) => {
    if (!uid || seen.has(uid) || selected.length >= safeLimit) return;
    seen.add(uid);
    selected.push(uid);
  };
  unindexedAll.slice(-recentCount).reverse().forEach(addUid);
  missingPriorityUids.forEach(addUid);
  olderCampaignUids.slice().reverse().forEach(addUid);
  unindexedAll.slice().reverse().forEach(addUid);
  return attachSelectionHealth(selected);
}

async function resolveMailboxSyncUids({
  client,
  limit,
  campaignHistory = false,
  incrementalAfterUid = 0,
  oldestIndexedCampaignUid = 0,
  threadReferenceIds = [],
  threadRecipientTerms = [],
  priorityUids = [],
  indexedUids = [],
  logger = console,
  accountEmail = '',
  folder = '',
} = {}) {
  const frontierAfterUid = Math.max(0, Number(incrementalAfterUid) || 0);
  const allUids = await client.search(
    frontierAfterUid > 0 ? { uid: `${frontierAfterUid + 1}:*` } : { all: true },
    { uid: true }
  );
  if (!campaignHistory) {
    return selectMailboxSyncUids({
      allUids,
      priorityUids,
      indexedUids,
      incrementalAfterUid: frontierAfterUid,
      limit,
    });
  }

  const campaignUids = [];
  for (const subject of CAMPAIGN_HISTORY_SUBJECT_TERMS) {
    try {
      const found = await client.search(
        {
          since: CAMPAIGN_HISTORY_SINCE,
          subject,
        },
        { uid: true }
      );
      campaignUids.push(...(Array.isArray(found) ? found : []));
    } catch (error) {
      logger.warn?.(
        '[Mailbox][CampaignHistorySearch]',
        accountEmail,
        folder,
        subject,
        error?.message || error
      );
    }
  }
  const threadReplyUids = await searchThreadReplyUids({
    client,
    threadReferenceIds,
    threadRecipientTerms,
    logger,
    accountEmail,
    folder,
  });
  return selectMailboxSyncUids({
    allUids,
    campaignUids,
    priorityUids: [...normalizeUidList(priorityUids), ...threadReplyUids],
    indexedUids,
    oldestIndexedCampaignUid,
    limit,
  });
}

module.exports = {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
  TARGETED_THREAD_HISTORY_LIMIT,
  THREAD_REFERENCE_SEARCH_BATCH_SIZE,
  normalizeMessageIdList,
  normalizeUidList,
  resolveMailboxSyncUids,
  searchThreadReplyUids,
  selectMailboxSyncUids,
};

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
  limit = 50,
} = {}) {
  const safeLimit = Math.max(1, Number(limit) || 50);
  const normalizedAll = normalizeUidList(allUids);
  const normalizedCampaign = normalizeUidList(campaignUids);
  const indexedUidSet = new Set(normalizeUidList(indexedUids));
  const missingPriorityUids = normalizeUidList(priorityUids)
    .filter((uid) => !indexedUidSet.has(uid))
    .slice(0, TARGETED_THREAD_HISTORY_LIMIT);
  if (!normalizedCampaign.length && !missingPriorityUids.length) {
    return normalizedAll.slice(-safeLimit).reverse();
  }

  const beforeUid = Number(oldestIndexedCampaignUid) || Number.POSITIVE_INFINITY;
  const olderCampaignUids = normalizedCampaign.filter((uid) => uid < beforeUid);

  const recentCount = Math.max(1, Math.ceil(safeLimit / 3));
  const effectiveLimit = Math.max(safeLimit, recentCount + missingPriorityUids.length);
  const selected = [];
  const seen = new Set();
  const addUid = (uid) => {
    if (!uid || seen.has(uid) || selected.length >= effectiveLimit) return;
    seen.add(uid);
    selected.push(uid);
  };
  normalizedAll.slice(-recentCount).reverse().forEach(addUid);
  missingPriorityUids.forEach(addUid);
  olderCampaignUids.slice().reverse().forEach(addUid);
  normalizedAll.slice().reverse().forEach(addUid);
  return selected;
}

async function resolveMailboxSyncUids({
  client,
  limit,
  campaignHistory = false,
  oldestIndexedCampaignUid = 0,
  threadReferenceIds = [],
  threadRecipientTerms = [],
  indexedUids = [],
  logger = console,
  accountEmail = '',
  folder = '',
} = {}) {
  const allUids = await client.search({ all: true }, { uid: true });
  if (!campaignHistory) return selectMailboxSyncUids({ allUids, limit });

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
    priorityUids: threadReplyUids,
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

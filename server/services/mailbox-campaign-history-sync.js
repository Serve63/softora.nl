const CAMPAIGN_HISTORY_SINCE = new Date('2026-05-01T00:00:00.000Z');
const CAMPAIGN_HISTORY_SUBJECT_TERMS = Object.freeze([
  'Kleine vraag over jullie website',
  'Nieuw webdesign',
]);

function normalizeUidList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(Number)
        .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
    )
  ).sort((left, right) => left - right);
}

function selectMailboxSyncUids({
  allUids,
  campaignUids = [],
  oldestIndexedCampaignUid = 0,
  limit = 50,
} = {}) {
  const safeLimit = Math.max(1, Number(limit) || 50);
  const normalizedAll = normalizeUidList(allUids);
  const normalizedCampaign = normalizeUidList(campaignUids);
  if (!normalizedCampaign.length) return normalizedAll.slice(-safeLimit).reverse();

  const beforeUid = Number(oldestIndexedCampaignUid) || Number.POSITIVE_INFINITY;
  const olderCampaignUids = normalizedCampaign.filter((uid) => uid < beforeUid);
  if (!olderCampaignUids.length) return normalizedAll.slice(-safeLimit).reverse();

  const recentCount = Math.max(1, Math.ceil(safeLimit / 3));
  const historyCount = Math.max(1, safeLimit - recentCount);
  const selected = [];
  const seen = new Set();
  const addUid = (uid) => {
    if (!uid || seen.has(uid) || selected.length >= safeLimit) return;
    seen.add(uid);
    selected.push(uid);
  };
  normalizedAll.slice(-recentCount).reverse().forEach(addUid);
  olderCampaignUids.slice(-historyCount).reverse().forEach(addUid);
  normalizedAll.slice().reverse().forEach(addUid);
  return selected;
}

async function resolveMailboxSyncUids({
  client,
  limit,
  campaignHistory = false,
  oldestIndexedCampaignUid = 0,
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
  return selectMailboxSyncUids({
    allUids,
    campaignUids,
    oldestIndexedCampaignUid,
    limit,
  });
}

module.exports = {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
  normalizeUidList,
  resolveMailboxSyncUids,
  selectMailboxSyncUids,
};

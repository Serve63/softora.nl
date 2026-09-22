const BOUNCE_MODEL = 'complete-mailbox-recipient-v2';
const SENT_COUNT_MODEL = 'outbound-direction-v1';
function preserveReliableBounceStats(payload, previousPayload) {
  const stats = payload && payload.stats || {};
  const previous = previousPayload && previousPayload.stats || {};
  const reliable = (value) => value.bounceStatsModel === BOUNCE_MODEL && value.bounceStatsReliable === true;
  if (reliable(stats) || !reliable(previous)) return payload;
  const merged = { ...stats };
  ['bounces', 'totalBounces', 'bounceStatsSource', 'bounceStatsReliable', 'bounceDeduplication',
    'bounceStatsModel', 'bounceStatsUpdatedAt', 'bounceTypes', 'bounceItems', 'mailboxBounces',
    'mailboxBounceMessages', 'mailboxBounceMatchedMessages', 'mailboxBounceUnresolvedMessages',
    'mailboxBounceDuplicateNotices'].forEach((key) => { merged[key] = previous[key]; });
  if (stats.dateKey === previous.dateKey) {
    ['bouncesToday', 'todayBounces', 'bounceTypesToday', 'bounceItemsToday', 'mailboxBouncesToday']
      .forEach((key) => { merged[key] = previous[key]; });
  }
  return { ...payload, stats: { ...merged, bounceStatsStale: true } };
}

function isReliableLiveTotals(payload, expectedDateKey) {
  const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
  return stats.reliable === true &&
    String(stats.dateKey || '').trim() === expectedDateKey &&
    Number.isFinite(Number(stats.systemTotalSent ?? stats.totalSent));
}

function preserveReliableColdmailLiveStats(payload, previousPayload, expectedDateKey) {
  payload = preserveReliableBounceStats(payload, previousPayload);
  const currentStats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
  const previousStats = previousPayload && previousPayload.stats && typeof previousPayload.stats === 'object'
    ? previousPayload.stats
    : {};
  const previousInstantlyReliable = previousStats.instantlyStatsReliable === true &&
    String(previousStats.dateKey || '').trim() === expectedDateKey &&
    Number.isFinite(Number(previousStats.instantlySentToday));
  const currentInstantlyReliable = currentStats.instantlyStatsReliable === true &&
    String(currentStats.dateKey || '').trim() === expectedDateKey &&
    Number.isFinite(Number(currentStats.instantlySentToday));
  if (previousInstantlyReliable && !currentInstantlyReliable) {
    payload = {
      ...payload,
      stats: {
        ...currentStats,
        instantlySentToday: previousStats.instantlySentToday,
        instantlyTotalSent: previousStats.instantlyTotalSent,
        instantlyStatsReliable: true,
        instantlyStatsStale: true,
        instantlyStatsUnavailableReason:
          currentStats.instantlyStatsUnavailableReason || 'incomplete_live_response',
        instantlyStatsUpdatedAt:
          previousStats.instantlyStatsUpdatedAt || previousStats.updatedAt || '',
      },
    };
  }
  if (!isReliableLiveTotals(previousPayload, expectedDateKey)) return payload;
  const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
  const previous = previousPayload.stats;
  // A complete, direction-verified register can intentionally correct an older inflated cache.
  if (isReliableLiveTotals(payload, expectedDateKey) && stats.sentCountModel === SENT_COUNT_MODEL &&
      previous.sentCountModel !== SENT_COUNT_MODEL && stats.authoritativeSource === 'central-outbound-recipient-guard') return payload;
  const mergedStats = { ...stats };
  let changed = false;
  const cumulativeFields = [
    'sentToday',
    'systemSentToday',
    'centralGuardSentToday',
    'systemTotalSent',
    'centralGuardTotalSent',
    'totalSent',
    'webdesignTotalSent',
    'webdesignSentToday',
    'lastSuccessfulSendAt',
    'lastSenderEmail',
  ];
  const previousTotal = Number(previous.systemTotalSent ?? previous.totalSent);
  const currentTotal = Number(stats.systemTotalSent ?? stats.totalSent);
  const currentReliable = isReliableLiveTotals(payload, expectedDateKey);
  const currentReliableTotalRegressed = currentReliable &&
    Number.isFinite(previousTotal) && Number.isFinite(currentTotal) && currentTotal < previousTotal;
  const timestampModelChanged = currentReliable &&
    String(stats.sentTimestampModel || '').trim() &&
    String(stats.sentTimestampModel || '').trim() !== String(previous.sentTimestampModel || '').trim();
  if (currentReliableTotalRegressed || !isReliableLiveTotals(payload, expectedDateKey)) {
    cumulativeFields.filter((field) => !timestampModelChanged || ![
      'sentToday',
      'systemSentToday',
      'centralGuardSentToday',
      'webdesignSentToday',
      'lastSuccessfulSendAt',
      'lastSenderEmail',
    ].includes(field)).forEach((field) => {
      mergedStats[field] = previous[field];
    });
    mergedStats.reliable = true;
    mergedStats.sentCountModel = previous.sentCountModel;
    mergedStats.source = previous.source;
    mergedStats.authoritativeSource = previous.authoritativeSource;
    mergedStats.authoritativeStatsStale = true;
    mergedStats.authoritativeStatsStaleReason = currentReliableTotalRegressed
      ? 'cumulative_total_regressed'
      : 'incomplete_live_response';
    mergedStats.authoritativeStatsUpdatedAt = previous.authoritativeStatsUpdatedAt || previous.updatedAt || '';
    changed = true;
  }
  return changed ? { ...payload, stats: mergedStats } : payload;
}

module.exports = { SENT_COUNT_MODEL, preserveReliableColdmailLiveStats, preserveReliableBounceStats };

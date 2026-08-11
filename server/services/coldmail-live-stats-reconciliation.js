function isReliableLiveTotals(payload, expectedDateKey) {
  const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
  return stats.reliable === true &&
    String(stats.dateKey || '').trim() === expectedDateKey &&
    Number.isFinite(Number(stats.systemTotalSent ?? stats.totalSent));
}

function preserveReliableColdmailLiveStats(payload, previousPayload, expectedDateKey) {
  if (!isReliableLiveTotals(previousPayload, expectedDateKey)) return payload;
  const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
  const previous = previousPayload.stats;
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
  const currentReliableTotalRegressed = isReliableLiveTotals(payload, expectedDateKey) &&
    Number.isFinite(previousTotal) && Number.isFinite(currentTotal) && currentTotal < previousTotal;
  if (currentReliableTotalRegressed || !isReliableLiveTotals(payload, expectedDateKey)) {
    cumulativeFields.forEach((field) => {
      mergedStats[field] = previous[field];
    });
    mergedStats.reliable = true;
    mergedStats.source = previous.source;
    mergedStats.authoritativeSource = previous.authoritativeSource;
    mergedStats.authoritativeStatsStale = true;
    mergedStats.authoritativeStatsStaleReason = currentReliableTotalRegressed
      ? 'cumulative_total_regressed'
      : 'incomplete_live_response';
    mergedStats.authoritativeStatsUpdatedAt = previous.authoritativeStatsUpdatedAt || previous.updatedAt || '';
    changed = true;
  }
  if (
    (stats.mailboxBounceStatsAvailable === false || stats.bounceStatsReliable === false) &&
    previous.mailboxBounceStatsAvailable !== false &&
    previous.bounceStatsReliable !== false
  ) {
    [
      'bounces',
      'totalBounces',
      'bounceStatsSource',
      'bounceStatsReliable',
      'bounceDeduplication',
      'mailboxBounces',
      'mailboxBouncesToday',
      'mailboxBounceMessages',
      'mailboxBounceMatchedMessages',
      'mailboxBounceUnresolvedMessages',
      'mailboxBounceDuplicateNotices',
      'mailboxBounceStatsAvailable',
      'mailboxBounceStatsUnavailableReason',
      'bounceTypes',
      'bounceItems',
      'bouncesToday',
      'todayBounces',
      'bounceTypesToday',
      'bounceItemsToday',
    ].forEach((field) => {
      mergedStats[field] = previous[field];
    });
    changed = true;
  }
  return changed ? { ...payload, stats: mergedStats } : payload;
}

module.exports = { preserveReliableColdmailLiveStats };

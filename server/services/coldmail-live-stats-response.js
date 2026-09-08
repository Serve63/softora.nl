const { COLDMAIL_SENT_TIMESTAMP_MODEL } = require('./coldmail-guard-sent-at');

// Only a proven snapshot for this Amsterdam day may bridge a slow refresh.
// Keep its original timestamp: serving it never makes the observation newer.
async function resolveColdmailStatsResponse(refresh, cached, dateKey, timeoutMs = 700) {
  const stats = cached && cached.stats;
  const usable = cached && cached.ok === true && stats && stats.reliable === true &&
    stats.dateKey === dateKey && stats.sentTimestampModel === COLDMAIL_SENT_TIMESTAMP_MODEL &&
    stats.authoritativeSource === 'central-outbound-recipient-guard' &&
    Number.isFinite(Date.parse(stats.updatedAt)) &&
    Number.isFinite(stats.systemTotalSent) && Number.isFinite(stats.systemSentToday);
  if (!usable) return refresh;
  const fallback = () => ({ ...cached, stats: {
    ...stats,
    authoritativeStatsStale: true,
    authoritativeStatsStaleReason: 'refresh_pending',
    authoritativeStatsUpdatedAt: stats.authoritativeStatsUpdatedAt || stats.updatedAt,
  } });
  let timer;
  try {
    return await Promise.race([
      refresh.catch(fallback),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolveColdmailStatsResponse };

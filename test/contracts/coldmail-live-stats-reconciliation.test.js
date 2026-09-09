const assert = require('node:assert/strict');
const test = require('node:test');

const {
  preserveReliableColdmailLiveStats,
} = require('../../server/services/coldmail-live-stats-reconciliation');

test('coldmail reconciliation preserves all-time totals but not a corrected timestamp-model day count', () => {
  const previous = {
    ok: true,
    stats: {
      reliable: true,
      dateKey: '2026-08-17',
      sentToday: 203,
      systemSentToday: 203,
      centralGuardSentToday: 203,
      webdesignSentToday: 203,
      systemTotalSent: 2565,
      centralGuardTotalSent: 2565,
      totalSent: 2565,
      webdesignTotalSent: 2565,
      lastSuccessfulSendAt: '2026-08-17T10:30:02.000Z',
      lastSenderEmail: 'historical@example.test',
    },
  };
  const corrected = {
    ok: true,
    stats: {
      reliable: true,
      dateKey: '2026-08-17',
      sentTimestampModel: 'delivery-evidence-v1',
      sentToday: 11,
      systemSentToday: 11,
      centralGuardSentToday: 11,
      webdesignSentToday: 11,
      systemTotalSent: 2500,
      centralGuardTotalSent: 2500,
      totalSent: 2500,
      webdesignTotalSent: 2500,
      lastSuccessfulSendAt: '2026-08-17T10:34:02.869Z',
      lastSenderEmail: 'serve@softora.nl',
    },
  };

  const result = preserveReliableColdmailLiveStats(corrected, previous, '2026-08-17');

  assert.equal(result.stats.systemTotalSent, 2565);
  assert.equal(result.stats.centralGuardTotalSent, 2565);
  assert.equal(result.stats.systemSentToday, 11);
  assert.equal(result.stats.centralGuardSentToday, 11);
  assert.equal(result.stats.lastSuccessfulSendAt, '2026-08-17T10:34:02.869Z');
  assert.equal(result.stats.lastSenderEmail, 'serve@softora.nl');
  assert.equal(result.stats.sentTimestampModel, 'delivery-evidence-v1');
  assert.equal(result.stats.authoritativeStatsStale, true);
  assert.equal(result.stats.authoritativeStatsStaleReason, 'cumulative_total_regressed');
});

test('bounce fallback is independent of sent statistics and survives the Amsterdam day boundary', () => {
  const previous = { stats: { dateKey: '2026-09-08', reliable: false, bounceStatsReliable: true, bounceStatsModel: 'complete-mailbox-recipient-v2', bounceStatsUpdatedAt: '2026-09-08T21:59:00Z', bounceTypes: { hard: 42 }, bouncesToday: 5 } };
  const fresh = { stats: { dateKey: '2026-09-09', reliable: true, systemTotalSent: 3582, bounceStatsReliable: false, bounceTypes: { hard: 38 }, bouncesToday: 0 } };
  const result = preserveReliableColdmailLiveStats(fresh, previous, '2026-09-09');
  assert.equal(result.stats.bounceTypes.hard, 42);
  assert.equal(result.stats.bouncesToday, 0);
  assert.equal(result.stats.bounceStatsUpdatedAt, previous.stats.bounceStatsUpdatedAt);
  assert.equal(result.stats.bounceStatsStale, true);
  assert.equal(result.stats.systemTotalSent, 3582);
  const corrected = { stats: { ...fresh.stats, bounceStatsReliable: true, bounceStatsModel: 'complete-mailbox-recipient-v2', bounceStatsUpdatedAt: '2026-09-08T22:01:00Z', bounceTypes: { hard: 41 } } };
  assert.equal(preserveReliableColdmailLiveStats(corrected, result, '2026-09-09').stats.bounceTypes.hard, 41);
});

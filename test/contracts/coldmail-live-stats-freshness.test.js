const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mergeMonotonicCurrentDayStats,
} = require('../../server/services/coldmail-live-stats-freshness');

test('coldmail current-day stats replace a stale zero and lift durable totals monotonically', () => {
  const staleBootstrap = {
    ok: true,
    stats: {
      reliable: true,
      dateKey: '2026-08-04',
      sentToday: 0,
      systemSentToday: 0,
      centralGuardSentToday: 0,
      webdesignSentToday: 0,
      totalSent: 1543,
      systemTotalSent: 1543,
      centralGuardTotalSent: 1543,
      webdesignTotalSent: 1543,
      updatedAt: '2026-08-04T06:00:00.000Z',
    },
  };

  const merged = mergeMonotonicCurrentDayStats(staleBootstrap, {
    stats: {
      reliable: true,
      dateKey: '2026-08-04',
      centralGuardSentToday: 11,
      lastSuccessfulSendAt: '2026-08-04T14:53:00.000Z',
      lastSenderEmail: 'martijn@softora.nl',
    },
  }, '2026-08-04T15:00:00.000Z');

  assert.equal(merged.stats.sentToday, 11);
  assert.equal(merged.stats.systemSentToday, 11);
  assert.equal(merged.stats.centralGuardSentToday, 11);
  assert.equal(merged.stats.webdesignSentToday, 11);
  assert.equal(merged.stats.totalSent, 1554);
  assert.equal(merged.stats.systemTotalSent, 1554);
  assert.equal(merged.stats.centralGuardTotalSent, 1554);
  assert.equal(merged.stats.webdesignTotalSent, 1554);
  assert.equal(merged.stats.lastSuccessfulSendAt, '2026-08-04T14:53:00.000Z');
  assert.equal(merged.stats.lastSenderEmail, 'martijn@softora.nl');
  assert.equal(merged.stats.updatedAt, '2026-08-04T15:00:00.000Z');
});

test('coldmail current-day counts never regress or double-increment after an older serverless response', () => {
  const current = {
    ok: true,
    stats: {
      reliable: true,
      dateKey: '2026-08-04',
      sentToday: 11,
      centralGuardSentToday: 11,
      totalSent: 1554,
      updatedAt: '2026-08-04T15:00:00.000Z',
    },
  };

  const merged = mergeMonotonicCurrentDayStats(current, {
    stats: {
      reliable: true,
      dateKey: '2026-08-04',
      centralGuardSentToday: 10,
      lastSuccessfulSendAt: '2026-08-04T14:45:00.000Z',
    },
  }, '2026-08-04T15:01:00.000Z');

  assert.equal(merged.stats.sentToday, 11);
  assert.equal(merged.stats.totalSent, 1554);
});

test('coldmail current-day stats ignore unreliable or different-day data', () => {
  const current = {
    ok: true,
    stats: {
      reliable: true,
      dateKey: '2026-08-04',
      sentToday: 11,
      totalSent: 1554,
    },
  };

  assert.equal(mergeMonotonicCurrentDayStats(current, {
    stats: { reliable: false, dateKey: '2026-08-04', centralGuardSentToday: 12 },
  }), current);
  assert.equal(mergeMonotonicCurrentDayStats(current, {
    stats: { reliable: true, dateKey: '2026-08-03', centralGuardSentToday: 12 },
  }), current);
});

test('coldmail current-day stats correct an older timestamp model without lowering all-time totals', () => {
  const incorrectBackfillCache = {
    ok: true,
    stats: {
      reliable: true,
      dateKey: '2026-08-17',
      sentToday: 203,
      systemSentToday: 203,
      centralGuardSentToday: 203,
      webdesignSentToday: 203,
      totalSent: 2565,
      systemTotalSent: 2565,
      centralGuardTotalSent: 2565,
      webdesignTotalSent: 2565,
      lastSuccessfulSendAt: '2026-08-17T10:45:00.000Z',
      lastSenderEmail: 'historical-backfill@example.test',
      updatedAt: '2026-08-17T10:44:11.000Z',
    },
  };

  const merged = mergeMonotonicCurrentDayStats(incorrectBackfillCache, {
    stats: {
      reliable: true,
      dateKey: '2026-08-17',
      sentTimestampModel: 'delivery-evidence-v1',
      centralGuardSentToday: 11,
      lastSuccessfulSendAt: '2026-08-17T10:34:02.869Z',
      lastSenderEmail: 'serve@softora.nl',
    },
  }, '2026-08-17T10:46:55.000Z');

  assert.equal(merged.stats.sentToday, 11);
  assert.equal(merged.stats.systemSentToday, 11);
  assert.equal(merged.stats.centralGuardSentToday, 11);
  assert.equal(merged.stats.webdesignSentToday, 11);
  assert.equal(merged.stats.systemTotalSent, 2565);
  assert.equal(merged.stats.sentTimestampModel, 'delivery-evidence-v1');
  assert.equal(merged.stats.lastSuccessfulSendAt, '2026-08-17T10:34:02.869Z');
  assert.equal(merged.stats.lastSenderEmail, 'serve@softora.nl');
});

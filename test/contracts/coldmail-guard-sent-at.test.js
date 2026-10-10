const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COLDMAIL_SENT_TIMESTAMP_MODEL,
  getLatestPayloadEventTimestamp,
  resolveColdmailGuardSentAt,
} = require('../../server/services/coldmail-guard-sent-at');

test('coldmail guard sent timestamp model prefers immutable delivery evidence over mutation time', () => {
  assert.equal(COLDMAIL_SENT_TIMESTAMP_MODEL, 'delivery-evidence-v2');
  assert.equal(resolveColdmailGuardSentAt({
    payload: { sentAt: '2026-08-17T08:00:00.000Z' },
    last_seen_at: '2026-08-17T08:01:00.000Z',
    created_at: '2026-08-17T10:30:03.000Z',
    updated_at: '2026-08-17T10:30:02.000Z',
  }), '2026-08-17T08:00:00.000Z');
});

test('coldmail guard sent timestamp model uses historical last-seen time before insert or update time', () => {
  assert.equal(resolveColdmailGuardSentAt({
    payload: { events: [{ at: '2024-03-18T09:00:00.000Z' }] },
    last_seen_at: '2024-03-18T09:00:00.000Z',
    created_at: '2026-08-17T10:30:03.000Z',
    updated_at: '2026-08-17T10:30:02.000Z',
  }), '2024-03-18T09:00:00.000Z');
});

test('coldmail guard sent timestamp model uses stable creation time before mutable update fallback', () => {
  assert.equal(resolveColdmailGuardSentAt({
    created_at: '2026-08-16T09:00:00.000Z',
    updated_at: '2026-08-17T10:30:02.000Z',
  }), '2026-08-16T09:00:00.000Z');
  assert.equal(resolveColdmailGuardSentAt({
    updated_at: '2026-08-17T10:30:02.000Z',
  }), '2026-08-17T10:30:02.000Z');
});

test('coldmail guard sent timestamp model selects the latest valid historical payload event', () => {
  assert.equal(getLatestPayloadEventTimestamp({
    events: [
      { at: 'invalid' },
      { at: '2024-03-18T09:00:00.000Z' },
      { sentAt: '2026-08-17T08:33:07.000Z' },
    ],
  }), '2026-08-17T08:33:07.000Z');
});

test('coldmail guard sent timestamp model ignores suppression mutations as send time', () => {
  const suppressedAt = '2026-10-10T21:06:11.173445+00:00';
  assert.equal(resolveColdmailGuardSentAt({
    payload: { sectorSuppression: { at: suppressedAt } },
    last_seen_at: '2026-10-10 21:06:11.173445+00',
    created_at: '2026-09-30T09:00:00.000Z',
    updated_at: '2026-10-10 21:06:11.173445+00',
  }), '2026-09-30T09:00:00.000Z');
  assert.equal(resolveColdmailGuardSentAt({
    suppressed_at: '2026-10-10T21:06:11.000Z',
    last_seen_at: '2026-10-10T21:06:11.000Z',
    created_at: '2026-09-30T09:00:00.000Z',
  }), '2026-09-30T09:00:00.000Z');
  assert.equal(resolveColdmailGuardSentAt({
    payload: { sectorSuppression: { at: suppressedAt } },
    last_seen_at: '2026-10-10T05:18:19.140Z',
    created_at: '2026-10-09T15:00:28.000Z',
  }), '2026-10-10T05:18:19.140Z');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCallUpdateTimestamp } = require('../../server/services/call-update-timestamp');

const FIXED_NOW_MS = Date.parse('2026-04-16T17:30:00.000Z');
const nowProvider = () => FIXED_NOW_MS;

test('resolveCallUpdateTimestamp uses explicit updatedAtMs for brand new call', () => {
  const result = resolveCallUpdateTimestamp(
    { updatedAtMs: Date.parse('2026-04-16T17:29:00.000Z'), updatedAt: '2026-04-16T17:29:00.000Z' },
    null,
    { nowMs: nowProvider }
  );
  assert.equal(result.updatedAtMs, Date.parse('2026-04-16T17:29:00.000Z'));
  assert.equal(result.updatedAt, '2026-04-16T17:29:00.000Z');
});

test('resolveCallUpdateTimestamp falls back to endedAt when updatedAt is missing', () => {
  const result = resolveCallUpdateTimestamp(
    { endedAt: '2026-04-16T17:29:45.000Z' },
    null,
    { nowMs: nowProvider }
  );
  assert.equal(result.updatedAtMs, Date.parse('2026-04-16T17:29:45.000Z'));
  assert.equal(result.updatedAt, '2026-04-16T17:29:45.000Z');
});

test('resolveCallUpdateTimestamp falls back to startedAt as last resort before nowMs', () => {
  const result = resolveCallUpdateTimestamp(
    { startedAt: '2026-04-16T17:29:15.000Z' },
    null,
    { nowMs: nowProvider }
  );
  assert.equal(result.updatedAtMs, Date.parse('2026-04-16T17:29:15.000Z'));
  assert.equal(result.updatedAt, '2026-04-16T17:29:15.000Z');
});

test('resolveCallUpdateTimestamp uses nowMs only when no timestamps at all and no existing record', () => {
  const result = resolveCallUpdateTimestamp({}, null, { nowMs: nowProvider });
  assert.equal(result.updatedAtMs, FIXED_NOW_MS);
});

test('resolveCallUpdateTimestamp keeps existing timestamp when passive re-ingest lacks a timestamp', () => {
  const existing = {
    updatedAt: '2026-04-15T10:00:00.000Z',
    updatedAtMs: Date.parse('2026-04-15T10:00:00.000Z'),
  };
  const result = resolveCallUpdateTimestamp({ callId: 'X' }, existing, { nowMs: nowProvider });
  assert.equal(result.updatedAtMs, existing.updatedAtMs, 'Passieve re-ingest mag oude timestamp niet vernieuwen');
  assert.equal(result.updatedAt, existing.updatedAt);
});

test('resolveCallUpdateTimestamp promotes to incoming when incoming is strictly newer', () => {
  const existing = {
    updatedAt: '2026-04-15T10:00:00.000Z',
    updatedAtMs: Date.parse('2026-04-15T10:00:00.000Z'),
  };
  const result = resolveCallUpdateTimestamp(
    { updatedAt: '2026-04-16T17:29:00.000Z', updatedAtMs: Date.parse('2026-04-16T17:29:00.000Z') },
    existing,
    { nowMs: nowProvider }
  );
  assert.equal(result.updatedAtMs, Date.parse('2026-04-16T17:29:00.000Z'));
  assert.equal(result.updatedAt, '2026-04-16T17:29:00.000Z');
});

test('resolveCallUpdateTimestamp keeps existing timestamp when incoming is older (never moves backwards)', () => {
  const existing = {
    updatedAt: '2026-04-16T17:29:00.000Z',
    updatedAtMs: Date.parse('2026-04-16T17:29:00.000Z'),
  };
  const result = resolveCallUpdateTimestamp(
    { updatedAt: '2026-04-15T10:00:00.000Z', updatedAtMs: Date.parse('2026-04-15T10:00:00.000Z') },
    existing,
    { nowMs: nowProvider }
  );
  assert.equal(result.updatedAtMs, existing.updatedAtMs);
  assert.equal(result.updatedAt, existing.updatedAt);
});

test('resolveCallUpdateTimestamp never uses nowMs when existing timestamp is present, even without incoming timestamp', () => {
  const existing = {
    updatedAt: '2026-04-10T09:00:00.000Z',
    updatedAtMs: Date.parse('2026-04-10T09:00:00.000Z'),
  };
  const result = resolveCallUpdateTimestamp(
    { summary: 'Geen timestamp-velden in deze update' },
    existing,
    { nowMs: nowProvider }
  );
  assert.notEqual(result.updatedAtMs, FIXED_NOW_MS);
  assert.equal(result.updatedAtMs, existing.updatedAtMs);
});

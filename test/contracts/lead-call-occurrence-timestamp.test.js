const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveStableCallOccurrenceMs,
  resolveStableCallOccurrenceIso,
} = require('../../server/services/lead-call-occurrence-timestamp');

test('resolveStableCallOccurrenceMs picks endedAt ISO from a call update', () => {
  const ms = resolveStableCallOccurrenceMs({
    endedAt: '2026-04-16T17:29:00.000Z',
    startedAt: '2026-04-16T17:28:00.000Z',
  });
  assert.equal(ms, Date.parse('2026-04-16T17:29:00.000Z'));
});

test('resolveStableCallOccurrenceMs prefers explicit callOccurredAtMs when present', () => {
  const endedMs = Date.parse('2026-04-16T17:29:00.000Z');
  const explicitMs = Date.parse('2026-04-16T17:30:00.000Z');
  const ms = resolveStableCallOccurrenceMs({
    callOccurredAtMs: explicitMs,
    endedAt: new Date(endedMs).toISOString(),
  });
  assert.equal(ms, explicitMs);
});

test('resolveStableCallOccurrenceMs ignores analyzedAt even when it is the newest field', () => {
  const endedMs = Date.parse('2026-04-16T17:29:00.000Z');
  const ms = resolveStableCallOccurrenceMs({
    endedAt: new Date(endedMs).toISOString(),
    analyzedAt: '2026-04-16T17:55:00.000Z',
  });
  assert.equal(ms, endedMs, 'analyzedAt is a processing time and must not leak into the stable call moment');
});

test('resolveStableCallOccurrenceMs ignores updatedAt and updatedAtMs (procedural fields)', () => {
  const endedMs = Date.parse('2026-04-16T17:29:00.000Z');
  const ms = resolveStableCallOccurrenceMs({
    endedAt: new Date(endedMs).toISOString(),
    updatedAt: '2026-04-16T17:55:00.000Z',
    updatedAtMs: Date.parse('2026-04-16T17:55:00.000Z'),
  });
  assert.equal(ms, endedMs);
});

test('resolveStableCallOccurrenceMs ignores createdAt (could be re-hydrate now()) when an ended/started exists', () => {
  const endedMs = Date.parse('2026-04-16T17:29:00.000Z');
  const ms = resolveStableCallOccurrenceMs({
    endedAt: new Date(endedMs).toISOString(),
    createdAt: '2027-01-01T00:00:00.000Z',
  });
  assert.equal(ms, endedMs);
});

test('resolveStableCallOccurrenceMs takes the highest stable time across multiple sources', () => {
  const update = { endedAt: '2026-04-16T17:29:00.000Z' };
  const insight = { endedAt: '2026-04-16T17:31:00.000Z', analyzedAt: '2026-04-16T18:00:00.000Z' };
  const ms = resolveStableCallOccurrenceMs(update, insight);
  assert.equal(ms, Date.parse('2026-04-16T17:31:00.000Z'));
});

test('resolveStableCallOccurrenceMs accepts confirmationTaskCreatedAt as stable fallback', () => {
  const ms = resolveStableCallOccurrenceMs({
    confirmationTaskCreatedAt: '2026-04-16T10:00:00.000Z',
    updatedAt: '2026-04-16T18:00:00.000Z',
  });
  assert.equal(ms, Date.parse('2026-04-16T10:00:00.000Z'));
});

test('resolveStableCallOccurrenceMs returns 0 when no stable fields are present', () => {
  const ms = resolveStableCallOccurrenceMs(
    { analyzedAt: '2026-04-16T17:55:00.000Z', updatedAt: '2026-04-16T17:56:00.000Z' },
    null,
    undefined,
    {}
  );
  assert.equal(ms, 0);
});

test('resolveStableCallOccurrenceMs handles null, undefined, and non-object sources safely', () => {
  const ms = resolveStableCallOccurrenceMs(null, undefined, 42, 'string', { endedAt: '2026-04-16T17:29:00.000Z' });
  assert.equal(ms, Date.parse('2026-04-16T17:29:00.000Z'));
});

test('resolveStableCallOccurrenceIso returns the ISO equivalent of the stable millisecond value', () => {
  const endedIso = '2026-04-16T17:29:00.000Z';
  const iso = resolveStableCallOccurrenceIso({ endedAt: endedIso });
  assert.equal(iso, endedIso);
});

test('resolveStableCallOccurrenceIso returns empty string when no stable time exists', () => {
  const iso = resolveStableCallOccurrenceIso({ analyzedAt: '2026-04-16T17:55:00.000Z' });
  assert.equal(iso, '');
});

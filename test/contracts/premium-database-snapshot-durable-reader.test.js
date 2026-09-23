const test = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumDatabaseSnapshotDurableReader } = require('../../server/services/premium-database-snapshot-durable-reader');

test('durable snapshot read reports fetch, decode and validation time without logging its contents', async () => {
  const entries = [];
  const times = [100, 120, 130, 135];
  const raw = 'private-snapshot-content';
  const reader = createPremiumDatabaseSnapshotDurableReader({
    scope: 'snapshot-scope', key: 'snapshot-key', nowMs: () => times.shift(),
    getUiStateValues: async (_scope, options) => {
      assert.equal(options.includeRevision, true);
      return { source: 'supabase', exists: true, updatedAt: '2026-09-23', revision: 4,
        values: { 'snapshot-key': raw } };
    },
    parse: (value) => ({ rows: [value] }),
    isCoherent: (value) => value.rows.length === 1,
    logger: { info: (entry) => entries.push(entry) },
  });

  const result = await reader.readFull();

  assert.equal(result.version, '2026-09-23:4');
  assert.deepEqual(result.data, { rows: [raw] });
  assert.deepEqual(JSON.parse(entries[0]), {
    event: 'premium-snapshot-durable-read', outcome: 'ready',
    fetchMs: 20, parseMs: 10, validateMs: 5, encodedChars: raw.length,
  });
  assert.equal(entries[0].includes(raw), false);
});

test('durable snapshot read keeps invalid data unavailable and reports that outcome', async () => {
  const entries = [];
  const reader = createPremiumDatabaseSnapshotDurableReader({
    scope: 'snapshot-scope', key: 'snapshot-key',
    getUiStateValues: async () => ({ source: 'supabase', exists: true, updatedAt: '2026-09-23',
      values: { 'snapshot-key': 'invalid' } }),
    parse: () => ({ rows: [] }), isCoherent: (value) => value.rows.length > 0,
    logger: { info: (entry) => entries.push(JSON.parse(entry)) },
  });

  const result = await reader.readFull();

  assert.equal(result.data, null);
  assert.equal(entries[0].outcome, 'invalid');
  assert.equal(entries[0].encodedChars, 7);
});

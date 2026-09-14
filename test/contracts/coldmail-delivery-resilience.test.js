const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOutboundRecipientGuardStore } = require('../../server/services/outbound-recipient-guard-store');

test('critical recipient reads get an isolated ten-second budget and still reject unavailable proof', async () => {
  let policy;
  const query = { select() { return this; }, eq() { return this; }, order() { return this; },
    async range() { throw new Error('database unavailable'); } };
  const store = createOutboundRecipientGuardStore({ isSupabaseConfigured: () => true,
    getSupabaseClient(options) { policy = options; return { from: () => query }; },
  });
  await assert.rejects(store.listSentRecipientGroups({ requireComplete: true }), /database unavailable/);
  assert.deepEqual(policy, { timeoutMs: 10000, ignoreFailureCooldown: true, suppressFailureCooldown: true });
});

test('incoming-mail correction is identical in fresh schema and upgrade and preserves permanent guards', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260914163703_mailbox_outbound_direction_evidence.sql'), 'utf8').trim();
  const schema = fs.readFileSync(path.join(__dirname, '../../supabase/data-ops-schema.sql'), 'utf8');
  assert.ok(schema.includes(migration));
  assert.match(migration, /if not public\.softora_mailbox_message_is_outbound[\s\S]*return 0;[\s\S]*insert into/);
  assert.match(migration, /sentStatsExcluded/);
  assert.match(migration, /g\.payload->>'messageKey' = m\.message_key/);
  assert.doesNotMatch(migration, /delete from|permanent = false\s*,|status = 'reserved'|security definer/i);
  assert.match(migration, /revoke all on function public\.softora_mailbox_message_is_outbound/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260817132639_deduplicate_mailbox_lineage_resolver_results.sql'
), 'utf8');

test('mailbox lineage resolver returns one deterministic row per message', () => {
  assert.match(
    migration,
    /select distinct on \(lineage\.message_key\)[\s\S]*from lineage[\s\S]*order by\s+lineage\.message_key,\s+lineage\.lineage_depth,\s+lineage\.root_message_key,\s+lineage\.parent_message_key nulls first;/
  );
});

test('mailbox lineage resolver stays invoker-secured with an empty search path', () => {
  assert.match(migration, /language sql\s+stable\s+security invoker\s+set search_path = ''/);
  assert.doesNotMatch(migration, /security definer/i);
});

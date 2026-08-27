const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260827163903_mailbox_attachment_metadata.sql'
), 'utf8');
const validatorFix = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260827174916_fix_mailbox_attachment_metadata_validator.sql'
), 'utf8');
const sha256Migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260827215000_mailbox_attachment_content_sha256.sql'
), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/data-ops-schema.sql'), 'utf8');

function assertAttachmentMetadataContract(sql, label) {
  assert.match(sql, /add column if not exists attachments_metadata jsonb/i, label);
  assert.match(sql, /attachments_metadata is null\s+or\s+public\.softora_mailbox_attachments_metadata_is_valid/i, label);
  assert.match(sql, /jsonb_array_length\(p_value\) > 5/i, label);
  assert.match(sql, /v_key_count <> (?:3|case when v_has_sha256 then 4 else 3 end)/i, label);
  assert.match(sql, /v_size > 4194304/i, label);
  assert.match(sql, /return v_total <= 5242880/i, label);
  assert.match(sql, /old\.references_text, old\.mode, old\.owner, old\.attachments_metadata/i, label);
  assert.match(sql, /new\.references_text, new\.mode, new\.owner, new\.attachments_metadata/i, label);
}

test('additieve mailbox attachment-metadata migratie bewaart legacy-null en valideert vorm en grenzen', () => {
  assertAttachmentMetadataContract(migration, 'migration');
  assertAttachmentMetadataContract(schema, 'data-ops-schema');
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(migration, /attachments_metadata jsonb not null/i);
  assert.match(schema, /attachments_metadata jsonb,/i);
});

test('SHA-256 metadata-uitbreiding behoudt legacy en weigert downgrade, gemengd en niet-canoniek', () => {
  for (const [label, sql] of [['sha256-migration', sha256Migration], ['data-ops-schema', schema]]) {
    assert.match(sql, /v_has_sha256 := pg_catalog\.jsonb_exists\(v_item, 'sha256'\)/i, label);
    assert.match(sql, /v_hash_mode is distinct from v_has_sha256[\s\S]*?return false/i, label);
    assert.match(sql, /v_key_count <> case when v_has_sha256 then 4 else 3 end/i, label);
    assert.match(sql, /\(v_item->>'sha256'\) !~ '\^\[0-9a-f\]\{64\}\$'/i, label);
    assert.match(sql, /grant execute on function public\.softora_mailbox_attachments_metadata_is_valid\(jsonb\)\s+to service_role/i, label);
  }
  assert.match(sha256Migration, /notify pgrst, 'reload schema'/i);
});

test('metadata-validator gebruikt een uitvoerbare schema-gekwalificeerde slashcontrole', () => {
  for (const [label, sql] of [['validator-fix', validatorFix], ['data-ops-schema', schema]]) {
    assert.match(sql, /pg_catalog\.strpos\(v_item->>'contentType', '\/'\) <= 1/i, label);
    assert.doesNotMatch(sql, /pg_catalog\.position\('\/' in/i, label);
    assert.match(sql, /security invoker\s+set search_path = ''/i, label);
    assert.match(sql, /grant execute on function public\.softora_mailbox_attachments_metadata_is_valid\(jsonb\)\s+to service_role/i, label);
  }
});

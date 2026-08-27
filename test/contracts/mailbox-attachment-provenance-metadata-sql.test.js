const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260827163903_mailbox_attachment_metadata.sql'
), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/data-ops-schema.sql'), 'utf8');

function assertAttachmentMetadataContract(sql, label) {
  assert.match(sql, /add column if not exists attachments_metadata jsonb/i, label);
  assert.match(sql, /attachments_metadata is null\s+or\s+public\.softora_mailbox_attachments_metadata_is_valid/i, label);
  assert.match(sql, /jsonb_array_length\(p_value\) > 5/i, label);
  assert.match(sql, /v_key_count <> 3/i, label);
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


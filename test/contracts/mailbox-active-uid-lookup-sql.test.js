'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260824163249_mailbox_active_uid_lookup.sql'
);

test('active mailbox UID lookup migration restores the campaign-sync access path', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');

  assert.match(
    migration,
    /create index if not exists softora_mailbox_messages_account_folder_uid_active_idx\s+on public\.softora_mailbox_messages \(account_email, folder, uid desc\)/i
  );
  assert.match(migration, /include \(date\)/i);
  assert.match(
    migration,
    /where deleted_at is null\s+and generation_superseded_at is null/i
  );
  assert.doesNotMatch(migration, /unique index/i);
});

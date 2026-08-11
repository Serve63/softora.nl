const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

test('sportschool persistence schema is service-role-only', () => {
  const schema = fs.readFileSync(
    path.join(repoRoot, 'supabase/runtime-state-schema.sql'),
    'utf8'
  );

  for (const table of [
    'softora_sportschool_logbook',
    'softora_sportschool_logbook_history',
  ]) {
    assert.match(
      schema,
      new RegExp(`revoke all privileges on table public\\.${table}[\\s\\S]*?from public, anon, authenticated;`, 'i')
    );
    assert.match(
      schema,
      new RegExp(`grant select, insert, update, delete on table public\\.${table}[\\s\\S]*?to service_role;`, 'i')
    );
  }

  assert.doesNotMatch(schema, /create policy softora_sportschool_logbook_public_/i);
  assert.match(schema, /create policy softora_sportschool_logbook_service_role_all/i);
  assert.match(schema, /create policy softora_sportschool_logbook_history_service_role_all/i);
});

test('security migration removes current and future public database privileges', () => {
  const migration = fs.readFileSync(
    path.join(
      repoRoot,
      'supabase/migrations/20260811214540_close_public_logbook_and_default_grants.sql'
    ),
    'utf8'
  );

  assert.match(migration, /drop policy if exists softora_sportschool_logbook_public_select/i);
  assert.match(
    migration,
    /revoke all privileges on table public\.softora_mailbox_sync_state[\s\S]*?from public, anon, authenticated;/i
  );
  assert.match(
    migration,
    /revoke all privileges on table public\.softora_omzetwerk_feasibility_requests[\s\S]*?from public, anon, authenticated;/i
  );
  assert.match(
    migration,
    /revoke execute on function public\.softora_preserve_mailbox_read_state\(\)[\s\S]*?from public, anon, authenticated;/i
  );

  assert.match(
    migration,
    /alter default privileges for role postgres in schema public[\s\S]*?revoke all privileges on tables from anon, authenticated;/i
  );
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public[\s\S]*?revoke execute on functions from public, anon, authenticated;/i
  );
  assert.doesNotMatch(migration, /alter default privileges for role supabase_admin/i);
});

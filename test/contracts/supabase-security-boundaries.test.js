const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function readMigration(fileName) {
  return fs.readFileSync(path.join(repoRoot, 'supabase/migrations', fileName), 'utf8');
}

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

test('latest security migration closes supabase-admin defaults for future public objects', () => {
  const migration = fs.readFileSync(
    path.join(
      repoRoot,
      'supabase/migrations/20260813102408_harden_public_default_privileges.sql'
    ),
    'utf8'
  );

  assert.match(
    migration,
    /alter default privileges for role supabase_admin in schema public[\s\S]*?revoke all on tables from anon, authenticated, service_role;/i
  );
  assert.match(
    migration,
    /alter default privileges for role supabase_admin in schema public[\s\S]*?revoke all on sequences from anon, authenticated, service_role;/i
  );
  assert.match(
    migration,
    /alter default privileges for role supabase_admin in schema public[\s\S]*?revoke execute on functions from public, anon, authenticated, service_role;/i
  );
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public[\s\S]*?revoke all on tables from anon, authenticated, service_role;/i
  );
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public[\s\S]*?revoke execute on functions from public, anon, authenticated, service_role;/i
  );
});

test('premium MFA mutations are row-locked, compare-and-swap guarded, and service-role-only', () => {
  const sql = readMigration('20260813103910_atomic_premium_mfa_state.sql');

  assert.match(sql, /create or replace function public\.softora_mutate_premium_mfa_state/i);
  assert.match(sql, /where state_key = 'premium_auth_users'[\s\S]*for update;/i);
  assert.match(sql, /v_current_auth_version <> p_expected_auth_version/i);
  assert.match(sql, /v_current_counter <> p_expected_last_totp_counter/i);
  assert.match(sql, /coalesce\(v_current_mfa ->> 'enabled', 'false'\) not in \('true', 'false'\)/i);
  assert.match(sql, /coalesce\(p_next_mfa ->> 'lastTotpCounter', ''\) !~ '\^\[0-9\]\{1,18\}\$'/i);
  assert.match(sql, /return jsonb_build_object\('ok', false, 'reason', 'invalid_state'\)/i);
  assert.doesNotMatch(sql, /coalesce\(\(v_current_mfa ->> 'enabled'\)::boolean/i);
  assert.match(sql, /not \(v_current_recovery_hashes \? p_expected_recovery_code_hash\)/i);
  assert.match(sql, /revision = v_revision \+ 1/i);
  assert.match(sql, /revoke all on function public\.softora_mutate_premium_mfa_state[\s\S]*from public, anon, authenticated, service_role;/i);
  assert.match(sql, /grant execute on function public\.softora_mutate_premium_mfa_state[\s\S]*to service_role;/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (?:public|anon|authenticated)/i);
});

test('premium user-list writes use a revision CAS so they cannot overwrite MFA progress', () => {
  const sql = readMigration('20260813103910_atomic_premium_mfa_state.sql');

  assert.match(sql, /create or replace function public\.softora_replace_premium_auth_users/i);
  assert.match(sql, /where state_key = 'premium_auth_users'[\s\S]*for update;/i);
  assert.match(sql, /v_revision <> p_expected_revision/i);
  assert.match(sql, /on conflict \(state_key\) do nothing/i);
  assert.match(sql, /revoke all on function public\.softora_replace_premium_auth_users[\s\S]*from public, anon, authenticated, service_role;/i);
  assert.match(sql, /grant execute on function public\.softora_replace_premium_auth_users[\s\S]*to service_role;/i);
});
